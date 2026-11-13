import { describe, expect, it, vi } from 'vitest';
import type { Cookies } from '@sveltejs/kit';
import { actions, load } from './+page.server';
import { fixtureFlow, fixtureTemplates, joinFlow } from '$lib/flow/fixtures';
import type { Flow } from '$lib/api/flows';

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function mockCookies(): Cookies {
	return {
		get: vi.fn((name: string) => (name === 'csrf' ? 'csrf-token' : 'tok')),
		set: vi.fn(),
		delete: vi.fn(),
		getAll: vi.fn(() => []),
		serialize: vi.fn(() => ''),
	} as unknown as Cookies;
}

type Route = (url: string, init?: RequestInit) => Response | Promise<Response>;

/** A fetch that answers by path, recording every call. */
function fetchFor(routes: Record<string, Route>) {
	const calls: { url: string; init?: RequestInit }[] = [];
	const fetch = vi.fn(async (url: string, init?: RequestInit) => {
		const asked = String(url);
		calls.push({ url: asked, init });
		if (asked.includes('/auth/me')) return json({ id: 'u1', roles: ['admin'], disabled: false });
		for (const [needle, route] of Object.entries(routes)) {
			if (asked.includes(needle)) return route(asked, init);
		}
		return json({ error: 'no route' }, 404);
	}) as unknown as typeof globalThis.fetch;
	return { fetch, calls };
}

function loadEvent(routes: Record<string, Route>, search = '') {
	const { fetch, calls } = fetchFor(routes);
	return {
		calls,
		event: {
			fetch,
			cookies: mockCookies(),
			url: new URL(`http://localhost/admin/flows${search}`),
			parent: async () => ({ user: { roles: ['super_admin'] } }),
		} as never,
	};
}

function actionEvent(routes: Record<string, Route>, form: FormData) {
	const { fetch, calls } = fetchFor(routes);
	return {
		calls,
		event: {
			fetch,
			cookies: mockCookies(),
			request: { formData: async () => form, clone: () => ({ formData: async () => form }) },
			url: new URL('http://localhost/admin/flows'),
			params: {},
		} as never,
	};
}

type Loaded = Exclude<Awaited<ReturnType<typeof load>>, void>;

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ ...fixtureFlow, id: `f${i}`, slug: `flow_${i}` }));

describe('admin/flows load', () => {
	it('lists the flows inside the window and states the total', async () => {
		const { event, calls } = loadEvent({ '/api/admin/flows?': () => json({ data: rows(2), total: 2 }) }, '?limit=10');
		const result = (await load(event)) as Loaded;
		expect(result.flows.map((f: Flow) => f.id)).toEqual(['f0', 'f1']);
		expect(result.total).toBe(2);
		expect(result.hasMore).toBe(false);
		expect(result.locked).toBe(false);
		expect(calls[0].url).toContain('limit=11');
		expect(calls[0].url).toContain('offset=0');
	});

	it('keeps the probe row out and reports another page', async () => {
		const { event } = loadEvent({ '/api/admin/flows?': () => json(rows(11)) }, '?limit=10');
		const result = (await load(event)) as Loaded;
		expect(result.flows).toHaveLength(10);
		expect(result.hasMore).toBe(true);
		expect(result.total).toBeNull();
	});

	it('never asks for the templates: they are the editor\'s question, not the list\'s', async () => {
		const empty = loadEvent({
			'/api/admin/flows/templates': () => json({ data: fixtureTemplates }),
			'/api/admin/flows?': () => json({ data: [], total: 0 }),
		});
		const result = (await load(empty.event)) as Loaded;
		expect(result.flows).toEqual([]);
		expect('templates' in result).toBe(false);
		expect(empty.calls.some((c) => c.url.includes('/templates'))).toBe(false);
	});

	it('reads whether the caller may create beside the list, and a list without the flag as allowed', async () => {
		const refused = (await load(loadEvent({ '/api/admin/flows?': () => json({ data: [], total: 0, can_create: false }) }).event)) as { canCreate: boolean };
		expect(refused.canCreate).toBe(false);
		const unflagged = (await load(loadEvent({ '/api/admin/flows?': () => json({ data: [], total: 0 }) }).event)) as { canCreate: boolean };
		expect(unflagged.canCreate).toBe(true);
	});

	it('maps a 402 to the locked state instead of failing the page', async () => {
		const { event } = loadEvent({ '/api/admin/flows?': () => json({ error: 'payment required' }, 402) });
		const result = (await load(event)) as Loaded;
		expect(result.locked).toBe(true);
		expect(result.flows).toEqual([]);
	});

	it('reports a failed read as a static message rather than an empty tenant', async () => {
		const { event, calls } = loadEvent({
			'/api/admin/flows/templates': () => json({ data: fixtureTemplates }),
			'/api/admin/flows?': () => json({ error: 'pq: connection refused' }, 503),
		});
		const result = (await load(event)) as Loaded;
		expect(result.locked).toBe(false);
		expect(result.gate).toEqual({ state: 'unavailable' });
		expect(result.flows).toEqual([]);
		expect(calls.some((c) => c.url.includes('/templates'))).toBe(false);
	});

	it('sends an expired session to the login page with the cookie cleared, as the shell does', async () => {
		const { event } = loadEvent({ '/api/admin/flows?': () => json({ error: 'unauthorized' }, 401) });
		await expect(load(event)).rejects.toMatchObject({ status: 302, location: '/login' });
		expect((event as { cookies: Cookies }).cookies.delete).toHaveBeenCalledWith('__Host-sys_session', expect.objectContaining({ path: '/' }));
	});

	it('names the role as the reason for a 403 rather than blaming the engine', async () => {
		const { event } = loadEvent({ '/api/admin/flows?': () => json({ error: 'forbidden' }, 403) });
		const result = (await load(event)) as Loaded;
		expect(result.locked).toBe(false);
		expect(result.gate).toEqual({ state: 'forbidden' });
	});

	it('keeps the engine banner for a network failure', async () => {
		const { event } = loadEvent({
			'/api/admin/flows?': () => {
				throw new TypeError('fetch failed');
			},
		});
		const result = (await load(event)) as Loaded;
		expect(result.gate).toEqual({ state: 'unavailable' });
	});

	// A status no chip carries would filter the list with no chip selected.
	it('reads a status it does not know as no filter', async () => {
		const { event, calls } = loadEvent({ '/api/admin/flows?': () => json({ data: [], total: 0 }) }, '?status=archived');
		const result = (await load(event)) as Loaded;
		expect(result.status).toBe('');
		expect(calls.find((c) => c.url.includes('/api/admin/flows?'))?.url).not.toContain('status=archived');
	});

	it('passes the status and search filters to the engine and back to the page', async () => {
		const { event, calls } = loadEvent({ '/api/admin/flows?': () => json({ data: [], total: 0 }) }, '?status=active&q=orders');
		const result = (await load(event)) as Loaded;
		const url = new URL(calls[0].url, 'http://x');
		expect(url.searchParams.get('status')).toBe('active');
		expect(url.searchParams.get('q')).toBe('orders');
		expect(result.status).toBe('active');
		expect(result.q).toBe('orders');
	});

	it('sends the bearer token the session cookie holds', async () => {
		const { event, calls } = loadEvent({ '/api/admin/flows?': () => json([]) });
		await load(event);
		const headers = calls[0].init?.headers as Record<string, string>;
		expect(headers.Authorization).toBe('Bearer tok');
	});
});

describe('admin/flows create action', () => {
	it('posts the name and slug and redirects to the editor', async () => {
		const form = new FormData();
		form.set('name', 'Orders');
		form.set('slug', 'orders');
		const { event, calls } = actionEvent({ '/api/admin/flows': () => json({ ...fixtureFlow, id: 'new1' }) }, form);
		await expect(actions.create(event)).rejects.toMatchObject({ status: 303, location: '/admin/flows/new1' });
		const body = JSON.parse(String(calls.find((c) => c.url.endsWith('/api/admin/flows'))?.init?.body));
		expect(body).toEqual({ name: 'Orders', slug: 'orders' });
	});

	it('sends the name and the slug alone, whatever else the form carries', async () => {
		const form = new FormData();
		form.set('name', 'Mine');
		form.set('slug', 'mine');
		form.set('definition', JSON.stringify(joinFlow));
		const { event, calls } = actionEvent({ '/api/admin/flows': () => json({ ...fixtureFlow, id: 'new2' }) }, form);
		await expect(actions.create(event)).rejects.toMatchObject({ status: 303 });
		const body = JSON.parse(String(calls.find((c) => c.url.endsWith('/api/admin/flows'))?.init?.body));
		expect(body).toEqual({ name: 'Mine', slug: 'mine' });
	});

	it('surfaces a 422 body as the error list', async () => {
		const form = new FormData();
		form.set('name', 'Bad');
		form.set('slug', 'bad');
		form.set('definition', JSON.stringify(joinFlow));
		const { event } = actionEvent(
			{ '/api/admin/flows': () => json({ ok: false, errors: [{ node_id: 'join', path: '/config/left_key', message: 'required' }] }, 422) },
			form
		);
		const result = (await actions.create(event)) as { status: number; data: { error: string; errors: unknown[] } };
		expect(result.status).toBe(422);
		expect(result.data.errors).toEqual([{ node_id: 'join', path: '/config/left_key', message: 'required' }]);
	});

	it('maps a 402 to the locked state', async () => {
		const form = new FormData();
		form.set('name', 'x');
		form.set('slug', 'x');
		const { event } = actionEvent({ '/api/admin/flows': () => json({ error: 'payment required' }, 402) }, form);
		const result = (await actions.create(event)) as { status: number; data: { locked?: boolean } };
		expect(result.status).toBe(402);
		expect(result.data.locked).toBe(true);
	});

	it('renders a 403 as a role refusal with the engine message', async () => {
		const form = new FormData();
		form.set('name', 'x');
		form.set('slug', 'x');
		const { event } = actionEvent({ '/api/admin/flows': () => json({ error: 'permission denied: create on flows', code: 'forbidden' }, 403) }, form);
		const result = (await actions.create(event)) as { status: number; data: { error: string; forbidden: boolean } };
		expect(result.status).toBe(403);
		expect(result.data.forbidden).toBe(true);
		expect(result.data.error).toContain('create on flows');
	});

	it('quotes the limit and the count the plugin sends when it refuses a flow past its ceiling', async () => {
		const form = new FormData();
		form.set('name', 'x');
		form.set('slug', 'x');
		const body = { error: 'payment_required', plugin: 'flow', feature: 'example-capability', errors: [], cap: 'example.cap', limit: 7, current: 7 };
		const { event } = actionEvent({ '/api/admin/flows': () => json(body, 402) }, form);
		const result = (await actions.create(event)) as { status: number; data: { error: string; locked?: boolean; refusal: unknown } };
		expect(result.status).toBe(402);
		expect(result.data.locked).toBeUndefined();
		expect(result.data.refusal).toEqual({ nodeIds: [], limit: 7, current: 7, upgradeUrl: '' });
		expect(result.data.error).toContain('7 of 7 flows');
		expect(result.data.error).not.toContain('example-capability');
	});

	it('says the slug is taken when the plugin answers 409', async () => {
		const form = new FormData();
		form.set('name', 'Orders');
		form.set('slug', 'orders');
		const { event } = actionEvent({ '/api/admin/flows': () => json({ error: 'failed to create flow', code: 'conflict' }, 409) }, form);
		const result = (await actions.create(event)) as { status: number; data: { action: string; error: string; field: string } };
		expect(result.status).toBe(409);
		expect(result.data).toEqual({ action: 'create', error: 'Another flow already uses this slug. Choose another.', field: 'slug' });
	});

	it('carries the link the plugin names for more flows to the page', async () => {
		const form = new FormData();
		form.set('name', 'x');
		form.set('slug', 'x');
		const link = 'https://shop.example.com/pricing?utm_campaign=flow.flows';
		const body = { error: 'cap_exceeded', cap: 'flow.flows', limit: 7, current: 7, upgrade_url: link };
		const { event } = actionEvent({ '/api/admin/flows': () => json(body, 402) }, form);
		const result = (await actions.create(event)) as { status: number; data: { error: string; refusal: unknown } };
		expect(result.status).toBe(402);
		expect(result.data.refusal).toEqual({ nodeIds: [], limit: 7, current: 7, upgradeUrl: link });
		expect(result.data.error).toContain('A license that allows more lifts the limit.');
	});

	it('refuses a blank name before calling the engine', async () => {
		const form = new FormData();
		form.set('slug', 'x');
		const { event, calls } = actionEvent({}, form);
		const result = (await actions.create(event)) as { status: number; data: { action: string } };
		expect(result.status).toBe(400);
		expect(result.data.action).toBe('create');
		expect(calls.filter((c) => !c.url.includes('/auth/me'))).toHaveLength(0);
	});
});

describe('admin/flows delete action', () => {
	it('deletes by id', async () => {
		const form = new FormData();
		form.set('confirmed', 'yes');
		form.set('id', 'f9');
		const { event, calls } = actionEvent({ '/api/admin/flows/f9': () => new Response(null, { status: 204 }) }, form);
		await actions.delete(event);
		const call = calls.find((c) => c.url.endsWith('/api/admin/flows/f9'));
		expect(call?.init?.method).toBe('DELETE');
	});

	it('relays the engine message on refusal', async () => {
		const form = new FormData();
		form.set('confirmed', 'yes');
		form.set('id', 'f9');
		const { event } = actionEvent({ '/api/admin/flows/f9': () => json({ error: 'super_admin required', code: 'forbidden' }, 403) }, form);
		const result = (await actions.delete(event)) as { status: number; data: { error: string; forbidden: boolean; action: string } };
		expect(result.status).toBe(403);
		expect(result.data.forbidden).toBe(true);
		expect(result.data.action).toBe('delete');
		expect(result.data.error).toBe('super_admin required');
	});
});

describe('admin/flows import action', () => {
	it('posts pasted JSON as JSON and redirects to the new flow', async () => {
		const form = new FormData();
		form.set('text', JSON.stringify(joinFlow));
		form.set('mode', 'create');
		const { event, calls } = actionEvent({ '/api/admin/flows/import': () => json({ ...fixtureFlow, id: 'imp1' }) }, form);
		await expect(actions.import(event)).rejects.toMatchObject({ status: 303, location: '/admin/flows/imp1' });
		const call = calls.find((c) => c.url.includes('/import'))!;
		expect(call.url).toContain('mode=create');
		expect((call.init?.headers as Record<string, string>)['Content-Type']).toBe('application/json');
		expect((call.init?.headers as Record<string, string>).Authorization).toBe('Bearer tok');
		expect(JSON.parse(call.init?.body as string)).toEqual({ content: JSON.stringify(joinFlow), format: 'json' });
	});

	it('posts pasted YAML in the envelope named as YAML', async () => {
		const form = new FormData();
		form.set('text', 'version: 1\nname: x\n');
		form.set('mode', 'create');
		const { event, calls } = actionEvent({ '/api/admin/flows/import': () => json({ ...fixtureFlow, id: 'imp4' }) }, form);
		await expect(actions.import(event)).rejects.toMatchObject({ status: 303 });
		const call = calls.find((c) => c.url.includes('/import'))!;
		expect((call.init?.headers as Record<string, string>)['Content-Type']).toBe('application/json');
		expect(JSON.parse(call.init?.body as string)).toEqual({ content: 'version: 1\nname: x', format: 'yaml' });
	});

	it('posts a chosen file as multipart with the replace slug', async () => {
		const form = new FormData();
		form.set('file', new File(['version: 1\nname: x\n'], 'flow.yaml', { type: 'application/yaml' }));
		form.set('mode', 'replace');
		form.set('slug', 'orders');
		const { event, calls } = actionEvent({ '/api/admin/flows/import': () => json({ ...fixtureFlow, id: 'imp2' }) }, form);
		await expect(actions.import(event)).rejects.toMatchObject({ status: 303 });
		const call = calls.find((c) => c.url.includes('/import'))!;
		expect(call.url).toContain('mode=replace');
		expect(call.url).toContain('slug=orders');
		// The browser sets the multipart boundary. A hand-set type would break it.
		expect((call.init?.headers as Record<string, string>)['Content-Type']).toBeUndefined();
		expect((call.init?.headers as Record<string, string>).Authorization).toBe('Bearer tok');
		const body = call.init?.body as FormData;
		expect(body).toBeInstanceOf(FormData);
		const sent = body.get('file') as File;
		expect(sent.name).toBe('flow.yaml');
		expect(await sent.text()).toBe('version: 1\nname: x\n');
	});

	it('reports unresolved datasources instead of redirecting', async () => {
		const form = new FormData();
		form.set('text', '{}');
		const { event } = actionEvent(
			{ '/api/admin/flows/import': () => json({ ...fixtureFlow, id: 'imp3', unresolved_datasources: ['warehouse'] }) },
			form
		);
		const result = (await actions.import(event)) as { imported: { id: string; unresolved: string[] } };
		expect(result.imported.id).toBe('imp3');
		expect(result.imported.unresolved).toEqual(['warehouse']);
	});

	it('surfaces a 422 body as the error list', async () => {
		const form = new FormData();
		form.set('text', '{}');
		const { event } = actionEvent(
			{ '/api/admin/flows/import': () => json({ ok: false, errors: [{ node_id: '', path: '/trigger', message: 'unknown type' }] }, 422) },
			form
		);
		const result = (await actions.import(event)) as { status: number; data: { errors: unknown[] } };
		expect(result.status).toBe(422);
		expect(result.data.errors).toEqual([{ node_id: '', path: '/trigger', message: 'unknown type' }]);
	});

	it("relays the engine's own refusal and keeps a proxy's page off the screen", async () => {
		const form = new FormData();
		form.set('text', '{}');
		const coded = actionEvent(
			{ '/api/admin/flows/import': () => json({ error: 'a flow with this slug already exists', code: 'conflict' }, 409) },
			form
		);
		expect(((await actions.import(coded.event)) as { data: { error: string } }).data.error).toBe('a flow with this slug already exists');

		const proxy = actionEvent(
			{ '/api/admin/flows/import': () => new Response('<html><body>413 Request Entity Too Large</body></html>', { status: 413 }) },
			form
		);
		expect(((await actions.import(proxy.event)) as { data: { error: string } }).data.error).toBe('Could not import the flow. Try again.');
	});

	it('puts a create onto a taken slug at the slug field', async () => {
		const form = new FormData();
		form.set('text', '{}');
		form.set('mode', 'create');
		const { event } = actionEvent(
			{
				'/api/admin/flows/import': () =>
					json(
						{
							ok: false,
							errors: [{ path: '/slug', message: 'another flow in this tenant already uses this slug' }],
							error: 'another flow in this tenant already uses this slug',
							code: 'conflict',
						},
						409
					),
			},
			form
		);
		expect(await actions.import(event)).toMatchObject({
			status: 409,
			data: { action: 'import', field: 'slug', error: "Another flow already uses this slug. Enter another, or replace that flow's draft." },
		});
	});

	it('claims nothing about the flow after a 5xx or a dropped connection', async () => {
		const uncertain = 'Could not import the flow. Check whether it appears in the list, then try again.';
		const form = new FormData();
		form.set('text', '{}');
		const down = actionEvent({ '/api/admin/flows/import': () => json({ error: 'failed to import flow', code: 'internal' }, 500) }, form);
		expect(await actions.import(down.event)).toMatchObject({ status: 502, data: { action: 'import', error: uncertain } });

		const dropped = actionEvent(
			{
				'/api/admin/flows/import': () => {
					throw new TypeError('fetch failed');
				},
			},
			form
		);
		expect(await actions.import(dropped.event)).toMatchObject({ status: 502, data: { action: 'import', error: uncertain } });
	});

	it('refuses an empty import and a replace with no slug before calling the engine', async () => {
		const empty = actionEvent({}, new FormData());
		const refused = (await actions.import(empty.event)) as { status: number; data: { action: string } };
		expect(refused.status).toBe(400);
		expect(refused.data.action).toBe('import');

		const form = new FormData();
		form.set('text', '{}');
		form.set('mode', 'replace');
		const noSlug = actionEvent({}, form);
		expect(((await actions.import(noSlug.event)) as { status: number }).status).toBe(400);
		expect(noSlug.calls.some((c) => c.url.includes('/import'))).toBe(false);
	});
});
