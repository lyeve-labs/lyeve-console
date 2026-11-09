import { describe, expect, it, vi } from 'vitest';
import { actions } from './+page.server';

function event(status: number, body: unknown, form: Record<string, string>) {
	const fetch = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
	const data = new FormData();
	for (const [k, v] of Object.entries(form)) data.set(k, v);
	return { fetch, ev: { fetch, cookies: { get: (n: string) => (n === '__Host-sys_session' ? 'tok' : n === '__Host-csrf' ? 'c' : undefined) }, request: new Request('http://admin/admin/api-access', { method: 'POST', body: data }) } as never };
}

describe('API access token action', () => {
	it('hands back the token the engine issued', async () => {
		const { ev, fetch } = event(200, { token: 'jwt' }, { email: 'a@b.c', password: 'pw' });
		expect(await actions.token(ev)).toEqual({ token: 'jwt' });
		expect(fetch).toHaveBeenCalledOnce();
		const headers = (fetch.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>;
		expect(headers['X-CSRF-Token']).toBe('c');
	});

	it('asks for both fields before calling the engine', async () => {
		const { ev, fetch } = event(200, {}, { email: 'a@b.c' });
		const r = (await actions.token(ev)) as { status: number };
		expect(r.status).toBe(400);
		expect(fetch).not.toHaveBeenCalled();
	});

	it('relays a refusal and hides a server failure', async () => {
		const refused = event(401, { error: 'invalid credentials', code: 'unauthorized' }, { email: 'a@b.c', password: 'x' });
		expect(((await actions.token(refused.ev)) as { data: { tokenError: string } }).data.tokenError).toBe('invalid credentials');
		const broken = event(500, { error: 'pq: boom' }, { email: 'a@b.c', password: 'x' });
		expect(((await actions.token(broken.ev)) as { data: { tokenError: string } }).data.tokenError).toBe('Could not create the token. Try again.');
	});

	it.each([
		['answers 503', () => new Response(JSON.stringify({ error: 'dial tcp 10.0.0.4:5432: connection refused' }), { status: 503 })],
		['does not answer', () => Promise.reject(new TypeError('fetch failed'))],
	])('issues nothing and keeps the detail off the page when the engine %s', async (_case, answer) => {
		const { ev, fetch } = event(200, {}, { email: 'a@b.c', password: 'x' });
		fetch.mockImplementation(async () => answer());
		const r = (await actions.token(ev)) as { status: number; data: { tokenError: string } };
		expect(r.status).toBe(400);
		expect(r.data.tokenError).toBe('Could not create the token. Try again.');
	});
});
