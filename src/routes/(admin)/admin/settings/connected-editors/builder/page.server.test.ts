import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/authz', async () => {
	const { createClient } = await vi.importActual<typeof import('@lyeve-labs/client')>('@lyeve-labs/client');
	return { authedClient: (event: { fetch: typeof fetch }) => createClient(event.fetch) };
});

import { actions, load } from './+page.server';
import { FORMS_TYPE_TAKEN, SUBMISSIONS_PUBLIC } from '$lib/api/form-destinations';

const BASE = '/api/admin/builder';
const RUNNING = { state: 'named', running: ['builder'], withheld: [] };

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

function refusal(status: number, code: string, error = 'The engine said no.', extra: Record<string, unknown> = {}) {
	return json({ error, code, ...extra }, status);
}

type Call = { method: string; path: string; body: unknown };
type Routes = Record<string, Response | (() => Response)>;

/** A fake engine that answers each `METHOD /path` it knows and records every request. */
function engine(routes: Routes) {
	const calls: Call[] = [];
	const fetch = vi.fn(async (url: string, init?: RequestInit) => {
		const method = init?.method ?? 'GET';
		const path = String(url);
		calls.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
		const key = `${method} ${path.split('?')[0]}`;
		const hit = routes[key];
		if (!hit) return json({ error: 'not found' }, 404);
		return (typeof hit === 'function' ? hit() : hit).clone();
	});
	return { calls, fetch };
}

const SETTINGS = { allowed: true, lifetime_days: 90, show_schemas: ['posts'], writes_per_minute: 120, max_writes_per_minute: 120 };

function loadEvent(routes: Routes, { roles = ['admin'], plugins = RUNNING as unknown } = {}) {
	const e = engine(routes);
	const url = new URL('http://admin/admin/settings/connected-editors/builder');
	return {
		...e,
		event: {
			fetch: e.fetch,
			url,
			request: new Request(url),
			parent: async () => ({ plugins, user: { id: 'u1', email: 'maria@example.com', roles, tenant_id: 't1' } }),
		} as never,
	};
}

const LISTED: Routes = {
	[`GET ${BASE}/settings`]: json(SETTINGS),
	'GET /api/admin/schemas': json([{ name: 'posts' }, { name: 'lyeve_builder_pages' }, { name: 'products' }]),
};

describe('builder settings load', () => {
	it('reads the settings and the schemas for an owner, and nothing of the list', async () => {
		const { event, calls } = loadEvent(LISTED);
		const out = (await load(event)) as Record<string, unknown>;
		expect(out.gate).toEqual({ state: 'ok' });
		expect(out.settings).toEqual({ ok: true, value: SETTINGS });
		expect(out.schemas).toEqual(['posts', 'products']);
		expect(out.schemasGate).toBeNull();
		expect(calls.some((c) => c.path.startsWith(`${BASE}/connections`))).toBe(false);
	});

	it.each([['editor'], ['viewer']])('refuses a person below owner without asking the engine (%s)', async (role) => {
		const { event, calls } = loadEvent(LISTED, { roles: [role] });
		await expect(load(event)).rejects.toMatchObject({
			status: 403,
			body: { message: 'Only an admin or a super admin can open this page.' },
		});
		expect(calls).toEqual([]);
	});

	it('makes no engine call while the plugin does not run', async () => {
		const { event, calls } = loadEvent(LISTED, { plugins: { state: 'named', running: [], withheld: [] } });
		const out = (await load(event)) as { gate: unknown; settings: unknown };
		expect(out.gate).toEqual({ state: 'absent' });
		expect(out.settings).toBeNull();
		expect(calls).toEqual([]);
	});

	it('says the schema list failed rather than reading it as empty', async () => {
		const { event } = loadEvent({ ...LISTED, 'GET /api/admin/schemas': refusal(503, 'store_unavailable') });
		const out = (await load(event)) as { schemas: unknown; schemasGate: unknown };
		expect(out.schemas).toEqual([]);
		expect(out.schemasGate).toEqual({ state: 'unavailable' });
	});

	it('keeps a refused settings read as a failure of the settings', async () => {
		const { event } = loadEvent({ ...LISTED, [`GET ${BASE}/settings`]: refusal(503, 'store_unavailable') });
		const out = (await load(event)) as { settings: unknown; gate: unknown };
		expect(out.gate).toEqual({ state: 'ok' });
		expect(out.settings).toEqual({ ok: false, gate: { state: 'unavailable' } });
	});

	it('draws a tenant the plugin is withheld from as the page gate', async () => {
		const { event } = loadEvent({ ...LISTED, [`GET ${BASE}/settings`]: refusal(403, 'TENANT_FEATURE_WITHHELD') });
		const out = (await load(event)) as { settings: unknown; gate: unknown };
		expect(out.gate).toEqual({ state: 'withheld' });
		expect(out.settings).toBeNull();
	});
});

type Failure = { status: number; data: Record<string, unknown> };

function act(fields: Record<string, string | string[]>, routes: Routes) {
	const e = engine(routes);
	const body = new FormData();
	for (const [k, v] of Object.entries(fields)) {
		for (const one of Array.isArray(v) ? v : [v]) body.append(k, one);
	}
	const url = new URL('http://admin/admin/settings/connected-editors/builder');
	return { ...e, event: { fetch: e.fetch, url, request: new Request(url, { method: 'POST', body }) } as never };
}

describe('setting', () => {
	afterEach(() => vi.restoreAllMocks());

	it.each([
		[{ field: 'allowed', allowed: 'off' }, { allowed: false }],
		[
			{ field: 'limits', lifetime_days: '30', writes_per_minute: '60', schemas_offered: '1', show_schemas: ['posts', 'products'] },
			{ lifetime_days: 30, writes_per_minute: 60, show_schemas: ['posts', 'products'] },
		],
		[
			{ field: 'limits', lifetime_days: '90', writes_per_minute: '120', schemas_offered: '1' },
			{ lifetime_days: 90, writes_per_minute: 120, show_schemas: [] },
		],
		// A form whose schema list failed to load leaves the schemas as they are.
		[{ field: 'limits', lifetime_days: '180', writes_per_minute: '10' }, { lifetime_days: 180, writes_per_minute: 10 }],
	])('saves the switch alone and the other settings together', async (fields, body) => {
		const { event, calls } = act(fields, { [`PUT ${BASE}/settings`]: json(SETTINGS) });
		expect(await actions.setting(event)).toMatchObject({ saved: { field: fields.field } });
		expect(calls).toEqual([{ method: 'PUT', path: `${BASE}/settings`, body }]);
	});

	it('lands a refused value on the field the engine names', async () => {
		const { event } = act(
			{ field: 'limits', lifetime_days: '90', writes_per_minute: '100000' },
			{ [`PUT ${BASE}/settings`]: json({ error: 'Writes must be between 1 and 120 a minute.', code: 'settings_invalid', field: 'writes_per_minute' }, 422) },
		);
		expect(((await actions.setting(event)) as Failure).data.settingError).toEqual({
			field: 'writes_per_minute',
			message: 'Writes must be between 1 and 120 a minute.',
		});
	});

	it('refuses a lifetime the engine does not offer without asking it', async () => {
		const { event, calls } = act({ field: 'limits', lifetime_days: '45', writes_per_minute: '60' }, {});
		expect(((await actions.setting(event)) as Failure).data.settingError).toEqual({
			field: 'lifetime_days',
			message: 'Choose 30, 90 or 180 days.',
		});
		expect(calls).toEqual([]);
	});
});

describe('where forms can send', () => {
	const FULL = { state: 'named', running: ['builder', 'flow', 'schema'], withheld: [] };
	const formEvent = { kind: 'system', name: 'builder.form.submitted' };
	const FORMS_ROUTES: Routes = {
		...LISTED,
		'GET /api/admin/schemas': json([
			{ name: 'contact_messages', display_name: 'Contact messages' },
			{ name: 'form_submissions', display_name: 'Form submissions' },
			{ name: 'posts', display_name: 'Posts', public_delivery: true },
			{ name: 'lyeve_builder_pages', display_name: 'Pages' },
		]),
		'GET /api/admin/flows': json({
			data: [
				{ id: 'f1', slug: 'notify', name: 'Notify', status: 'active', version: 1, trigger_type: 'trigger.event', trigger_event: formEvent },
				{ id: 'f2', slug: 'hook', name: 'Hook', status: 'active', version: 1, trigger_type: 'trigger.http', trigger_event: null },
			],
			total: 2,
		}),
		'GET /api/admin/schemas/presets': json({ presets: [{ id: 'forms', name: 'Forms', description: '', schemas: [] }] }),
	};

	it('offers the types forms can save into, the preset type first, with the flows from one list read and the preset', async () => {
		const { event, calls } = loadEvent(FORMS_ROUTES, { plugins: FULL });
		const out = (await load(event)) as Record<string, unknown>;
		// A type the delivery API serves and the builder's own types are never offered.
		expect(out.formSchemas).toEqual([
			{ name: 'form_submissions', label: 'Form submissions' },
			{ name: 'contact_messages', label: 'Contact messages' },
		]);
		expect(out.schemaLabels).toMatchObject({ posts: 'Posts' });
		expect(out.submissions).toBe('private');
		expect(out.formsTypeTaken).toBe(false);
		expect(out.flows).toEqual({
			ok: true,
			value: {
				complete: true,
				eventKnown: true,
				flows: [
					{ slug: 'notify', name: 'Notify', status: 'active', formTrigger: true },
					{ slug: 'hook', name: 'Hook', status: 'active', formTrigger: false },
				],
			},
		});
		expect(out.formsPreset).toEqual({ ok: true, value: true });
		expect(calls.filter((c) => c.path.startsWith('/api/admin/flows'))).toHaveLength(1);
	});

	it('says the flow list failed rather than offering no flows', async () => {
		const { event } = loadEvent({ ...FORMS_ROUTES, 'GET /api/admin/flows': refusal(500, 'internal') }, { plugins: FULL });
		const out = (await load(event)) as Record<string, unknown>;
		expect(out.flows).toEqual({ ok: false, gate: { state: 'error', message: 'Could not load flows.' } });
	});

	it('says the preset catalog failed rather than hiding the preset', async () => {
		const { event } = loadEvent({ ...FORMS_ROUTES, 'GET /api/admin/schemas/presets': refusal(500, 'internal') }, { plugins: FULL });
		const out = (await load(event)) as Record<string, unknown>;
		expect(out.formsPreset).toEqual({ ok: false, gate: { state: 'error', message: 'Could not load the content type presets.' } });
	});

	it.each([
		[
			{ field: 'forms', form_schemas_offered: '1', form_schemas: ['form_submissions'], form_flows_offered: '1', form_flows: ['notify'] },
			{ form_schemas: ['form_submissions'], form_flows: ['notify'] },
		],
		// A flow list that failed to load, or came from an older flow plugin, leaves the flows as they are.
		[{ field: 'forms', form_schemas_offered: '1' }, { form_schemas: [] }],
	])('saves only the lists the form offered', async (fields, body) => {
		const { event, calls } = act(fields, { [`PUT ${BASE}/settings`]: json(SETTINGS) });
		expect(await actions.setting(event)).toMatchObject({ saved: { field: 'forms' } });
		expect(calls).toEqual([{ method: 'PUT', path: `${BASE}/settings`, body }]);
	});

	it('lands a refused flow slug on the flow list', async () => {
		const { event } = act(
			{ field: 'forms', form_flows_offered: '1', form_flows: ['Bad'] },
			{ [`PUT ${BASE}/settings`]: refusal(422, 'settings_invalid', 'Choose a flow slug.', { field: 'form_flows' }) },
		);
		expect(((await actions.setting(event)) as Failure).data.settingError).toEqual({ field: 'form_flows', message: 'Choose a flow slug.' });
	});

	it('applies the forms preset and allows its submissions type beside the allowed types that still qualify', async () => {
		const { event, calls } = act(
			{},
			{
				'GET /api/admin/schemas': json([{ name: 'contact_messages' }, { name: 'posts', public_delivery: true }]),
				// posts opened to delivery and old_leads was deleted, so the plugin would refuse both.
				[`GET ${BASE}/settings`]: json({ ...SETTINGS, form_schemas: ['contact_messages', 'posts', 'old_leads'] }),
				'POST /api/admin/schemas/presets/forms': json({ created: ['forms', 'form_submissions'] }),
				[`PUT ${BASE}/settings`]: json({ ...SETTINGS, form_schemas: ['contact_messages', 'form_submissions'] }),
			},
		);
		expect(await actions.formsPreset(event)).toMatchObject({ presetApplied: { created: true } });
		expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ form_schemas: ['contact_messages', 'form_submissions'] });
	});

	it('says the types were created when the save after them is refused, and asks the page to reload', async () => {
		const { event } = act(
			{},
			{
				'GET /api/admin/schemas': json([]),
				[`GET ${BASE}/settings`]: json({ ...SETTINGS, form_schemas: [] }),
				'POST /api/admin/schemas/presets/forms': json({ created: ['forms', 'form_submissions'] }),
				[`PUT ${BASE}/settings`]: refusal(422, 'settings_invalid', 'Forms cannot send to form_submissions.', { field: 'form_schemas' }),
			},
		);
		const out = (await actions.formsPreset(event)) as Failure;
		expect(out.status).toBe(422);
		expect(out.data).toEqual({
			presetCreated: true,
			presetError:
				'The Forms and Form submissions content types were created, but forms cannot send to Form submissions yet. Forms cannot send to form_submissions.',
		});
	});

	it('only allows the submissions type when it exists already', async () => {
		const { event, calls } = act(
			{},
			{
				'GET /api/admin/schemas': json([{ name: 'form_submissions' }]),
				[`GET ${BASE}/settings`]: json({ ...SETTINGS, form_schemas: [] }),
				[`PUT ${BASE}/settings`]: json({ ...SETTINGS, form_schemas: ['form_submissions'] }),
			},
		);
		expect(await actions.formsPreset(event)).toMatchObject({ presetApplied: { created: false } });
		expect(calls.some((c) => c.method === 'POST')).toBe(false);
		expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ form_schemas: ['form_submissions'] });
	});

	it('says why when a forms type of the tenant keeps the preset out, and on the preset route 409', async () => {
		const taken = act({}, { 'GET /api/admin/schemas': json([{ name: 'forms' }]), [`GET ${BASE}/settings`]: json({ ...SETTINGS, form_schemas: [] }) });
		expect(await actions.formsPreset(taken.event)).toMatchObject({ status: 409, data: { presetError: FORMS_TYPE_TAKEN } });
		expect(taken.calls.some((c) => c.method !== 'GET')).toBe(false);

		const raced = act(
			{},
			{
				'GET /api/admin/schemas': json([]),
				[`GET ${BASE}/settings`]: json({ ...SETTINGS, form_schemas: [] }),
				'POST /api/admin/schemas/presets/forms': refusal(409, 'conflict', 'A schema named forms exists.'),
			},
		);
		expect(await actions.formsPreset(raced.event)).toMatchObject({ status: 409, data: { presetError: FORMS_TYPE_TAKEN } });
		expect(raced.calls.some((c) => c.method === 'PUT')).toBe(false);
	});

	it('says why when the submissions type is served by the delivery API', async () => {
		const { event, calls } = act(
			{},
			{
				'GET /api/admin/schemas': json([{ name: 'form_submissions', public_delivery: true }]),
				[`GET ${BASE}/settings`]: json({ ...SETTINGS, form_schemas: [] }),
			},
		);
		expect(await actions.formsPreset(event)).toMatchObject({ status: 409, data: { presetError: SUBMISSIONS_PUBLIC } });
		expect(calls.some((c) => c.method !== 'GET')).toBe(false);
	});

	it('says the preset is missing on a 404 and saves nothing', async () => {
		const { event, calls } = act({}, { 'GET /api/admin/schemas': json([]), [`GET ${BASE}/settings`]: json({ ...SETTINGS, form_schemas: [] }) });
		expect(await actions.formsPreset(event)).toMatchObject({ status: 404, data: { presetMissing: true } });
		expect(calls.some((c) => c.method === 'PUT')).toBe(false);
	});
});
