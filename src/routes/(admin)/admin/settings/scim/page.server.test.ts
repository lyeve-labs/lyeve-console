import { describe, expect, it, vi } from 'vitest';

const authz = vi.hoisted(() => ({ requireRole: vi.fn() }));
vi.mock('$lib/server/authz', async () => {
	const { createClient } = await vi.importActual<typeof import('@lyeve-labs/client')>('@lyeve-labs/client');
	return {
		requireRole: authz.requireRole,
		authedClient: (event: { fetch: typeof fetch }) => createClient(event.fetch),
	};
});

import { actions, load } from './+page.server';

function event(body: unknown, search: string) {
	return {
		fetch: vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })),
		url: new URL(`http://admin/admin/settings/scim${search}`),
		parent: async () => ({ plugins: { state: 'named', running: ['scim'], withheld: [] } }),
	} as never;
}

describe('SCIM load', () => {
	function read(saml: Response, running = ['scim', 'saml']) {
		const fetch = vi.fn(async (url: string) =>
			String(url).startsWith('/api/admin/saml-providers') ? saml.clone() : json({ data: [], total_count: 0 }),
		);
		return {
			fetch,
			url: new URL('http://admin/admin/settings/scim'),
			parent: async () => ({ plugins: { state: 'named', running, withheld: [] } }),
		} as never;
	}

	it('offers the SAML providers a connection can be linked to', async () => {
		const out = (await load(read(json({ data: [{ id: 's1', name: 'okta' }], total_count: 1 })))) as { saml: unknown };
		expect(out.saml).toEqual({ state: 'ok', providers: [{ id: 's1', name: 'okta' }] });
	});

	it('offers no link when SAML does not run or is not enabled', async () => {
		const off = (await load(read(json({}), ['scim']))) as { saml: unknown };
		expect(off.saml).toEqual({ state: 'off' });
		const locked = (await load(read(json({ error: 'not enabled' }, 402)))) as { saml: unknown };
		expect(locked.saml).toEqual({ state: 'off' });
	});

	it('says the SAML providers could not be read when the read fails', async () => {
		const out = (await load(read(json({ error: 'down' }, 503)))) as { saml: unknown };
		expect(out.saml).toEqual({ state: 'failed' });
	});

	it('sends a page past the end back to the last page that holds connections', async () => {
		await expect(load(event({ data: [], total_count: 3 }, '?offset=50&limit=25'))).rejects.toMatchObject({
			status: 307,
			location: '/admin/settings/scim?offset=0&limit=25',
		});
	});
});

type Call = { method: string; path: string; body: unknown };
type Failure = { status: number; data: { action: string; error: string } };

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** An action event against a fake engine that records each request and answers it with `reply`. */
function write(fields: Record<string, string>, reply: Response = json({})) {
	const calls: Call[] = [];
	const fetch = vi.fn(async (url: string, init?: RequestInit) => {
		calls.push({ method: init?.method ?? 'GET', path: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
		return reply.clone();
	});
	const form = new FormData();
	form.set('confirmed', 'yes');
	for (const [k, v] of Object.entries(fields)) form.set(k, v);
	const url = new URL('http://admin/admin/settings/scim');
	return { calls, event: { fetch, url, request: new Request(url, { method: 'POST', body: form }) } as never };
}

const TOKEN = 'x'.repeat(32);
const CONNECTION = { id: 'c1', name: ' Okta ', bearer_token: TOKEN, new_token: TOKEN, deprovision_action: 'disable', deprovision_on_delete: 'true' };
const OUTAGE = json({ error: 'dial tcp 10.0.0.4:5432: connection refused' }, 503);

describe('SCIM writes', () => {
	it.each(['create', 'rotate', 'delete'] as const)('holds %s to a super admin', async (name) => {
		authz.requireRole.mockRejectedValueOnce(Object.assign(new Error('403'), { status: 403 }));
		const { event, calls } = write(CONNECTION);
		await expect(actions[name](event)).rejects.toMatchObject({ status: 403 });
		expect(authz.requireRole).toHaveBeenLastCalledWith(event, ['super_admin']);
		expect(calls).toEqual([]);
	});

	it('creates a connection with its token and what deprovisioning does', async () => {
		const { event, calls } = write(CONNECTION);
		expect(await actions.create(event)).toEqual({ saved: 'Okta' });
		expect(calls).toEqual([
			{
				method: 'POST',
				path: '/api/admin/scim/providers',
				body: { name: 'Okta', bearer_token: TOKEN, deprovision_on_delete: true, deprovision_action: 'disable' },
			},
		]);
	});

	it('links the connection to the chosen SAML provider', async () => {
		const { event, calls } = write({ ...CONNECTION, saml_provider_id: 's1' });
		expect(await actions.create(event)).toEqual({ saved: 'Okta' });
		expect(calls[0].body).toMatchObject({ saml_provider_id: 's1' });
	});

	it.each([
		[{ name: ' ' }, 'Enter a name for the connection'],
		[{ bearer_token: 'short' }, 'Enter a token of at least 32 characters.'],
		[{ deprovision_action: 'shred' }, 'Choose what happens to a deprovisioned account.'],
	])('refuses %o before it creates anything', async (over, sentence) => {
		const { event, calls } = write({ ...CONNECTION, ...over });
		const out = (await actions.create(event)) as Failure;
		expect(out.data.action).toBe('create');
		expect(out.data.error).toContain(sentence);
		expect(calls).toEqual([]);
	});

	it('rotates the named connection to the new token', async () => {
		const { event, calls } = write(CONNECTION);
		expect(await actions.rotate(event)).toEqual({ rotated: 'c1' });
		expect(calls).toEqual([{ method: 'POST', path: '/api/admin/scim/providers/c1/rotate', body: { new_token: TOKEN } }]);
	});

	it('refuses a short replacement token, which would lock the directory out', async () => {
		const { event, calls } = write({ ...CONNECTION, new_token: 'short' });
		const out = (await actions.rotate(event)) as Failure;
		expect(out.data.action).toBe('rotate');
		expect(out.data.error).toContain('The old token stops working');
		expect(calls).toEqual([]);
	});

	it('deletes the named connection', async () => {
		const { event, calls } = write({ id: 'c1' });
		expect(await actions.delete(event)).toEqual({ removed: 'c1' });
		expect(calls).toEqual([{ method: 'DELETE', path: '/api/admin/scim/providers/c1', body: undefined }]);
	});

	it.each(['rotate', 'delete'] as const)('names nothing to %s without a request', async (name) => {
		const { event, calls } = write({ ...CONNECTION, id: '' });
		expect(((await actions[name](event)) as Failure).data).toEqual({ action: name, error: 'This form is missing its connection. Reload the page and try again.' });
		expect(calls).toEqual([]);
	});

	it.each(['create', 'rotate', 'delete'] as const)('relays the engine refusal on %s under its action', async (name) => {
		const { event } = write(CONNECTION, json({ error: 'connection name already in use', code: 'conflict' }, 409));
		const out = (await actions[name](event)) as Failure;
		expect(out.data).toEqual({ action: name, error: 'connection name already in use' });
	});

	it.each([
		['create', 'Could not create the connection. Try again.'],
		['rotate', 'Could not rotate the token. Try again.'],
		['delete', 'Could not delete the connection. Try again.'],
	] as const)('keeps outage detail off the page on %s', async (name, sentence) => {
		const { event } = write(CONNECTION, OUTAGE);
		expect(((await actions[name](event)) as Failure).data).toEqual({ action: name, error: sentence });
	});
});
