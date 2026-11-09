import { describe, expect, it, vi } from 'vitest';
import type { Cookies } from '@sveltejs/kit';
import { actions, load } from './+page.server';
import type { PluginSet } from '$lib/plugins';
import type { EmailProvider } from '$lib/api/email';
import type { ConfigSetting } from './+page.server';

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

/** The session user the layout hands every load. */
const ADMIN = { id: 'u1', roles: ['admin'] };

const withEmail: PluginSet = { state: 'named', running: ['email'], withheld: [] };
const none: PluginSet = { state: 'named', running: [], withheld: [] };

const row = {
	id: 'p1',
	name: 'Primary',
	transport: 'api',
	api_base_url: 'https://api.example.test',
	from_addr: 'noreply@example.test',
	priority: 0,
	max_per_hour: 0,
	status: 'active',
};

function loadEvent(routes: Record<string, Route>, plugins = withEmail) {
	const { fetch } = fetchFor(routes);
	return { fetch, cookies: mockCookies(), url: new URL('http://localhost/admin/settings/email'), parent: async () => ({ plugins, user: ADMIN }) } as never;
}

function actionEvent(form: FormData, routes: Record<string, Route>) {
	const { fetch, calls } = fetchFor(routes);
	return { calls, event: { fetch, cookies: mockCookies(), request: { formData: async () => form, clone: () => ({ formData: async () => form }) }, url: new URL('http://localhost/admin/settings/email'), params: {} } as never };
}

function form(entries: Record<string, string | string[]>): FormData {
	const fd = new FormData();
	fd.set('confirmed', 'yes');
	for (const [k, v] of Object.entries(entries)) {
		for (const one of Array.isArray(v) ? v : [v]) fd.append(k, one);
	}
	return fd;
}

const sent = (calls: { url: string; init?: RequestInit }[], method: string) =>
	JSON.parse(String(calls.find((c) => c.init?.method === method)?.init?.body));

describe('admin/settings/email load', () => {
	it('lists the providers while the plugin runs', async () => {
		const result = (await load(loadEvent({ '/email/providers': () => json({ data: [row], total: 1 }) }))) as Loaded;
		expect(result.providers.ok && result.providers.value.map((p: EmailProvider) => p.name)).toEqual(['Primary']);
	});

	it('does not call the plugin while it does not run', async () => {
		const { fetch } = fetchFor({});
		const event = { fetch, cookies: mockCookies(), url: new URL('http://localhost/admin/settings/email'), parent: async () => ({ plugins: none, user: ADMIN }) } as never;
		const result = (await load(event)) as Loaded;
		expect(result.providers).toEqual({ ok: false, gate: { state: 'absent' } });
		expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.some((c) => String(c[0]).includes('/email/'))).toBe(false);
	});

	it('keeps a provider read that did not answer as an outage, never as an empty pool', async () => {
		const result = (await load(loadEvent({ '/email/providers': () => json({ error: 'down' }, 503) }))) as Loaded;
		expect(result.providers).toEqual({ ok: false, gate: { state: 'unavailable' } });
	});

	it('keeps a refused provider read as forbidden', async () => {
		const result = (await load(loadEvent({ '/email/providers': () => json({ error: 'forbidden' }, 403) }))) as Loaded;
		expect(result.providers).toEqual({ ok: false, gate: { state: 'forbidden' } });
	});
});

describe('admin/settings/email actions', () => {
	it('creates an api provider with the key in the body', async () => {
		const { event, calls } = actionEvent(
			form({ name: 'Api', transport: 'api', api_key: 'k_123', api_base_url: 'https://api.example.test', from_addr: 'a@b.c', priority: '0', max_per_hour: '0' }),
			{ '/email/providers': () => json(row, 201) },
		);
		const result = await actions.create(event);
		expect(result).toBeUndefined();
		expect(sent(calls, 'POST')).toMatchObject({ transport: 'api', api_base_url: 'https://api.example.test', api_key: 'k_123' });
	});

	it('updates without the key when it is kept, and relays a refusal', async () => {
		const { event, calls } = actionEvent(
			form({ id: 'p1', name: 'Api', transport: 'api', stored_transport: 'api', api_base_url: 'https://api.example.test', from_addr: 'a@b.c', priority: '0', max_per_hour: '0' }),
			{ '/email/providers/p1': () => json(row) },
		);
		expect(await actions.update(event)).toBeUndefined();
		const body = sent(calls, 'PUT');
		expect(body.api_base_url).toBe('https://api.example.test');
		expect('api_key' in body).toBe(false);

		const refused = actionEvent(
			form({ id: 'p1', name: 'Api', transport: 'api', api_key: 'k', api_base_url: 'https://api.example.test', from_addr: 'a@b.c', priority: '0', max_per_hour: '0' }),
			{ '/email/providers/p1': () => json({ error: 'Invalid api_base_url', code: 'bad_request' }, 400) },
		);
		const result = (await actions.update(refused.event)) as { status: number; data: { error: string } };
		expect(result.status).toBe(400);
		expect(result.data.error).toContain('api_base_url');
	});

	it('deletes by id', async () => {
		const { event, calls } = actionEvent(form({ id: 'p1' }), { '/email/providers/p1': () => new Response(null, { status: 204 }) });
		expect(await actions.delete(event)).toBeUndefined();
		expect(calls.some((c) => c.init?.method === 'DELETE' && c.url.endsWith('/email/providers/p1'))).toBe(true);
	});
});

// The fallback transport is configured on this page. A key no layer supplies
// still renders, a withheld secret carries no value, and a refusal from a
// higher layer is reported rather than swallowed.

// fetchFor answers /auth/me with a plain admin before it consults its routes,
// so the fallback section needs a fetch of its own: whether it renders at all
// turns on the role.
const asSuperAdmin = (routes: Record<string, Route>, plugins = withEmail) => {
	const calls: { url: string; init?: RequestInit }[] = [];
	const fetch = vi.fn(async (url: string, init?: RequestInit) => {
		const asked = String(url);
		calls.push({ url: asked, init });
		if (asked.includes('/auth/me')) return json({ id: 'u1', roles: ['super_admin'], disabled: false });
		for (const [needle, route] of Object.entries(routes)) if (asked.includes(needle)) return route(asked, init);
		return json({ error: 'no route' }, 404);
	}) as unknown as typeof globalThis.fetch;
	return {
		calls,
		event: {
			fetch,
			cookies: mockCookies(),
			request: { formData: async () => new FormData() },
			url: new URL('http://localhost/admin/settings/email'),
			params: {},
			parent: async () => ({ plugins, user: { id: 'u1', roles: ['super_admin'] } }),
		} as never,
	};
};

const superAdminAction = (form: FormData, routes: Record<string, Route>) => {
	const { event, calls } = asSuperAdmin(routes);
	(event as { request: { formData: () => Promise<FormData> } }).request = {
		formData: async () => form,
	};
	return { event, calls };
};

describe('admin/settings/email fallback transport', () => {
	const noProviders = { '/email/providers': () => json({ data: [], total: 0 }) };

	it('renders every mail setting, including the ones no layer supplies', async () => {
		const { event } = asSuperAdmin({
			...noProviders,
			'/admin/config': () => json({ settings: [{ key: 'SMTP_HOST', source: 'admin', value: 'relay', editable: true }] }),
		});
		const result = (await load(event)) as Loaded;
		const mail = result.mail?.ok ? result.mail.value : [];
		expect(mail.map((s: ConfigSetting) => s.key)).toEqual([
			'SMTP_HOST',
			'SMTP_PORT',
			'SMTP_USER',
			'SMTP_PASS',
			'SMTP_FROM',
			'SMTP_TLS',
		]);
		expect(mail[0].value).toBe('relay');
		expect(mail[1].source).toBe('default');
	});

	it('says the transport could not be read when the config read fails', async () => {
		const { event } = asSuperAdmin({ ...noProviders, '/admin/config': () => json({ error: 'down' }, 503) });
		const result = (await load(event)) as Loaded;
		expect(result.mail).toEqual({ ok: false, gate: { state: 'unavailable' } });
	});

	it('hides the section from anyone but a super admin rather than failing the page', async () => {
		const result = (await load(loadEvent(noProviders))) as Loaded;
		expect(result.mail).toBeNull();
		expect(result.providers.ok).toBe(true);
	});

	it('carries no value for a setting the engine withholds', async () => {
		const { event } = asSuperAdmin({
			...noProviders,
			'/admin/config': () => json({ settings: [{ key: 'SMTP_PASS', source: 'admin', editable: true, secret: true }] }),
		});
		const result = (await load(event)) as Loaded;
		const pass = (result.mail?.ok ? result.mail.value : []).find((s: ConfigSetting) => s.key === 'SMTP_PASS');
		expect(pass?.secret).toBe(true);
		expect(pass?.value).toBeUndefined();
	});

	it('takes a mail setting', async () => {
		const { event, calls } = superAdminAction(form({ key: 'SMTP_HOST', value: 'relay.internal', secret: 'false' }), {
			'/admin/config': () => json({}),
		});
		expect(await actions.saveSetting(event)).toEqual({ success: true, key: 'SMTP_HOST' });
		expect(sent(calls, 'PUT')).toEqual({ values: { SMTP_HOST: 'relay.internal' } });
	});

	it('refuses a key this page does not own', async () => {
		const { event } = superAdminAction(form({ key: 'DATABASE_URL', value: 'x', secret: 'false' }), {
			'/admin/config': () => json({}),
		});
		expect(await actions.saveSetting(event)).toMatchObject({ status: 400 });
	});

	it('refuses a blank secret rather than unsetting the stored one', async () => {
		const { event } = superAdminAction(form({ key: 'SMTP_PASS', value: '', secret: 'true' }), {
			'/admin/config': () => json({}),
		});
		expect(await actions.saveSetting(event)).toMatchObject({ status: 400 });
	});

	it('reports the engine refusing a key a higher layer pins', async () => {
		const { event } = superAdminAction(form({ key: 'SMTP_HOST', value: 'relay', secret: 'false' }), {
			'/admin/config': () =>
				json({ refused: [{ key: 'SMTP_HOST', reason: 'set by an environment variable, which always wins' }] }),
		});
		const result = (await actions.saveSetting(event)) as { status: number; data: { error: string } };
		expect(result.status).toBe(409);
		expect(result.data.error).toContain('environment variable');
	});

	it('reads the refusal from a 409 whose only key was refused', async () => {
		const { event } = superAdminAction(form({ key: 'SMTP_HOST', value: 'relay', secret: 'false' }), {
			'/admin/config': () => json({ refused: [{ key: 'SMTP_HOST', reason: 'set by the environment', origin: 'SMTP_HOST' }] }, 409),
		});
		const result = (await actions.saveSetting(event)) as { status: number; data: { error: string } };
		expect(result.status).toBe(409);
		expect(result.data.error).toBe('set by the environment (SMTP_HOST)');
	});

	it('keeps an engine failure out of the message', async () => {
		const { event } = superAdminAction(form({ key: 'SMTP_HOST', value: 'relay', secret: 'false' }), {
			'/admin/config': () => json({ error: 'pq: relation "sys_config" does not exist' }, 503),
		});
		const result = (await actions.saveSetting(event)) as { status: number; data: { error: string } };
		expect(result.status).toBe(502);
		expect(result.data.error).toBe('Could not save the setting. Try again.');
	});
});
