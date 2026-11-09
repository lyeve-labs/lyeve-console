import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { actions, load } from './+page.server';
import { resetRateLimitStore } from '$lib/server/rate-limit';

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function submit(fields: Record<string, string>, fetch: typeof globalThis.fetch) {
	const formData = new FormData();
	for (const [k, v] of Object.entries(fields)) formData.set(k, v);
	return actions.default({
		getClientAddress: () => '127.0.0.1',
		request: { formData: () => Promise.resolve(formData) },
		fetch,
	} as never);
}

const STRONG = 'correct horse battery';

describe('reset-password load', () => {
	afterEach(() => vi.unstubAllEnvs());

	it('reads the token from the link', () => {
		expect(load({ url: new URL('http://admin.test/reset-password?token=t1') } as never)).toEqual({
			token: 't1',
			minLength: 12,
			carried: '',
		});
	});

	it('carries the organization its link names, and drops one the engine would not read', () => {
		vi.stubEnv('SIGN_IN_ORGANIZATION', 'true');
		const named = load({ url: new URL('http://admin.test/reset-password?token=t1&tenant=acme') } as never) as { carried: string };
		expect(named.carried).toBe('acme');
		const malformed = load({ url: new URL('http://admin.test/reset-password?token=t1&tenant=Acme%20Co') } as never) as {
			carried: string;
		};
		expect(malformed.carried).toBe('');
	});

	it('carries no organization on while the console does not ask for one', () => {
		vi.stubEnv('SIGN_IN_ORGANIZATION', '');
		const named = load({ url: new URL('http://admin.test/reset-password?token=t1&tenant=acme') } as never) as { carried: string };
		expect(named.carried).toBe('');
	});
});

describe('reset-password action', () => {
	// An outage says nothing about what the visitor typed, so it reads as the
	// engine being away rather than as a bad address or an expired link.
	it.each([
		['answers 503', () => json({ error: 'dial tcp 10.0.0.4:5432: connection refused' }, 503)],
		['answers 502', () => json({ error: 'bad gateway' }, 502)],
		['does not answer', () => Promise.reject(new TypeError('fetch failed'))],
	])('says the engine is unavailable when it %s', async (_case, answer) => {
		const fetch = vi.fn(async () => answer()) as unknown as typeof globalThis.fetch;
		const result = (await submit({ token: 't1', password: STRONG, confirm: STRONG }, fetch)) as { status: number; data: { error: string } };
		expect(result.status).toBeGreaterThanOrEqual(500);
		expect(result.data.error).toBe('The engine is unavailable, so password reset is not available. Try again in a moment.');
	});

	beforeEach(() => resetRateLimitStore());

	it('sets the new password with the token from the link', async () => {
		const fetch = vi.fn(async (_url: string, _init: RequestInit) =>
			json({ message: 'Password has been reset successfully.' })
		) as unknown as typeof globalThis.fetch;

		const result = await submit({ token: 't1', password: STRONG, confirm: STRONG, remove_passkeys: 'on' }, fetch);

		expect(result).toEqual({ done: true, passkeysRemoved: 0 });
		const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
		expect(String(url)).toContain('/api/admin/auth/password-reset/confirm');
		expect(JSON.parse(String(init.body))).toEqual({ token: 't1', password: STRONG, remove_passkeys: true });
	});

	it('keeps the passkeys when the box is cleared, and says how many a removal took', async () => {
		const keep = vi.fn(async () => json({ message: 'ok', passkeys_removed: 0 })) as unknown as typeof globalThis.fetch;
		await submit({ token: 't1', password: STRONG, confirm: STRONG }, keep);
		const [, init] = (keep as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
		expect(JSON.parse(String(init.body)).remove_passkeys).toBe(false);

		const remove = vi.fn(async () => json({ message: 'ok', passkeys_removed: 2 })) as unknown as typeof globalThis.fetch;
		const result = await submit({ token: 't1', password: STRONG, confirm: STRONG, remove_passkeys: 'on' }, remove);
		expect(result).toEqual({ done: true, passkeysRemoved: 2 });
	});

	it('refuses a short password before spending the token', async () => {
		const fetch = vi.fn() as unknown as typeof globalThis.fetch;
		const result = (await submit({ token: 't1', password: 'short', confirm: 'short' }, fetch)) as {
			data: { error: string };
		};
		expect(result.data.error).toBe('Use at least 12 characters.');
		expect(fetch).not.toHaveBeenCalled();
	});

	it('refuses a password over 72 bytes before spending the token', async () => {
		const fetch = vi.fn() as unknown as typeof globalThis.fetch;
		// 37 characters, 74 bytes in UTF-8.
		const long = 'é'.repeat(37);
		const result = (await submit({ token: 't1', password: long, confirm: long }, fetch)) as {
			data: { error: string };
		};
		expect(result.data.error).toMatch(/at most 72 bytes/);
		expect(fetch).not.toHaveBeenCalled();
	});

	it('refuses two passwords that differ', async () => {
		const fetch = vi.fn() as unknown as typeof globalThis.fetch;
		const result = (await submit({ token: 't1', password: STRONG, confirm: STRONG + '!' }, fetch)) as {
			data: { error: string };
		};
		expect(result.data.error).toBe('The passwords do not match.');
		expect(fetch).not.toHaveBeenCalled();
	});

	// The engine applies its password policy before it claims the token, so a
	// refusal leaves the link valid. The reader keeps the form and sees the
	// engine's own sentence, never the expired-link page.
	it.each([
		['AUTH_PASSWORD_TOO_COMMON', 'This password is too common. Please choose a more unique password.'],
		['AUTH_PASSWORD_NEEDS_COMPLEXITY', 'Password must contain at least one uppercase letter, one lowercase letter, and one digit.'],
		['AUTH_PASSWORD_TOO_SHORT', 'Password must be at least 16 characters.'],
		['AUTH_PASSWORD_TOO_LONG', 'Password must be at most 72 bytes. A character outside ASCII takes two bytes or more.'],
	])('keeps the form and shows the engine text for %s', async (code, error) => {
		const fetch = vi.fn(async () => json({ error, code }, 422)) as unknown as typeof globalThis.fetch;
		const result = (await submit({ token: 't1', password: STRONG, confirm: STRONG }, fetch)) as {
			status: number;
			data: Record<string, unknown>;
		};
		expect(result.status).toBe(422);
		expect(result.data.error).toBe(error);
		expect(result.data.expired).toBeUndefined();
	});

	it('reads a refused token as an expired link', async () => {
		const fetch = vi.fn(async () => json({ error: 'invalid or expired reset token' }, 400)) as unknown as typeof globalThis.fetch;
		const result = (await submit({ token: 'spent', password: STRONG, confirm: STRONG }, fetch)) as {
			status: number;
			data: Record<string, unknown>;
		};
		expect(result.status).toBe(400);
		expect(result.data.expired).toBe(true);
	});
});
