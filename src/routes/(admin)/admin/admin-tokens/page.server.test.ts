import { describe, expect, it, vi } from 'vitest';
import { actions, load } from './+page.server';
import { signedIn } from '$lib/server/test-support/signed-in';

type Reply = { status: number; body?: unknown };

/**
 * A request event whose fetch answers by path. The actions check the role
 * first, through /api/admin/auth/me, so every event answers that as an admin.
 */
function event(replies: Record<string, Reply>, form: Record<string, string | string[]> = {}, url = 'http://admin/admin/admin-tokens') {
	const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const u = new URL(String(input), 'http://admin');
		const key = `${init?.method ?? 'GET'} ${u.pathname}`;
		if (key === 'GET /api/admin/auth/me') {
			return new Response(JSON.stringify({ id: 'u1', email: 'a@b.test', roles: ['admin'], tenant_id: 'default' }), { status: 200, headers: { 'content-type': 'application/json' } });
		}
		const r = replies[key] ?? { status: 404, body: { error: 'not found' } };
		return new Response(r.status === 204 ? null : JSON.stringify(r.body ?? {}), { status: r.status, headers: { 'content-type': 'application/json' } });
	});
	const data = new FormData();
	data.set('confirmed', 'yes');
	for (const [k, v] of Object.entries(form)) for (const one of [v].flat()) data.append(k, one);
	const cookies = { get: (n: string) => (n === '__Host-sys_session' ? 'tok' : n === '__Host-csrf' ? 'c' : undefined) };
	return {
		fetch,
		ev: { fetch, cookies, url: new URL(url), request: new Request(url, { method: 'POST', body: data }) } as never,
	};
}

function bodyOf(fetch: ReturnType<typeof vi.fn>, key: string): Record<string, unknown> {
	const call = fetch.mock.calls.find(([input, init]) => `${(init as RequestInit | undefined)?.method ?? 'GET'} ${new URL(String(input), 'http://admin').pathname}` === key);
	if (!call) throw new Error(`no call to ${key}`);
	return JSON.parse(String((call[1] as RequestInit).body));
}

const VALID = { name: 'ci-deploy', grants: ['schemas:read'], expiry: '30', allowed_ips: '10.0.0.0/8', step: 'password', password: 'pw' };
const ISSUED = { id: 't1', name: 'ci-deploy', expires_at: '2026-10-26T00:00:00Z', token: 'lyat_secret' };

describe('the create action', () => {
	it('issues the token and hands it back once, with the step-up in the body', async () => {
		const { ev, fetch } = event({ 'POST /api/admin/admin-tokens': { status: 201, body: ISSUED } }, VALID);
		const out = (await actions.create(ev)) as { issued: { token: string; rotated: boolean } };
		expect(out.issued).toEqual({ token: 'lyat_secret', name: 'ci-deploy', expires_at: '2026-10-26T00:00:00Z', rotated: false });
		const body = bodyOf(fetch, 'POST /api/admin/admin-tokens');
		expect(body).toMatchObject({ name: 'ci-deploy', grants: ['schemas:read'], allowed_ips: ['10.0.0.0/8'], password: 'pw' });
		expect(body).not.toHaveProperty('mfa_code');
		expect(body).not.toHaveProperty('tenant_id');
		expect(new Date(String(body.expires_at)).getTime() - Date.now()).toBeGreaterThan(29 * 24 * 3600 * 1000);
	});

	it('sends the code instead of the password when the account has MFA', async () => {
		const { ev, fetch } = event({ 'POST /api/admin/admin-tokens': { status: 201, body: ISSUED } }, { ...VALID, step: 'mfa_code', mfa_code: ' 123456 ', password: '' });
		await actions.create(ev);
		const body = bodyOf(fetch, 'POST /api/admin/admin-tokens');
		expect(body.mfa_code).toBe('123456');
		expect(body).not.toHaveProperty('password');
	});

	it('names every missing field before calling the engine', async () => {
		const { ev, fetch } = event({}, { expiry: 'custom', expires_at: '', allowed_ips: 'nope', step: 'password' });
		const out = (await actions.create(ev)) as { status: number; data: { fields: Record<string, string> } };
		expect(out.status).toBe(400);
		expect(Object.keys(out.data.fields).sort()).toEqual(['allowed_ips', 'expires_at', 'grants', 'name', 'password']);
		expect(fetch.mock.calls.some(([u]) => String(u).includes('admin-tokens'))).toBe(false);
	});

	it('puts a wrong password on the password field', async () => {
		const { ev } = event({ 'POST /api/admin/admin-tokens': { status: 403, body: { error: 'The password is not valid.' } } }, VALID);
		const out = (await actions.create(ev)) as { status: number; data: { fields: Record<string, string> } };
		expect(out.status).toBe(400);
		expect(out.data.fields).toEqual({ password: 'That password is not right.' });
	});

	it('keeps a lockout a 429 and says so', async () => {
		const { ev } = event({ 'POST /api/admin/admin-tokens': { status: 429, body: { error: 'Too many failed password attempts. Try again later.' } } }, VALID);
		const out = (await actions.create(ev)) as { status: number; data: { error: string } };
		expect(out.status).toBe(429);
		expect(out.data.error).toContain('locked');
	});

	it('never echoes the password or the token in a refusal', async () => {
		const { ev } = event({ 'POST /api/admin/admin-tokens': { status: 422, body: { error: 'expires_at must be at most 90 days away.' } } }, VALID);
		const out = await actions.create(ev);
		expect(JSON.stringify(out)).not.toContain('"pw"');
	});
});

describe('the rotate action', () => {
	it('rotates with the new expiry and marks the result as a rotation', async () => {
		const { ev, fetch } = event({ 'POST /api/admin/admin-tokens/t1/rotate': { status: 201, body: ISSUED } }, { id: 't1', expiry: '7', step: 'password', password: 'pw' });
		const out = (await actions.rotate(ev)) as { issued: { rotated: boolean } };
		expect(out.issued.rotated).toBe(true);
		expect(bodyOf(fetch, 'POST /api/admin/admin-tokens/t1/rotate')).toMatchObject({ password: 'pw' });
	});

	it('explains a token that can no longer be rotated', async () => {
		const { ev } = event({ 'POST /api/admin/admin-tokens/t1/rotate': { status: 409, body: { error: 'A revoked or expired admin token cannot be rotated.' } } }, { id: 't1', expiry: '7', step: 'password', password: 'pw' });
		const out = (await actions.rotate(ev)) as { data: { error: string } };
		expect(out.data.error).toBe('A revoked or expired admin token cannot be rotated.');
	});
});

describe('the revoke action', () => {
	it('revokes, and says so plainly when it was already revoked', async () => {
		const ok = event({ 'DELETE /api/admin/admin-tokens/t1': { status: 204 } }, { id: 't1' });
		expect(await actions.revoke(ok.ev)).toEqual({ revoked: true });
		const again = event({ 'DELETE /api/admin/admin-tokens/t1': { status: 409, body: { error: 'This admin token is already revoked.' } } }, { id: 't1' });
		expect(((await actions.revoke(again.ev)) as { data: { error: string } }).data.error).toBe('This token was already revoked.');
	});

	it.each([500, 502, 503])('makes no claim about the change when the revoke meets a %i', async (status) => {
		const { ev } = event({ 'DELETE /api/admin/admin-tokens/t1': { status, body: { error: 'x' } } }, { id: 't1' });
		expect(((await actions.revoke(ev)) as { data: { error: string } }).data.error).toBe('Check whether the token was revoked, then try again.');
	});
});

describe('the load', () => {
	function loadEvent(roles: string[], replies: Record<string, Reply>, url = 'http://admin/admin/admin-tokens') {
		const { ev, fetch } = event(replies, {}, url);
		const user = { id: 'u1', email: 'a@b.test', roles, tenant_id: 'default' };
		return { ev: { ...(ev as object), fetch: signedIn(fetch, user) } as never, fetch };
	}

	it('refuses a role that cannot own a token', async () => {
		const { ev } = loadEvent(['editor'], {});
		await expect(load(ev)).rejects.toMatchObject({ status: 403 });
	});

	it('reads the list, the catalog and the MFA status, and no tenants for an admin', async () => {
		const { ev, fetch } = loadEvent(['admin'], {
			'GET /api/admin/admin-tokens': { status: 200, body: { data: [{ id: 't1' }], limit: 50, offset: 0, total_count: 1 } },
			'GET /api/admin/admin-tokens/grants': { status: 200, body: { data: [{ name: 'schemas:read', description: 'd', routes: [] }] } },
			'GET /api/admin/mfa/status': { status: 200, body: { enabled: true } },
		});
		const out = (await load(ev)) as Record<string, unknown>;
		expect(out).toMatchObject({ total: 1, mfaEnrolled: true, tenants: { ok: true, value: [] }, log: null, adminOrigin: 'http://admin' });
		expect(out.tokens).toMatchObject({ ok: true });
		expect(out.grants).toMatchObject({ ok: true, value: [{ name: 'schemas:read' }] });
		expect(fetch.mock.calls.some(([u]) => String(u).includes('/api/admin/tenants'))).toBe(false);
	});

	it('says the database is down rather than showing an empty list', async () => {
		const { ev } = loadEvent(['admin'], { 'GET /api/admin/admin-tokens': { status: 503, body: { error: 'x' } } });
		const out = (await load(ev)) as { tokens: unknown };
		expect(out.tokens).toEqual({ ok: false, gate: { state: 'unavailable' } });
	});

	it('keeps a failed grants read apart from a catalog with none', async () => {
		const { ev } = loadEvent(['admin'], {
			'GET /api/admin/admin-tokens': { status: 200, body: { data: [], total_count: 0 } },
			'GET /api/admin/admin-tokens/grants': { status: 500, body: { error: 'x' } },
		});
		const out = (await load(ev)) as { grants: { ok: boolean } };
		expect(out.grants.ok).toBe(false);
	});

	it('keeps a failed tenant read apart from an install with one tenant', async () => {
		const { ev } = loadEvent(['super_admin'], {
			'GET /api/admin/admin-tokens': { status: 200, body: { data: [], total_count: 0 } },
			'GET /api/admin/tenants': { status: 500, body: { error: 'x' } },
		});
		const out = (await load(ev)) as { tenants: { ok: boolean } };
		expect(out.tenants.ok).toBe(false);
	});

	it('sends a page past the end back to the last page that holds tokens', async () => {
		const { ev } = loadEvent(
			['admin'],
			{ 'GET /api/admin/admin-tokens': { status: 200, body: { data: [], total_count: 3 } } },
			'http://admin/admin/admin-tokens?offset=100'
		);
		await expect(load(ev)).rejects.toMatchObject({ status: 307, location: '/admin/admin-tokens?offset=0' });
	});

	it('reads the request log the URL names', async () => {
		const { ev } = loadEvent(
			['super_admin'],
			{
				'GET /api/admin/admin-tokens': { status: 200, body: { data: [], total_count: 0 } },
				'GET /api/admin/admin-tokens/t1/requests': { status: 200, body: { data: [{ id: 'r1' }], limit: 50, offset: 50, total_count: 51 } },
				'GET /api/admin/tenants': { status: 200, body: { data: [{ slug: 'default', name: 'Default', archived: false }, { slug: 'old', name: 'Old', archived: true }], total_count: 2 } },
			},
			'http://admin/admin/admin-tokens?log=t1&log_offset=50'
		);
		const out = (await load(ev)) as { log: { token: string; total: number; offset: number }; tenants: { ok: true; value: { slug: string }[] } };
		expect(out.log).toMatchObject({ token: 't1', total: 51, offset: 50 });
		expect(out.tenants.value.map((t) => t.slug)).toEqual(['default']);
	});

	it.each([
		[502, 'unavailable'],
		[504, 'unavailable'],
		[429, 'busy'],
		[404, 'absent'],
	])('says what a %i on the request log means', async (status, state) => {
		const { ev } = loadEvent(
			['super_admin'],
			{
				'GET /api/admin/admin-tokens': { status: 200, body: { data: [], total_count: 0 } },
				'GET /api/admin/admin-tokens/t1/requests': { status, body: { error: 'x' } },
				'GET /api/admin/tenants': { status: 200, body: { data: [], total_count: 0 } },
			},
			'http://admin/admin/admin-tokens?log=t1'
		);
		const out = (await load(ev)) as { log: { gate: { state: string } } };
		expect(out.log.gate.state).toBe(state);
	});

	it('sends a request log offset past the end back to its last page', async () => {
		const { ev } = loadEvent(
			['super_admin'],
			{
				'GET /api/admin/admin-tokens': { status: 200, body: { data: [], total_count: 0 } },
				'GET /api/admin/admin-tokens/t1/requests': { status: 200, body: { data: [], limit: 50, offset: 500, total_count: 51 } },
				'GET /api/admin/tenants': { status: 200, body: { data: [], total_count: 0 } },
			},
			'http://admin/admin/admin-tokens?log=t1&log_offset=500'
		);
		await expect(load(ev)).rejects.toMatchObject({ status: 307, location: '/admin/admin-tokens?log=t1&log_offset=50' });
	});
});
