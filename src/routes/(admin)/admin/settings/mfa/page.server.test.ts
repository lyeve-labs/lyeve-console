import { describe, expect, it, vi } from 'vitest';
import { actions, load } from './+page.server';

type Reply = { status: number; body: unknown };

/** An event whose engine answers each path with the reply given for it. */
function event(replies: Record<string, Reply>, form: Record<string, string> = {}) {
	const calls: { url: string; body: unknown }[] = [];
	const fetch = vi.fn(async (url: string, init?: RequestInit) => {
		const path = new URL(url, 'http://engine').pathname;
		calls.push({ url: path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
		const r = replies[path] ?? { status: 404, body: { error: 'not found' } };
		return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
	});
	const body = new FormData();
	for (const [k, v] of Object.entries(form)) body.set(k, v);
	return {
		calls,
		ev: {
			fetch,
			cookies: { get: (name: string) => (name === '__Host-sys_session' ? 'tok' : name === '__Host-csrf' ? 'c' : undefined) },
			request: new Request('http://admin/admin/settings/mfa', { method: 'POST', body }),
		} as never,
	};
}

describe('mfa load', () => {
	it('reads the account state and keeps an unreadable one unknown, never off', async () => {
		const on = event({ '/api/admin/mfa/status': { status: 200, body: { enabled: true, has_passkeys: false, passkeys: [] } } });
		expect(await load(on.ev)).toEqual({ mfa: { ok: true, value: { enabled: true, hasPasskeys: false } } });
		const off = event({ '/api/admin/mfa/status': { status: 200, body: { enabled: false, has_passkeys: false, passkeys: [] } } });
		expect(await load(off.ev)).toEqual({ mfa: { ok: true, value: { enabled: false, hasPasskeys: false } } });
		const down = event({ '/api/admin/mfa/status': { status: 503, body: { error: 'x' } } });
		expect(await load(down.ev)).toEqual({ mfa: { ok: false, gate: { state: 'unavailable' } } });
	});

	// The plugin reports a passkey as two-factor on, and lists it.
	it('keeps a passkey apart from the authenticator app', async () => {
		const passkey = event({
			'/api/admin/mfa/status': {
				status: 200,
				body: {
					enabled: true,
					has_passkeys: true,
					passkeys: [
						{ id: 'a1b2', name: 'Laptop', is_backup: false, created_at: '2026-10-01T09:00:00Z', last_used_at: null },
					],
				},
			},
		});
		expect(await load(passkey.ev)).toEqual({ mfa: { ok: true, value: { enabled: true, hasPasskeys: true } } });
	});
});

describe('mfa disable with no app set up', () => {
	it('says there is no authenticator app to turn off', async () => {
		const { ev } = event({ '/api/admin/mfa/totp/disable': { status: 400, body: { error: 'MFA not enabled' } } }, { code: '123456' });
		const r = (await actions.disable(ev)) as { status: number; data: Record<string, unknown> };
		expect(r.status).toBe(400);
		expect(r.data.error).toBe('No authenticator app is set up on this account.');
	});
});

describe('mfa actions', () => {
	it('moves to the QR step with the key the engine generated', async () => {
		const { ev, calls } = event({ '/api/admin/mfa/totp/setup': { status: 200, body: { provisioning_uri: 'otpauth://x', secret: 'ABC' } } });
		expect(await actions.setup(ev)).toEqual({ step: 'confirming', uri: 'otpauth://x', secret: 'ABC' });
		expect(calls[0].body).toEqual({});
	});
});

describe('mfa setup over an authenticator app already set up', () => {
	const setupPath = '/api/admin/mfa/totp/setup';

	it('sends the code that proves the app already set up', async () => {
		const { ev, calls } = event({ [setupPath]: { status: 200, body: { provisioning_uri: 'otpauth://x', secret: 'ABC' } } }, { code: ' 123456 ' });
		expect(await actions.setup(ev)).toEqual({ step: 'confirming', uri: 'otpauth://x', secret: 'ABC' });
		expect(calls[0].body).toEqual({ code: '123456' });
	});

	it('asks for a code when the engine says one is required', async () => {
		const { ev } = event({ [setupPath]: { status: 400, body: { error: 'engine words', code: 'mfa.totp.current_code_required' } } });
		const r = (await actions.setup(ev)) as { status: number; data: Record<string, unknown> };
		expect(r.status).toBe(400);
		expect(r.data).toEqual({
			step: 'idle',
			error: 'This account already has a second factor. Confirm it with a passkey, a current code from the authenticator app or a backup code first.',
		});
	});

	it('says the code did not match when the engine refuses it', async () => {
		const { ev } = event({ [setupPath]: { status: 422, body: { error: 'engine words', code: 'mfa.totp.current_code_invalid' } } }, { code: '000000' });
		const r = (await actions.setup(ev)) as { status: number; data: Record<string, unknown> };
		expect(r.status).toBe(400);
		expect(r.data).toEqual({
			step: 'idle',
			error: 'That code does not match this account.',
		});
	});

	it('gives its own sentence for a failure that is not an engine answer', async () => {
		const { ev } = event({});
		(ev as { fetch: unknown }).fetch = vi.fn(async () => {
			throw new TypeError('fetch failed: connect ECONNREFUSED 10.0.0.7:3002');
		});
		const r = (await actions.setup(ev)) as { status: number; data: Record<string, unknown> };
		expect(r.data).toEqual({ step: 'idle', error: 'Could not create the authenticator key. Try again.' });
	});

	it('keeps a server failure body off the page', async () => {
		const { ev } = event({ [setupPath]: { status: 503, body: { error: 'dial tcp: refused', code: 'mfa.totp.current_code_invalid' } } }, { code: '000000' });
		const r = (await actions.setup(ev)) as { data: Record<string, unknown> };
		expect(r.data).toMatchObject({ step: 'idle', error: 'Could not create the authenticator key. Try again.' });
	});
});

describe('mfa verify and disable', () => {

	it('refuses a code that is not six digits before asking the engine', async () => {
		const { ev, calls } = event({}, { code: '12', uri: 'otpauth://x', secret: 'ABC' });
		const r = (await actions.verify(ev)) as { status: number; data: Record<string, unknown> };
		expect(r.status).toBe(400);
		expect(r.data).toMatchObject({ step: 'confirming', secret: 'ABC', error: 'Enter the 6-digit code from the app.' });
		expect(calls).toHaveLength(0);
	});

	it('keeps the same key on a wrong code and says what the engine said', async () => {
		const { ev } = event(
			{ '/api/admin/mfa/totp/verify': { status: 400, body: { error: 'invalid code', code: 'bad_request' } } },
			{ code: '123456', uri: 'otpauth://x', secret: 'ABC' },
		);
		const r = (await actions.verify(ev)) as { data: Record<string, unknown> };
		expect(r.data).toMatchObject({ step: 'confirming', uri: 'otpauth://x', secret: 'ABC', error: 'invalid code' });
	});

	it('starts over when the setup began before the account had a second factor', async () => {
		const { ev } = event(
			{ '/api/admin/mfa/totp/verify': { status: 409, body: { error: 'engine words', code: 'mfa.totp.setup_unproven' } } },
			{ code: '123456', uri: 'otpauth://x', secret: 'ABC' },
		);
		const r = (await actions.verify(ev)) as { status: number; data: Record<string, unknown> };
		expect(r.status).toBe(409);
		expect(r.data).toEqual({
			step: 'idle',
			error: 'This setup started before the account had a second factor. Start the setup again.',
		});
	});

	it('hands back the backup codes once the code is accepted', async () => {
		const { ev, calls } = event(
			{ '/api/admin/mfa/totp/verify': { status: 200, body: { backup_codes: ['a1', 'b2'] } } },
			{ code: '123456', uri: 'otpauth://x', secret: 'ABC' },
		);
		expect(await actions.verify(ev)).toEqual({ step: 'done', backupCodes: ['a1', 'b2'] });
		expect(calls[0].body).toEqual({ code: '123456' });
	});

	it('never shows a server failure body', async () => {
		const { ev } = event({ '/api/admin/mfa/totp/disable': { status: 500, body: { error: 'pq: relation missing' } } }, { code: '123456' });
		const r = (await actions.disable(ev)) as { data: Record<string, unknown> };
		expect(r.data.error).toBe('Could not turn off two-factor authentication. Try again.');
	});
});

describe('mfa setup proven by a passkey', () => {
	const setupPath = '/api/admin/mfa/totp/setup';
	const proofPath = '/api/admin/mfa/proof/begin';

	it('starts a proof and hands the challenge to the page', async () => {
		const options = { publicKey: { challenge: 'AAEC' } };
		const { ev, calls } = event({ [proofPath]: { status: 200, body: { session_id: 'proof-1', options } } });
		expect(await actions.prove(ev)).toEqual({ step: 'proving', proofSessionId: 'proof-1', options });
		expect(calls[0].url).toBe(proofPath);
	});

	it('says there is no passkey when the engine finds none', async () => {
		const { ev } = event({ [proofPath]: { status: 404, body: { error: 'no passkey is registered on this account', code: 'not_found' } } });
		const r = (await actions.prove(ev)) as { status: number; data: Record<string, unknown> };
		expect(r.data).toEqual({ step: 'idle', error: 'No passkey is registered on this account. Enter a code instead.' });
	});

	it('keeps an outage of the proof off the page', async () => {
		const { ev } = event({ [proofPath]: { status: 503, body: { error: 'dial tcp: refused' } } });
		const r = (await actions.prove(ev)) as { data: Record<string, unknown> };
		expect(r.data).toMatchObject({ step: 'idle', error: 'Could not start the passkey check. Try again.' });
	});

	it('sends the signed assertion with the proof session', async () => {
		const assertion = { id: 'BAUG', response: { signature: 'Aw' } };
		const { ev, calls } = event(
			{ [setupPath]: { status: 200, body: { provisioning_uri: 'otpauth://x', secret: 'ABC' } } },
			{ proof_session_id: 'proof-1', assertion: JSON.stringify(assertion) },
		);
		expect(await actions.setup(ev)).toEqual({ step: 'confirming', uri: 'otpauth://x', secret: 'ABC' });
		expect(calls[0].body).toEqual({ proof_session_id: 'proof-1', assertion });
	});

	it('calls a refused passkey a refused passkey, not a wrong code', async () => {
		const { ev } = event(
			{ [setupPath]: { status: 422, body: { error: 'engine words', code: 'mfa.totp.current_code_invalid' } } },
			{ proof_session_id: 'proof-1', assertion: '{}' },
		);
		const r = (await actions.setup(ev)) as { status: number; data: Record<string, unknown> };
		expect(r.data).toEqual({
			step: 'idle',
			error: 'Could not confirm the passkey. Try again, or enter a code instead.',
		});
	});
});

/*
 * A first second factor takes the account's password when the sign-in is not
 * recent. The engine says which proof it wants by code, and the page asks for
 * the password, says it did not match, or sends the reader to sign in again.
 */
describe('mfa setup of a first factor', () => {
	const setupPath = '/api/admin/mfa/totp/setup';

	it('sends the password the reader confirmed with', async () => {
		const { ev, calls } = event({ [setupPath]: { status: 200, body: { provisioning_uri: 'otpauth://x', secret: 'ABC' } } }, { password: 'correct horse battery' });
		expect(await actions.setup(ev)).toEqual({ step: 'confirming', uri: 'otpauth://x', secret: 'ABC' });
		expect(calls[0].body).toEqual({ password: 'correct horse battery' });
	});

	it('asks for the password when the engine requires it', async () => {
		const { ev } = event({ [setupPath]: { status: 400, body: { error: 'x', code: 'mfa.first_factor.password_required' } } });
		const r = (await actions.setup(ev)) as { status: number; data: Record<string, unknown> };
		expect(r.status).toBe(400);
		expect(r.data).toEqual({ step: 'password' });
	});

	it('says the password did not match, on the password step', async () => {
		const { ev } = event({ [setupPath]: { status: 422, body: { error: 'x', code: 'mfa.first_factor.password_invalid' } } }, { password: 'wrong' });
		const r = (await actions.setup(ev)) as { status: number; data: Record<string, unknown> };
		expect(r.status).toBe(422);
		expect(r.data).toEqual({ step: 'password', passwordError: 'That password does not match your account.' });
	});

	it('sends the reader to sign in again when there is no password to give', async () => {
		const { ev } = event({ [setupPath]: { status: 403, body: { error: 'x', code: 'mfa.first_factor.sign_in_required' } } });
		const r = (await actions.setup(ev)) as { status: number; data: Record<string, unknown> };
		expect(r.status).toBe(403);
		expect(r.data).toEqual({ step: 'signIn' });
	});
});
