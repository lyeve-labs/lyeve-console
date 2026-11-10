import { describe, expect, it, vi } from 'vitest';
import type { Cookies } from '@sveltejs/kit';
import { actions, load, ssr } from './+page.server';
import { forbiddenText } from '$lib/api/gate';
import { BUSY, OUTAGE } from '$lib/outage';
import { blockedFlow, fixtureCatalog, fixtureEventTypes, fixtureFlow, fixtureRun, fixtureTemplates, joinFlow, missingTypeErrors, withLocked } from '$lib/flow/fixtures';
import type { FlowRun, FlowVersion } from '$lib/api/flows';
import type { FlowOption, NodeSpec } from '$lib/flow/types';

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function mockCookies(): Cookies {
	return {
		get: vi.fn(() => 'tok'),
		set: vi.fn(),
		delete: vi.fn(),
		getAll: vi.fn(() => []),
		serialize: vi.fn(() => ''),
	} as unknown as Cookies;
}

type Route = (url: string, init?: RequestInit) => Response | Promise<Response>;

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

const everything: Record<string, Route> = {
	'/api/admin/flows/catalog/llm': () => new Response('# Nodes\n\ncontent.query', { status: 200, headers: { 'content-type': 'text/markdown' } }),
	'/api/admin/flows/catalog': () => json({ data: fixtureCatalog }),
	'/api/admin/ai/assist/flow/explain': () => json({ answer: 'It **joins** two lists.', conversation_id: 'c1', model: 'm', tokens: 40, cost: '0.000200' }),
	'/api/admin/ai/assist/flow': () =>
		json({ definition: joinFlow, yaml: 'name: x\n', problems: [{ node_id: 'join', path: '/config/left_key', message: 'required' }], conversation_id: 'c1', model: 'm', tokens: 120, cost: '0.001000' }),
	'/api/admin/flows/event-types': () => json(fixtureEventTypes),
	'/api/admin/flows?': () => json({ data: [fixtureFlow, { ...fixtureFlow, id: 'f2', slug: 'send-receipt', name: 'Send receipt' }], total: 2 }),
	'/api/admin/flows/templates': () => json({ data: fixtureTemplates }),
	'/api/admin/flows/datasources': () => json({ data: [{ id: 'd1', name: 'warehouse', kind: 'postgres' }] }),
	'/api/admin/flows/variables': () => json({ data: [{ key: 'region', value: 'eu', is_secret: false }] }),
	'/api/admin/schemas': () =>
		json([{ name: 'orders', display_name: 'Orders', fields: [{ name: 'total', field_type: 'number' }, { name: 'notes', field_type: 'text', no_ai: true }] }]),
	'/api/admin/flows/f1/runs': () => json({ data: [fixtureRun], total: 1 }),
	'/api/admin/flows/f1/versions': () => json({ data: [{ flow_id: 'f1', version: 1, checksum: 'x', created_by: 'u1', created_at: '2026-09-01T00:00:00Z' }] }),
	'/api/admin/flows/f1/publish': () => json({ ...fixtureFlow, status: 'active', version: 2 }),
	'/api/admin/flows/f1/disable': () => json({ ...fixtureFlow, status: 'disabled' }),
	'/api/admin/flows/f1/rollback': () => json({ ...fixtureFlow, version: 1 }),
	'/api/admin/flows/import': () => json({ ...fixtureFlow, name: 'Imported', unresolved_datasources: ['inventory'] }),
	'/api/admin/flows/runs/r1': () => json(fixtureRun),
	'/api/admin/flows/f1': (_url, init) =>
		init?.method === 'DELETE' ? new Response(null, { status: 204 }) : json(fixtureFlow),
};

function loadEvent(routes: Record<string, Route> = everything) {
	const { fetch, calls } = fetchFor(routes);
	return {
		calls,
		event: {
			fetch,
			cookies: mockCookies(),
			params: { id: 'f1' },
			url: new URL('http://localhost/admin/flows/f1'),
			parent: async () => ({ user: { roles: ['super_admin'] } }),
		} as never,
	};
}

function actionEvent(form: FormData, routes: Record<string, Route> = everything) {
	const { fetch, calls } = fetchFor(routes);
	return {
		calls,
		event: {
			fetch,
			cookies: mockCookies(),
			params: { id: 'f1' },
			request: { formData: async () => form },
			url: new URL('http://localhost/admin/flows/f1'),
		} as never,
	};
}

type Loaded = Exclude<Awaited<ReturnType<typeof load>>, void>;

describe('admin/flows/[id] rendering', () => {
	it('renders in the browser only, so the server build carries no flow editor', () => {
		expect(ssr).toBe(false);
	});
});

describe('admin/flows/[id] load', () => {
	// A failed read of the names is not a tenant with none, so the node form
	// and the inspector have to tell the two apart.
	it('keeps a failed datasource or variable read as its gate', async () => {
		const { event } = loadEvent({
			...everything,
			'/api/admin/flows/datasources': () => json({ error: 'unavailable' }, 503),
			'/api/admin/flows/variables': () => json({ error: 'boom' }, 500),
		});
		const result = (await load(event)) as Loaded;
		expect(result.datasources).toEqual([]);
		expect(result.datasourcesGate).toEqual({ state: 'unavailable' });
		expect(result.variablesGate).toMatchObject({ state: 'error' });
	});

	it('reports both name reads as read when they answered', async () => {
		const { event } = loadEvent();
		const result = (await load(event)) as Loaded;
		expect(result.datasourcesGate).toEqual({ state: 'ok' });
		expect(result.variablesGate).toEqual({ state: 'ok' });
	});

	it('loads the flow with its draft, the catalog, names and recent runs', async () => {
		const { event, calls } = loadEvent();
		const result = (await load(event)) as Loaded;
		expect(result.locked).toBe(false);
		expect(result.flow?.draft?.nodes).toHaveLength(3);
		expect(result.catalog.map((s: NodeSpec) => s.type)).toContain('data.join');
		expect(result.datasources).toEqual([{ id: 'd1', name: 'warehouse', kind: 'postgres' }]);
		expect(result.variables).toEqual(['region']);
		expect(result.schemas).toEqual([{ name: 'orders', display_name: 'Orders', fields: ['total', 'notes'], unfillable: { notes: 'is marked No AI' } }]);
		expect(result.flows.map((f: FlowOption) => f.slug)).toEqual([fixtureFlow.slug, 'send-receipt']);
		expect(calls.find((c) => c.url.includes('/api/admin/flows?'))?.url).toContain('status=active');
		expect(result.eventTypes).toEqual(fixtureEventTypes);
		expect(result.runs.ok && result.runs.value.rows.map((r: FlowRun) => r.id)).toEqual(['r1']);
		expect(result.catalogGate).toEqual({ state: 'ok' });
		expect(result.versions.ok && result.versions.value.map((v: FlowVersion) => v.version)).toEqual([1]);
		// One row past the page says whether another follows.
		expect(calls.find((c) => c.url.includes('/runs'))?.url).toContain('limit=21');
	});

	it('loads the editor on an engine without the event-types route, with the pickers as free text', async () => {
		const { event } = loadEvent({
			...everything,
			'/api/admin/flows/event-types': () => json({ error: 'not found' }, 404),
			'/api/admin/flows?': () => json({ error: 'pq: connection refused' }, 503),
		});
		const result = (await load(event)) as Loaded;
		expect(result.flow?.id).toBe('f1');
		expect(result.eventTypes).toBeNull();
		expect(result.flows).toEqual([]);
	});

	it('locks the page when the event-types route answers 402, as the flow read would', async () => {
		const { event } = loadEvent({ ...everything, '/api/admin/flows/event-types': () => json({ error: 'payment required' }, 402) });
		const result = (await load(event)) as Loaded;
		expect(result.locked).toBe(true);
		expect(result.flow).toBeNull();
	});

	it('gives a flow with no draft an empty definition to start from', async () => {
		const { event } = loadEvent({ ...everything, '/api/admin/flows/f1': () => json({ ...fixtureFlow, draft: undefined }) });
		const result = (await load(event)) as Loaded;
		expect(result.flow?.draft?.nodes).toEqual([]);
		expect(result.flow?.draft?.slug).toBe(fixtureFlow.slug);
	});

	it('answers 404 for a flow the engine does not have', async () => {
		const { event } = loadEvent({ '/api/admin/flows/f1': () => json({ error: 'not found' }, 404) });
		await expect(load(event)).rejects.toMatchObject({ status: 404 });
	});

	it('maps a 402 to the locked state', async () => {
		const { event } = loadEvent({ '/api/admin/flows/f1': () => json({ error: 'payment required' }, 402) });
		const result = (await load(event)) as Loaded;
		expect(result.locked).toBe(true);
		expect(result.flow).toBeNull();
	});

	it('answers an engine failure with its own status and a static message, not 404', async () => {
		const { event } = loadEvent({ '/api/admin/flows/f1': () => json({ error: 'pq: connection refused' }, 503) });
		const err = (await Promise.resolve(load(event)).catch((e: unknown) => e)) as { status: number; body: { message: string } };
		expect(err.status).toBe(503);
		expect(err.body.message).not.toContain('pq:');
		expect(err.body.message).not.toContain('not found');
	});

	it('sends an outage to the outage page and a refused rate to the busy sentence', async () => {
		const gateway = (await Promise.resolve(load(loadEvent({ '/api/admin/flows/f1': () => json({ error: 'bad gateway' }, 504) }).event)).catch(
			(e: unknown) => e,
		)) as { status: number; body: { message: string } };
		expect(gateway).toMatchObject({ status: 503, body: { message: OUTAGE.title } });
		const busy = (await Promise.resolve(load(loadEvent({ '/api/admin/flows/f1': () => json({ error: 'slow down' }, 429) }).event)).catch(
			(e: unknown) => e,
		)) as { status: number; body: { message: string } };
		expect(busy).toMatchObject({ status: 429, body: { message: BUSY.body } });
	});

	it('says in the load when the versions could not be read, never an empty history', async () => {
		const { event } = loadEvent({ ...everything, '/api/admin/flows/f1/versions': () => json({ error: 'down' }, 503) });
		const result = (await load(event)) as Loaded;
		expect(result.versions).toEqual({ ok: false, gate: { state: 'unavailable' } });
	});

	it('sends an expired session to the login page with the cookie cleared', async () => {
		const { event } = loadEvent({ '/api/admin/flows/f1': () => json({ error: 'unauthorized' }, 401) });
		await expect(load(event)).rejects.toMatchObject({ status: 302, location: '/login' });
		expect((event as { cookies: Cookies }).cookies.delete).toHaveBeenCalledWith('__Host-sys_session', expect.objectContaining({ path: '/' }));
	});

	it('answers a refused role with 403 and names the role as the reason', async () => {
		const { event } = loadEvent({ '/api/admin/flows/f1': () => json({ error: 'forbidden' }, 403) });
		await expect(load(event)).rejects.toMatchObject({ status: 403, body: { message: forbiddenText('this page') } });
	});

	it('offers the Assistant tab when the catalog for a model can be read, and hides it on a 402', async () => {
		const ready = (await load(loadEvent().event)) as Loaded;
		expect(ready.assistant).toBe('ready');
		const { event } = loadEvent({ ...everything, '/api/admin/flows/catalog/llm': () => json({ error: 'ai is not enabled' }, 402) });
		const hidden = (await load(event)) as Loaded;
		expect(hidden.locked).toBe(false);
		expect(hidden.assistant).toBe('hidden');
		const absent = (await load(loadEvent({ ...everything, '/api/admin/flows/catalog/llm': () => json({ error: 'not found' }, 404) }).event)) as Loaded;
		expect(absent.assistant).toBe('ready');
	});

	it('still renders when the side reads fail', async () => {
		const { event } = loadEvent({ '/api/admin/flows/f1': () => json(fixtureFlow) });
		const result = (await load(event)) as Loaded;
		expect(result.catalog).toEqual([]);
		expect(result.catalogGate.state).toBe('absent');
	});

	// Neither draws as a palette or a history with nothing in it.
	it('keeps an outage on the catalog or the runs apart from an empty answer', async () => {
		const { event } = loadEvent({
			...everything,
			'/api/admin/flows/catalog': () => json({ error: 'down' }, 503),
			'/api/admin/flows/f1/runs': () => json({ error: 'down' }, 503),
		});
		const result = (await load(event)) as Loaded;
		expect(result.catalog).toEqual([]);
		expect(result.catalogGate).toEqual({ state: 'unavailable' });
		expect(result.runs).toEqual({ ok: false, gate: { state: 'unavailable' } });
	});

	it('pages the runs by the address and states whether another page follows', async () => {
		const { fetch, calls } = fetchFor({
			...everything,
			'/api/admin/flows/f1/runs': () => json({ data: Array.from({ length: 21 }, (_, i) => ({ ...fixtureRun, id: `r${i}` })) }),
		});
		const event = {
			fetch,
			cookies: mockCookies(),
			params: { id: 'f1' },
			url: new URL('http://localhost/admin/flows/f1?offset=20'),
			parent: async () => ({ user: { roles: ['super_admin'] } }),
		} as never;
		const result = (await load(event)) as Loaded;
		expect(calls.find((c) => c.url.includes('/runs'))?.url).toContain('offset=20');
		expect(result.runs.ok && result.runs.value.rows).toHaveLength(20);
		expect(result.runs.ok && result.runs.value.hasMore).toBe(true);
	});
});

describe('admin/flows/[id] actions', () => {
	it('save puts the draft with the name from the form', async () => {
		const form = new FormData();
		form.set('definition', JSON.stringify(joinFlow));
		form.set('name', 'Renamed');
		const { event, calls } = actionEvent(form);
		const result = (await actions.save(event)) as { saved: { status: string } };
		expect(result.saved.status).toBe('draft');
		const call = calls.find((c) => c.url.endsWith('/api/admin/flows/f1') && c.init?.method === 'PUT')!;
		const body = JSON.parse(String(call.init?.body));
		expect(body.name).toBe('Renamed');
		expect(body.definition.name).toBe('Renamed');
		expect(body.definition.nodes).toHaveLength(3);
		expect(body.slug).toBe(joinFlow.slug);
	});

	it('save sends a new slug from the form, and the answer carries the slug the engine holds', async () => {
		const form = new FormData();
		form.set('definition', JSON.stringify(joinFlow));
		form.set('name', 'Orders');
		form.set('slug', 'orders-v2');
		const { event, calls } = actionEvent(form);
		const result = (await actions.save(event)) as { saved: { slug: string } };
		const call = calls.find((c) => c.url.endsWith('/api/admin/flows/f1') && c.init?.method === 'PUT')!;
		const body = JSON.parse(String(call.init?.body));
		expect(body.slug).toBe('orders-v2');
		expect(body.definition.slug).toBe('orders-v2');
		expect(typeof result.saved.slug).toBe('string');
	});

	it('save surfaces a 422 as the error list', async () => {
		const form = new FormData();
		form.set('definition', JSON.stringify(joinFlow));
		const { event } = actionEvent(form, {
			'/api/admin/flows/f1': () => json({ ok: false, errors: [{ node_id: 'join', path: '/config/left_key', message: 'required' }] }, 422),
		});
		const result = (await actions.save(event)) as { status: number; data: { errors: unknown[] } };
		expect(result.status).toBe(422);
		expect(result.data.errors).toHaveLength(1);
	});

	it('save refuses a body that is not JSON', async () => {
		const form = new FormData();
		form.set('definition', '{not json');
		const { event, calls } = actionEvent(form);
		const result = (await actions.save(event)) as { status: number };
		expect(result.status).toBe(400);
		expect(calls.some((c) => c.init?.method === 'PUT')).toBe(false);
	});

	it('publish saves the canvas draft first, then publishes', async () => {
		const form = new FormData();
		form.set('definition', JSON.stringify(joinFlow));
		const { event, calls } = actionEvent(form);
		const result = (await actions.publish(event)) as { published: { version: number; status: string } };
		expect(result.published).toMatchObject({ version: 2, status: 'active' });
		const order = calls.filter((c) => !c.url.includes('/auth/me')).map((c) => `${c.init?.method} ${new URL(c.url, 'http://x').pathname}`);
		expect(order).toEqual(['PUT /api/admin/flows/f1', 'POST /api/admin/flows/f1/publish']);
	});

	it('publish hands the 422 naming a missing plugin through with its node id intact', async () => {
		const form = new FormData();
		form.set('definition', JSON.stringify(blockedFlow.draft));
		const { event } = actionEvent(form, {
			...everything,
			'/api/admin/flows/f1/publish': () => json({ ok: false, errors: missingTypeErrors }, 422),
		});
		const result = (await actions.publish(event)) as { status: number; data: { errors: { node_id?: string; message: string }[] } };
		expect(result.status).toBe(422);
		expect(result.data.errors).toEqual(missingTypeErrors);
		expect(result.data.errors[0].node_id).toBe('render');
	});

	it('save reads a slug another flow holds out of the 409 list', async () => {
		const form = new FormData();
		form.set('definition', JSON.stringify(fixtureFlow.draft));
		form.set('name', 'Orders');
		form.set('slug', 'taken');
		const body = { ok: false, errors: [{ path: '/slug', message: 'another flow in this tenant already uses this slug' }] };
		const { event } = actionEvent(form, { '/api/admin/flows/f1': () => json(body, 409) });
		const result = (await actions.save(event)) as { status: number; data: { error: string; errors: unknown[] } };
		expect(result.status).toBe(409);
		expect(result.data.error).toBe('Another flow already uses this slug. Choose another.');
		expect(result.data.errors).toEqual(body.errors);
	});

	it('publish marks the trigger when another flow answers its HTTP path', async () => {
		const body = { ok: false, errors: [{ node_id: 'trigger', path: '/config/path', message: 'another flow already answers this path' }] };
		const { event } = actionEvent(new FormData(), { '/api/admin/flows/f1/publish': () => json(body, 409) });
		const result = (await actions.publish(event)) as { status: number; data: { error: string; errors: { node_id?: string }[] } };
		expect(result.status).toBe(409);
		expect(result.data.error).toContain('Another flow already uses this HTTP path');
		expect(result.data.errors[0].node_id).toBe('trigger');
		expect(result.data.error).not.toContain('{');
	});

	it('rollback reads the same 409 list as a publish', async () => {
		const form = new FormData();
		form.set('version', '1');
		const body = { ok: false, errors: [{ node_id: 'trigger', path: '/config/path', message: 'another flow already answers this path' }] };
		const { event } = actionEvent(form, { '/api/admin/flows/f1/rollback': () => json(body, 409) });
		const result = (await actions.rollback(event)) as { status: number; data: { error: string; errors: unknown[] } };
		expect(result.status).toBe(409);
		expect(result.data.errors).toHaveLength(1);
		expect(result.data.error).not.toContain('{');
	});

	it('publish maps a 402 to the locked state', async () => {
		const { event } = actionEvent(new FormData(), { '/api/admin/flows/f1/publish': () => json({ error: 'nope' }, 402) });
		const result = (await actions.publish(event)) as { status: number; data: { locked: boolean } };
		expect(result.status).toBe(402);
		expect(result.data.locked).toBe(true);
	});

	it('save renders a refusal with its node ids, as problems the canvas can mark', async () => {
		const form = new FormData();
		form.set('definition', JSON.stringify(joinFlow));
		const refusal = {
			error: 'payment_required',
			feature: 'example-capability',
			errors: [
				{ node_id: 'trigger', path: '/trigger/type', message: 'not enabled here' },
				{ node_id: 'orders', path: '/type', message: 'not enabled here' },
			],
		};
		const { event } = actionEvent(form, { ...everything, '/api/admin/flows/f1': () => json(refusal, 402) });
		const result = (await actions.save(event)) as { status: number; data: { error: string; locked?: boolean; refusal: unknown; errors: unknown[] } };
		expect(result.status).toBe(402);
		expect(result.data.locked).toBeUndefined();
		expect(result.data.refusal).toEqual({ nodeIds: ['trigger', 'orders'], limit: null, current: null, upgradeUrl: '' });
		expect(result.data.error).toContain('the trigger, orders');
		expect(result.data.error).not.toContain('example-capability');
		expect(result.data.errors).toHaveLength(2);
	});

	it('publish renders a 403 as a role refusal with the engine message', async () => {
		const { event } = actionEvent(new FormData(), { '/api/admin/flows/f1/publish': () => json({ error: 'permission denied: activate on flow:orders', code: 'forbidden' }, 403) });
		const result = (await actions.publish(event)) as { status: number; data: { error: string; forbidden: boolean } };
		expect(result.status).toBe(403);
		expect(result.data.forbidden).toBe(true);
		expect(result.data.error).toContain('activate on flow:orders');
	});

	it('publish keeps a refusal that names no node and no limit as the locked state', async () => {
		const { event } = actionEvent(new FormData(), { '/api/admin/flows/f1/publish': () => json({ error: 'payment_required', feature: 'example-capability' }, 402) });
		const result = (await actions.publish(event)) as { status: number; data: { locked: boolean } };
		expect(result.data.locked).toBe(true);
	});

	it('loads the catalog with the flag the plugin set on each type', async () => {
		const locked = (await load(loadEvent({ ...everything, '/api/admin/flows/catalog': () => json({ data: withLocked(fixtureCatalog, ['data.join']) }) }).event)) as Loaded;
		expect(locked.catalog.find((s: NodeSpec) => s.type === 'data.join')?.enabled).toBe(false);
		expect(locked.catalog.find((s: NodeSpec) => s.type === 'content.query')?.enabled).not.toBe(false);
	});

	it('disable reports the new status', async () => {
		const { event } = actionEvent(new FormData());
		const result = (await actions.disable(event)) as { disabled: { status: string } };
		expect(result.disabled.status).toBe('disabled');
	});

	it('rollback posts the version and answers with the rolled-back draft instead of redirecting', async () => {
		const form = new FormData();
		form.set('version', '1');
		const { event, calls } = actionEvent(form);
		const result = (await actions.rollback(event)) as { reloaded: { draft: { nodes: unknown[] }; version: number; status: string } };
		expect(result.reloaded.version).toBe(1);
		expect(result.reloaded.status).toBe('draft');
		expect(result.reloaded.draft.nodes).toHaveLength(3);
		const call = calls.find((c) => c.url.includes('/rollback'))!;
		expect(JSON.parse(String(call.init?.body))).toEqual({ version: 1 });
	});

	it('rollback reads the flow again when the answer carries no draft', async () => {
		const form = new FormData();
		form.set('version', '1');
		const { event, calls } = actionEvent(form, {
			...everything,
			'/api/admin/flows/f1/rollback': () => json({ ...fixtureFlow, version: 1, draft: undefined }),
		});
		const result = (await actions.rollback(event)) as { reloaded: { draft: { nodes: unknown[] } } };
		expect(result.reloaded.draft.nodes).toHaveLength(3);
		expect(calls.some((c) => c.url.endsWith('/api/admin/flows/f1') && c.init?.method === 'GET')).toBe(true);
	});

	it('import replaces this flow by slug and answers with the new draft and the unresolved names', async () => {
		const form = new FormData();
		form.set('text', JSON.stringify(joinFlow));
		form.set('slug', fixtureFlow.slug);
		const { event, calls } = actionEvent(form);
		const result = (await actions.import(event)) as { reloaded: { name: string }; unresolved: string[] };
		expect(result.reloaded.name).toBe('Imported');
		expect(result.unresolved).toEqual(['inventory']);
		const call = calls.find((c) => c.url.includes('/import'))!;
		const url = new URL(call.url, 'http://x');
		expect(url.searchParams.get('mode')).toBe('replace');
		expect(url.searchParams.get('slug')).toBe(fixtureFlow.slug);
		expect((call.init?.headers as Record<string, string>)['Content-Type']).toBe('application/json');
		expect(JSON.parse(call.init?.body as string)).toEqual({ content: JSON.stringify(joinFlow), format: 'json' });
	});

	it('import sends a chosen file as multipart', async () => {
		const form = new FormData();
		form.set('file', new File(['version: 1\n'], 'flow.yml', { type: 'text/yaml' }));
		form.set('slug', fixtureFlow.slug);
		const { event, calls } = actionEvent(form);
		await actions.import(event);
		const call = calls.find((c) => c.url.includes('/import'))!;
		expect((call.init?.headers as Record<string, string>)['Content-Type']).toBeUndefined();
		expect(call.init?.body).toBeInstanceOf(FormData);
		expect(((call.init?.body as FormData).get('file') as File).name).toBe('flow.yml');
	});

	it('import surfaces a 422 as the error list', async () => {
		const form = new FormData();
		form.set('text', 'version: 1');
		form.set('slug', fixtureFlow.slug);
		const { event } = actionEvent(form, {
			'/api/admin/flows/import': () => json({ ok: false, errors: [{ node_id: 'join', path: '/config/left_key', message: 'required' }] }, 422),
		});
		const result = (await actions.import(event)) as { status: number; data: { errors: unknown[] } };
		expect(result.status).toBe(422);
		expect(result.data.errors).toHaveLength(1);
	});

	it('rollback refuses a missing version', async () => {
		const { event } = actionEvent(new FormData());
		expect(((await actions.rollback(event)) as { status: number }).status).toBe(400);
	});

	it('delete removes the flow and returns to the list', async () => {
		const { event, calls } = actionEvent(new FormData());
		await expect(actions.delete(event)).rejects.toMatchObject({ status: 303, location: '/admin/flows' });
		expect(calls.some((c) => c.init?.method === 'DELETE')).toBe(true);
	});

	it('run loads one run with its steps', async () => {
		const form = new FormData();
		form.set('run_id', 'r1');
		const { event } = actionEvent(form);
		const result = (await actions.run(event)) as { run: { steps: unknown[] } };
		expect(result.run.steps).toHaveLength(3);
	});

	function assistForm(prompt = 'Join orders to customers', conversation = '') {
		const form = new FormData();
		form.set('prompt', prompt);
		form.set('definition', JSON.stringify(joinFlow));
		form.set('conversation_id', conversation);
		return form;
	}

	it('assist reads the catalog once and posts it with the prompt, the current definition and the conversation', async () => {
		const { event, calls } = actionEvent(assistForm('Join orders to customers', 'c0'));
		const result = (await actions.assist(event)) as { assist: { prompt: string; draft: { conversation_id: string; problems: unknown[] } } };
		expect(result.assist.prompt).toBe('Join orders to customers');
		expect(result.assist.draft.conversation_id).toBe('c1');
		expect(result.assist.draft.problems).toHaveLength(1);
		const catalog = calls.filter((c) => c.url.endsWith('/api/admin/flows/catalog/llm'));
		expect(catalog).toHaveLength(1);
		expect((catalog[0].init?.headers as Record<string, string>).Accept).toBe('text/markdown');
		const call = calls.find((c) => c.url.endsWith('/api/admin/ai/assist/flow'))!;
		expect(call.init?.method).toBe('POST');
		expect(JSON.parse(String(call.init?.body))).toEqual({
			prompt: 'Join orders to customers',
			catalog: '# Nodes\n\ncontent.query',
			current: joinFlow,
			conversation_id: 'c0',
		});
	});

	it('assist leaves the conversation out of a first prompt and refuses an empty one', async () => {
		const { event, calls } = actionEvent(assistForm());
		await actions.assist(event);
		const body = JSON.parse(String(calls.find((c) => c.url.endsWith('/api/admin/ai/assist/flow'))!.init?.body));
		expect(body).not.toHaveProperty('conversation_id');
		const empty = await actions.assist(actionEvent(assistForm('   ')).event);
		expect(empty).toMatchObject({ status: 400, data: { assistRefused: { state: 'error' } } });
	});

	it('assist maps 402, 404 and 503 to locked, off and unavailable with the static text', async () => {
		const refused = (status: number, body: unknown) => actionEvent(assistForm(), { ...everything, '/api/admin/ai/assist/flow': () => json(body, status) }).event;
		expect(await actions.assist(refused(402, { error: 'payment_required', plugin: 'ai', feature: 'feature:ai', upgrade_url: '' }))).toMatchObject({ status: 402, data: { assistRefused: { state: 'locked' } } });
		expect(await actions.assist(refused(404, { error: 'not found' }))).toMatchObject({ status: 404, data: { assistRefused: { state: 'off' } } });
		expect(await actions.assist(refused(503, { error: 'flow validator is not registered' }))).toMatchObject({
			status: 503,
			data: { assistRefused: { state: 'unavailable', message: 'flow validator is not registered' } },
		});
		// A 500 body can carry driver text. It never reaches the page.
		expect(await actions.assist(refused(500, { error: 'pq: connection refused' }))).toMatchObject({
			status: 400,
			data: { assistRefused: { state: 'error', message: 'The assistant did not answer. Try again.' } },
		});
	});

	it('assist reports an engine without the catalog route as unavailable, before the model is asked', async () => {
		const { event, calls } = actionEvent(assistForm(), { ...everything, '/api/admin/flows/catalog/llm': () => json({ error: 'not found' }, 404) });
		const result = await actions.assist(event);
		expect(result).toMatchObject({ status: 503, data: { assistRefused: { state: 'unavailable' } } });
		expect(calls.some((c) => c.url.endsWith('/api/admin/ai/assist/flow'))).toBe(false);
	});

	it('explain posts the node or the problem with the definition and answers with the Markdown', async () => {
		const form = new FormData();
		form.set('definition', JSON.stringify(joinFlow));
		form.set('node_id', 'join');
		form.set('problem', JSON.stringify({ node_id: 'join', path: '/config/left_key', message: 'required' }));
		form.set('conversation_id', 'c1');
		const { event, calls } = actionEvent(form);
		const result = (await actions.explain(event)) as { explain: { subject: string; answer: { answer: string } } };
		expect(result.explain.subject).toBe('join');
		expect(result.explain.answer.answer).toBe('It **joins** two lists.');
		const call = calls.find((c) => c.url.endsWith('/api/admin/ai/assist/flow/explain'))!;
		expect(JSON.parse(String(call.init?.body))).toEqual({
			catalog: '# Nodes\n\ncontent.query',
			definition: joinFlow,
			node_id: 'join',
			problem: { node_id: 'join', path: '/config/left_key', message: 'required' },
			conversation_id: 'c1',
		});
	});

	it('explain refuses a request that names nothing to ask about', async () => {
		const form = new FormData();
		form.set('definition', JSON.stringify(joinFlow));
		const { event, calls } = actionEvent(form);
		expect(await actions.explain(event)).toMatchObject({ status: 400, data: { assistRefused: { state: 'error' } } });
		expect(calls.some((c) => c.url.includes('/assist/flow'))).toBe(false);
	});
});

describe('flow editor saved templates', () => {
	it('saves a template from a URL, a file read as its text, or this flow', async () => {
		const route = { '/api/admin/flows/templates': () => json({ id: 'welcome', name: 'Welcome', source: 'saved' }, 201) };
		const byURL = new FormData();
		byURL.set('url', 'https://example.com/welcome.yaml');
		const a = actionEvent(byURL, route);
		expect(await actions.saveTemplate(a.event)).toEqual({ savedTemplate: 'welcome' });
		const sent = a.calls.find((c) => c.url.endsWith('/api/admin/flows/templates'));
		expect(sent?.init?.method).toBe('POST');
		expect(JSON.parse(String(sent?.init?.body))).toEqual({ url: 'https://example.com/welcome.yaml' });

		const byFile = new FormData();
		byFile.set('file', new File(['slug: welcome\n'], 'welcome.yaml', { type: 'text/yaml' }));
		const b = actionEvent(byFile, route);
		await actions.saveTemplate(b.event);
		expect(JSON.parse(String(b.calls.find((c) => c.url.endsWith('/templates'))?.init?.body))).toEqual({ document: 'slug: welcome' });
	});

	it('refuses an empty form before asking the engine and names a built-in clash', async () => {
		const empty = actionEvent(new FormData(), {});
		expect(await actions.saveTemplate(empty.event)).toMatchObject({ status: 400 });
		expect(empty.calls.filter((c) => c.url.includes('/templates'))).toEqual([]);

		const doc = new FormData();
		doc.set('document', 'slug: bulk-import');
		const clash = actionEvent(doc, { '/api/admin/flows/templates': () => json({ error: 'a built-in template already uses that slug' }, 409) });
		expect(await actions.saveTemplate(clash.event)).toMatchObject({ status: 409, data: { templateError: expect.stringContaining('built-in') } });
	});

	it('deletes a saved template by id', async () => {
		const form = new FormData();
		form.set('id', 'welcome');
		const { event, calls } = actionEvent(form, { '/api/admin/flows/templates/welcome': () => new Response(null, { status: 204 }) });
		expect(await actions.deleteTemplate(event)).toEqual({ deletedTemplate: 'welcome' });
		expect(calls.find((c) => c.url.includes('/templates/welcome'))?.init?.method).toBe('DELETE');
	});
});
