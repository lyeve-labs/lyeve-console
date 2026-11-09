import { describe, expect, it, vi } from 'vitest';
import type { Cookies } from '@sveltejs/kit';
import { actions, load } from './+page.server';
import type { Datasource } from '$lib/api/flows';

type Loaded = Exclude<Awaited<ReturnType<typeof load>>, void>;

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function mockCookies(): Cookies {
	return { get: vi.fn(() => 'tok'), set: vi.fn(), delete: vi.fn(), getAll: vi.fn(() => []), serialize: vi.fn(() => '') } as unknown as Cookies;
}

type Route = (url: string, init?: RequestInit) => Response;

function fetchFor(routes: Record<string, Route>) {
	const calls: { url: string; init?: RequestInit }[] = [];
	const fetch = vi.fn(async (url: string, init?: RequestInit) => {
		const asked = String(url);
		calls.push({ url: asked, init });
		if (asked.includes('/auth/me')) return json({ id: 'u1', roles: ['admin'], disabled: false });
		for (const [needle, route] of Object.entries(routes)) if (asked.includes(needle)) return route(asked, init);
		return json({ error: 'no route' }, 404);
	}) as unknown as typeof globalThis.fetch;
	return { fetch, calls };
}

const datasource = {
	id: 'd1',
	name: 'warehouse',
	kind: 'postgres',
	config: { host: 'db.example.test', port: 5432, database: 'wh', user: 'ro', ssl: 'require' },
	has_secret: true,
	allow_writes: false,
	allow_private: false,
	created_at: '2026-09-01T00:00:00Z',
	updated_at: '2026-09-01T00:00:00Z',
};

function loadEvent(routes: Record<string, Route>) {
	const { fetch } = fetchFor(routes);
	return { fetch, cookies: mockCookies(), url: new URL('http://localhost/admin/flows/datasources'), parent: async () => ({}) } as never;
}

function actionEvent(form: FormData, routes: Record<string, Route>) {
	const { fetch, calls } = fetchFor(routes);
	return { calls, event: { fetch, cookies: mockCookies(), request: { formData: async () => form, clone: () => ({ formData: async () => form }) }, url: new URL('http://localhost/admin/flows/datasources'), params: {} } as never };
}

const body = (calls: { url: string; init?: RequestInit }[], method: string) =>
	JSON.parse(String(calls.find((c) => c.init?.method === method)?.init?.body));

describe('admin/flows/datasources load', () => {
	it('lists the datasources', async () => {
		const result = (await load(loadEvent({ '/datasources': () => json({ data: [datasource] }) }))) as Loaded;
		expect(result.datasources.map((d: Datasource) => d.name)).toEqual(['warehouse']);
		expect(result.locked).toBe(false);
	});

	it('takes from the list whether datasources are enabled, and reads a list without the flag as enabled', async () => {
		const off = (await load(loadEvent({ '/datasources': () => json({ data: [], total_count: 0, limit: 0, offset: 0, enabled: false }) }))) as Loaded;
		expect(off.available).toBe(false);
		expect(off.datasources).toEqual([]);
		expect(off.locked).toBe(false);
		const on = (await load(loadEvent({ '/datasources': () => json({ data: [datasource], total_count: 1, limit: 1, offset: 0, enabled: true }) }))) as Loaded;
		expect(on.available).toBe(true);
		const older = (await load(loadEvent({ '/datasources': () => json({ data: [datasource] }) }))) as Loaded;
		expect(older.available).toBe(true);
		expect(older.datasources).toHaveLength(1);
	});

	it('reads nothing but the list', async () => {
		const { fetch, calls } = fetchFor({ '/datasources': () => json({ data: [], enabled: false }) });
		await load({ fetch, cookies: mockCookies(), url: new URL('http://localhost/admin/flows/datasources'), parent: async () => ({}) } as never);
		expect(calls.map((c) => new URL(c.url, 'http://x').pathname)).toEqual(['/api/admin/flows/datasources']);
	});

	it('leaves a failed read enabled, so the banner is what the page draws', async () => {
		const result = (await load(loadEvent({ '/datasources': () => json({ error: 'x' }, 503) }))) as Loaded;
		expect(result.available).toBe(true);
		expect(result.gate.state).not.toBe('ok');
	});

	it('maps a 402 to the locked state', async () => {
		const result = (await load(loadEvent({ '/datasources': () => json({ error: 'nope' }, 402) }))) as Loaded;
		expect(result.locked).toBe(true);
		expect(result.datasources).toEqual([]);
		expect(result.gate).toEqual({ state: 'ok' });
	});

	it('sends an expired session to the login page with the cookie cleared', async () => {
		const event = loadEvent({ '/datasources': () => json({ error: 'unauthorized' }, 401) });
		await expect(load(event)).rejects.toMatchObject({ status: 302, location: '/login' });
		expect((event as { cookies: Cookies }).cookies.delete).toHaveBeenCalledWith('__Host-sys_session', expect.objectContaining({ path: '/' }));
	});

	it('names the role as the reason for a 403', async () => {
		const result = (await load(loadEvent({ '/datasources': () => json({ error: 'forbidden' }, 403) }))) as Loaded;
		expect(result.locked).toBe(false);
		expect(result.gate).toEqual({ state: 'forbidden' });
	});

	it('keeps the engine banner for a network failure', async () => {
		const result = (await load(
			loadEvent({
				'/datasources': () => {
					throw new TypeError('fetch failed');
				},
			})
		)) as Loaded;
		expect(result.gate).toEqual({ state: 'unavailable' });
	});

	it('reports a failed read as a static message rather than an empty list', async () => {
		const result = (await load(loadEvent({ '/datasources': () => json({ error: 'pq: connection refused' }, 503) }))) as Loaded;
		expect(result.locked).toBe(false);
		expect(result.gate).toEqual({ state: 'unavailable' });
	});
});

describe('admin/flows/datasources actions', () => {
	it('create renders a refusal as not enabled, and never names the capability the body carries', async () => {
		const form = new FormData();
		form.set('name', 'warehouse');
		form.set('kind', 'postgres');
		form.set('host', 'db.example.test');
		form.set('database', 'wh');
		form.set('user', 'ro');
		const { event } = actionEvent(form, { '/datasources': () => json({ error: 'payment_required', plugin: 'flow', feature: 'example-capability', errors: [] }, 402) });
		const result = (await actions.create(event)) as { status: number; data: { error: string; refused: boolean } };
		expect(result.status).toBe(402);
		expect(result.data.refused).toBe(true);
		expect(result.data.error).toBe('Datasources are not enabled on this engine.');
		expect(result.data.error).not.toContain('example-capability');
	});

	it('update and test render a refusal the same way', async () => {
		const form = new FormData();
		form.set('id', 'd1');
		form.set('name', 'warehouse');
		form.set('kind', 'postgres');
		form.set('host', 'db.example.test');
		form.set('database', 'wh');
		const refused = () => json({ error: 'payment_required', plugin: 'flow', feature: 'example-capability', errors: [] }, 402);
		const update = (await actions.update(actionEvent(form, { '/datasources/d1': refused }).event)) as { status: number; data: { refused: boolean } };
		expect(update.status).toBe(402);
		expect(update.data.refused).toBe(true);
		const test = (await actions.test(actionEvent(form, { '/datasources/d1/test': refused }).event)) as { status: number; data: { refused: boolean } };
		expect(test.status).toBe(402);
		expect(test.data.refused).toBe(true);
	});

	it('create splits a database into config and the encrypted secret', async () => {
		const form = new FormData();
		form.set('name', 'warehouse');
		form.set('kind', 'postgres');
		form.set('host', 'db.example.test');
		form.set('port', '5432');
		form.set('database', 'wh');
		form.set('user', 'ro');
		form.set('ssl', 'prefer');
		form.set('password', 'hunter2');
		form.set('allow_writes', 'false');
		form.set('allow_private', 'true');
		const { event, calls } = actionEvent(form, { '/datasources': () => json(datasource) });
		await actions.create(event);
		expect(body(calls, 'POST')).toEqual({
			name: 'warehouse',
			kind: 'postgres',
			config: { host: 'db.example.test', port: 5432, database: 'wh', user: 'ro', ssl: 'prefer' },
			secret: { password: 'hunter2' },
			allow_writes: false,
			allow_private: true,
		});
	});

	it.each([
		['postgres', 'require'],
		['mysql', 'true'],
		['mssql', 'true'],
	])('create sends the TLS mode as the string %s expects, defaulting to %s', async (kind, fallback) => {
		const form = new FormData();
		form.set('name', 'db');
		form.set('kind', kind);
		form.set('host', 'db');
		form.set('database', 'wh');
		const { event, calls } = actionEvent(form, { '/datasources': () => json(datasource) });
		await actions.create(event);
		expect(body(calls, 'POST').config.ssl).toBe(fallback);
	});

	it('create accepts skip-verify for mysql and refuses it for postgres', async () => {
		const mysql = new FormData();
		mysql.set('name', 'db');
		mysql.set('kind', 'mysql');
		mysql.set('host', 'db');
		mysql.set('database', 'wh');
		mysql.set('ssl', 'skip-verify');
		const ok = actionEvent(mysql, { '/datasources': () => json(datasource) });
		await actions.create(ok.event);
		expect(body(ok.calls, 'POST').config.ssl).toBe('skip-verify');

		const pg = new FormData();
		pg.set('name', 'db');
		pg.set('kind', 'postgres');
		pg.set('host', 'db');
		pg.set('database', 'wh');
		pg.set('ssl', 'skip-verify');
		const refused = actionEvent(pg, { '/datasources': () => json(datasource) });
		const result = (await actions.create(refused.event)) as { status: number; data: { error: string } };
		expect(result.status).toBe(400);
		expect(result.data.error).toContain('require, prefer, disable');
		expect(refused.calls.some((c) => c.init?.method === 'POST')).toBe(false);
	});

	it('update leaves a blank password out so the stored one is kept', async () => {
		const form = new FormData();
		form.set('id', 'd1');
		form.set('name', 'warehouse');
		form.set('kind', 'mysql');
		form.set('host', 'db');
		form.set('database', 'wh');
		form.set('password', '');
		const { event, calls } = actionEvent(form, { '/datasources/d1': () => json(datasource) });
		await actions.update(event);
		const sent = body(calls, 'PUT');
		expect(sent.secret).toBeUndefined();
		expect(sent.kind).toBe('mysql');
	});

	it('create sorts HTTP headers into plain and secret by the per-header toggle', async () => {
		const form = new FormData();
		form.set('name', 'inventory');
		form.set('kind', 'http');
		form.set('base_url', 'https://inventory.example.test');
		form.append('header_key', 'Accept');
		form.append('header_value', 'application/json');
		form.append('header_secret', 'false');
		form.append('header_key', 'Authorization');
		form.append('header_value', 'Bearer x');
		form.append('header_secret', 'true');
		const { event, calls } = actionEvent(form, { '/datasources': () => json(datasource) });
		await actions.create(event);
		const sent = body(calls, 'POST');
		expect(sent.config).toEqual({ base_url: 'https://inventory.example.test', headers: { Accept: 'application/json' } });
		expect(sent.secret).toEqual({ headers: { Authorization: 'Bearer x' } });
	});

	function httpForm(auth: Record<string, string>, id?: string): FormData {
		const form = new FormData();
		if (id) form.set('id', id);
		form.set('name', 'inventory');
		form.set('kind', 'http');
		form.set('base_url', 'https://inventory.example.test');
		form.append('header_key', 'Accept');
		form.append('header_value', 'application/json');
		form.append('header_secret', 'false');
		for (const [k, v] of Object.entries(auth)) form.set(k, v);
		return form;
	}

	it('create carries a chat id on an http datasource and leaves it out when blank', async () => {
		const withChat = httpForm({ auth_type: 'none', chat_id: '@releases' });
		const { event, calls } = actionEvent(withChat, { '/datasources': () => json(datasource) });
		await actions.create(event);
		expect(body(calls, 'POST').config).toEqual({ base_url: 'https://inventory.example.test', chat_id: '@releases', headers: { Accept: 'application/json' } });

		const blank = actionEvent(httpForm({ auth_type: 'none', chat_id: '  ' }), { '/datasources': () => json(datasource) });
		await actions.create(blank.event);
		expect('chat_id' in body(blank.calls, 'POST').config).toBe(false);
	});

	it('create sends no auth block for none', async () => {
		const { event, calls } = actionEvent(httpForm({ auth_type: 'none' }), { '/datasources': () => json(datasource) });
		await actions.create(event);
		const sent = body(calls, 'POST');
		expect(sent.config).toEqual({ base_url: 'https://inventory.example.test', headers: { Accept: 'application/json' } });
		expect(sent.secret).toBeUndefined();
	});

	it('create splits a bearer token into the clear scheme and the encrypted token', async () => {
		const { event, calls } = actionEvent(httpForm({ auth_type: 'bearer', auth_token: 'tok-1' }), { '/datasources': () => json(datasource) });
		await actions.create(event);
		const sent = body(calls, 'POST');
		expect(sent.config.auth).toEqual({ type: 'bearer' });
		expect(sent.secret).toEqual({ token: 'tok-1' });
	});

	it('create keeps the basic user in the clear and the password in the secret', async () => {
		const { event, calls } = actionEvent(httpForm({ auth_type: 'basic', auth_user: 'svc', auth_password: 'pw' }), { '/datasources': () => json(datasource) });
		await actions.create(event);
		const sent = body(calls, 'POST');
		expect(sent.config.auth).toEqual({ type: 'basic', user: 'svc' });
		expect(sent.secret).toEqual({ password: 'pw' });
	});

	it('create sends OAuth2 with the scopes as a list and the client secret encrypted', async () => {
		const { event, calls } = actionEvent(
			httpForm({
				auth_type: 'oauth2_client_credentials',
				auth_token_url: 'https://auth.example.test/token',
				auth_client_id: 'cid',
				auth_client_secret: 'cs',
				auth_scopes: 'read  write,admin',
				auth_audience: 'https://api.example.test',
			}),
			{ '/datasources': () => json(datasource) }
		);
		await actions.create(event);
		const sent = body(calls, 'POST');
		expect(sent.config.auth).toEqual({
			type: 'oauth2_client_credentials',
			token_url: 'https://auth.example.test/token',
			client_id: 'cid',
			scopes: ['read', 'write', 'admin'],
			audience: 'https://api.example.test',
		});
		expect(sent.secret).toEqual({ client_secret: 'cs' });
	});

	it('update leaves a blank auth secret out so the stored one is kept, beside a secret header', async () => {
		const form = httpForm({ auth_type: 'bearer', auth_token: '' }, 'd2');
		form.append('header_key', 'X-Api-Key');
		form.append('header_value', 'k');
		form.append('header_secret', 'true');
		const { event, calls } = actionEvent(form, { '/datasources/d2': () => json(datasource) });
		await actions.update(event);
		const sent = body(calls, 'PUT');
		expect(sent.config.auth).toEqual({ type: 'bearer' });
		expect(sent.secret).toEqual({ headers: { 'X-Api-Key': 'k' } });
	});

	it('reads a refused name out of the 422 list and never relays the JSON text', async () => {
		const refused = { ok: false, errors: [{ path: '/name', message: 'a name of the shape [a-z][a-z0-9_-]{0,39} is required' }] };
		const { event } = actionEvent(httpForm({ name: 'Orders DB' }), { '/datasources': () => json(refused, 422) });
		const result = (await actions.create(event)) as { status: number; data: { error: string; nameError: string } };
		expect(result.status).toBe(422);
		expect(result.data.nameError).toContain('Start the name with a lower case letter');
		expect(result.data.error).not.toContain('{');
	});

	it('relays a refused secret in the plugin words on an update', async () => {
		const refused = { ok: false, errors: [{ path: '/secret', message: 'invalid datasource config: secret.token is required for bearer auth' }] };
		const { event } = actionEvent(httpForm({ auth_type: 'bearer' }, 'd2'), { '/datasources/d2': () => json(refused, 422) });
		const result = (await actions.update(event)) as { status: number; data: { error: string; nameError: string } };
		expect(result.status).toBe(422);
		expect(result.data).toMatchObject({ error: 'invalid datasource config: secret.token is required for bearer auth', nameError: '' });
	});

	it('refuses a scheme missing what it cannot work without, before the engine sees it', async () => {
		for (const [auth, message] of [
			[{ auth_type: 'basic', auth_password: 'pw' }, 'Enter a user'],
			[{ auth_type: 'oauth2_client_credentials', auth_client_id: 'cid' }, 'token URL'],
			[{ auth_type: 'digest' }, 'authentication type'],
		] as const) {
			const { event, calls } = actionEvent(httpForm({ ...auth }), { '/datasources': () => json(datasource) });
			const result = (await actions.create(event)) as { status: number; data: { error: string } };
			expect(result.status).toBe(400);
			expect(result.data.error).toContain(message);
			expect(calls.some((c) => c.init?.method === 'POST')).toBe(false);
		}
	});

	it('create carries the service account JSON as the secret of a sheets datasource', async () => {
		const form = new FormData();
		form.set('name', 'sheets');
		form.set('kind', 'google_sheets');
		form.set('service_account_json', '{"type":"service_account"}');
		const { event, calls } = actionEvent(form, { '/datasources': () => json(datasource) });
		await actions.create(event);
		const sent = body(calls, 'POST');
		expect(sent.config).toEqual({});
		expect(sent.secret).toEqual({ service_account_json: '{"type":"service_account"}' });
	});

	it('create refuses a missing host before calling the engine', async () => {
		const form = new FormData();
		form.set('name', 'x');
		form.set('kind', 'postgres');
		const { event, calls } = actionEvent(form, {});
		const result = (await actions.create(event)) as { status: number; data: { error: string } };
		expect(result.status).toBe(400);
		expect(result.data.error).toContain('Enter a host');
		expect(calls.some((c) => c.init?.method === 'POST')).toBe(false);
	});

	it('create relays the engine message on refusal', async () => {
		const form = new FormData();
		form.set('name', 'x');
		form.set('kind', 'http');
		form.set('base_url', 'https://x');
		const { event } = actionEvent(form, { '/datasources': () => json({ error: 'name already exists', code: 'conflict' }, 409) });
		const result = (await actions.create(event)) as { status: number; data: { error: string } };
		expect(result.data.error).toBe('name already exists');
	});

	it('test reports the engine answer keyed by id', async () => {
		const form = new FormData();
		form.set('id', 'd1');
		const { event } = actionEvent(form, { '/datasources/d1/test': () => json({ ok: true, latency_ms: 8, error: '' }) });
		const result = (await actions.test(event)) as { testResult: { id: string; ok: boolean; latency_ms: number } };
		expect(result.testResult).toEqual({ id: 'd1', ok: true, latency_ms: 8, error: '' });
	});

	it('delete removes by id', async () => {
		const form = new FormData();
		form.set('confirmed', 'yes');
		form.set('id', 'd1');
		const { event, calls } = actionEvent(form, { '/datasources/d1': () => new Response(null, { status: 204 }) });
		await actions.delete(event);
		expect(calls.find((c) => c.init?.method === 'DELETE')?.url).toContain('/datasources/d1');
	});
});
