import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/authz', async () => {
	const { createClient } = await vi.importActual<typeof import('@lyeve-labs/client')>('@lyeve-labs/client');
	return { authedClient: (event: { fetch: typeof fetch }) => createClient(event.fetch) };
});

import { actions, load } from './+page.server';
import { SAID } from '$lib/api/connected-editors';

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

const CONNECTION = {
	id: 'c1',
	approver_email: 'tom@example.com',
	fingerprint: '3FA2:9C11:5B07:E48D',
	label: 'Tom laptop',
	origin: 'https://builder.example',
	approved_at: '2026-10-02T10:00:00Z',
	last_used_at: '2026-10-09T10:00:00Z',
	expires_at: '2026-12-31T10:00:00Z',
	status: 'approved',
};

const SETTINGS = { allowed: true, lifetime_days: 90, show_schemas: ['posts'], writes_per_minute: 120, max_writes_per_minute: 120 };

function loadEvent(routes: Routes, { roles = ['admin'], search = '', plugins = RUNNING as unknown } = {}) {
	const e = engine(routes);
	const url = new URL(`http://admin/admin/settings/connected-editors${search}`);
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
	[`GET ${BASE}/connections`]: json({ data: [CONNECTION], total: 1 }),
	[`GET ${BASE}/settings`]: json(SETTINGS),
	'GET /api/admin/schemas': json([{ name: 'posts' }, { name: 'lyeve_builder_pages' }, { name: 'products' }]),
	'GET /api/admin/mfa/status': json({ enabled: false }),
};

describe('connected editors load', () => {
	it('makes no engine call while the plugin does not run', async () => {
		const { event, calls } = loadEvent(LISTED, { plugins: { state: 'named', running: [], withheld: [] } });
		const out = (await load(event)) as { gate: { state: string } };
		expect(out.gate).toEqual({ state: 'absent' });
		expect(calls).toEqual([]);
	});

	it('reads the list, the settings and the schemas for an owner', async () => {
		const { event, calls } = loadEvent(LISTED);
		const out = (await load(event)) as Record<string, unknown>;
		expect(out.connections).toEqual([CONNECTION]);
		expect(out.settings).toEqual({ ok: true, value: SETTINGS });
		expect(out.schemas).toEqual(['posts', 'products']);
		expect(out.schemasFailed).toBe(false);
		expect(out.owner).toBe(true);
		expect(calls.map((c) => c.path)).toContain(`${BASE}/connections?limit=50&offset=0`);
	});

	it('never reads the settings for a person below owner', async () => {
		const { event, calls } = loadEvent(LISTED, { roles: ['editor'] });
		const out = (await load(event)) as Record<string, unknown>;
		expect(out.settings).toBeNull();
		expect(out.owner).toBe(false);
		expect(calls.some((c) => c.path.startsWith(`${BASE}/settings`))).toBe(false);
		expect(calls.some((c) => c.path === '/api/admin/schemas')).toBe(false);
	});

	it.each([
		[refusal(404, 'not_found'), { state: 'absent' }],
		[refusal(403, 'permission_denied'), { state: 'forbidden' }],
		[refusal(403, 'TENANT_FEATURE_WITHHELD'), { state: 'withheld' }],
		[refusal(429, 'too_many'), { state: 'busy' }],
		[refusal(503, 'store_unavailable'), { state: 'unavailable' }],
		[json({ error: 'boom' }, 500), { state: 'error', message: 'Could not load builder connections.' }],
	])('turns a refused list into its gate', async (reply, gate) => {
		const { event } = loadEvent({ ...LISTED, [`GET ${BASE}/connections`]: reply });
		const out = (await load(event)) as { gate: unknown; connections: unknown[] };
		expect(out.gate).toEqual(gate);
		expect(out.connections).toEqual([]);
	});

	it('says the schema list failed rather than reading it as empty', async () => {
		const { event } = loadEvent({ ...LISTED, 'GET /api/admin/schemas': refusal(503, 'store_unavailable') });
		const out = (await load(event)) as { schemas: unknown; schemasFailed: unknown };
		expect(out.schemas).toEqual([]);
		expect(out.schemasFailed).toBe(true);
	});

	it('keeps a refused settings read beside a list that answered', async () => {
		const { event } = loadEvent({ ...LISTED, [`GET ${BASE}/settings`]: refusal(503, 'store_unavailable') });
		const out = (await load(event)) as { settings: unknown; gate: unknown };
		expect(out.gate).toEqual({ state: 'ok' });
		expect(out.settings).toEqual({ ok: false, gate: { state: 'unavailable' } });
	});

	it('sends a page past the end back to the last page', async () => {
		const { event } = loadEvent({ ...LISTED, [`GET ${BASE}/connections`]: json({ data: [], total: 120 }) }, { search: '?offset=500&limit=50' });
		await expect(load(event)).rejects.toMatchObject({ status: 307, location: '/admin/settings/connected-editors?offset=100&limit=50' });
	});

	it('opens the drawer for the builder link, which carries no code', async () => {
		const { event } = loadEvent(LISTED, { search: '?approve' });
		expect(((await load(event)) as { openApprove: boolean }).openApprove).toBe(true);
	});

	it('reads the confirmation the account will be asked for', async () => {
		const { event } = loadEvent({ ...LISTED, 'GET /api/admin/mfa/status': json({ enabled: true }) });
		expect(((await load(event)) as { mfaEnrolled: boolean }).mfaEnrolled).toBe(true);
	});
});

type Failure = { status: number; data: Record<string, unknown> };

function act(fields: Record<string, string | string[]>, routes: Routes) {
	const e = engine(routes);
	const body = new FormData();
	for (const [k, v] of Object.entries(fields)) {
		for (const one of Array.isArray(v) ? v : [v]) body.append(k, one);
	}
	const url = new URL('http://admin/admin/settings/connected-editors');
	return { ...e, event: { fetch: e.fetch, url, request: new Request(url, { method: 'POST', body }) } as never };
}

const REQUEST = {
	fingerprint: '3FA2:9C11:5B07:E48D',
	label: 'Maria laptop',
	origin: 'https://builder.example',
	requested_at: '2026-10-30T10:00:00Z',
	code_expires_at: '2099-01-01T00:00:00Z',
	would_expire_at: '2099-04-01T00:00:00Z',
	lifetime_days: 90,
	requester_network: '203.0.113.7',
	approver_address: '203.0.113.7',
	same_network: true,
};

const REQ = `${BASE}/connections/requests/K7F3-A2M9`;

describe('lookup', () => {
	it('reads a code the way a person types it', async () => {
		const { event, calls } = act({ code: 'k7f3 a2m9' }, { [`GET ${REQ}`]: json(REQUEST) });
		expect(await actions.lookup(event)).toEqual({ drawer: { code: 'K7F3-A2M9', request: REQUEST } });
		expect(calls.map((c) => c.path)).toEqual([REQ]);
	});

	it('refuses a malformed code without asking the engine', async () => {
		const { event, calls } = act({ code: 'K7F3-A2M0' }, {});
		expect(((await actions.lookup(event)) as Failure).data.drawer).toEqual({ code: 'K7F3-A2M0', codeError: SAID.malformed });
		expect(calls).toEqual([]);
	});

	it('says no request waits under a wrong code', async () => {
		const { event } = act({ code: 'K7F3A2M9' }, { [`GET ${REQ}`]: refusal(404, 'request_unknown') });
		expect(((await actions.lookup(event)) as Failure).data.drawer).toEqual({ code: 'K7F3-A2M9', codeError: SAID.unknown });
	});

	it("puts a viewer's refusal on the code field in the engine's words", async () => {
		const { event } = act(
			{ code: 'K7F3A2M9' },
			{ [`GET ${REQ}`]: refusal(403, 'permission_denied', 'Your role cannot approve a builder connection.') },
		);
		expect(((await actions.lookup(event)) as Failure).data.drawer).toEqual({
			code: 'K7F3-A2M9',
			codeError: 'Your role cannot approve a builder connection.',
		});
	});

	it('keeps outage detail off the page', async () => {
		const { event } = act({ code: 'K7F3A2M9' }, { [`GET ${REQ}`]: json({ error: 'dial tcp 10.0.0.4:5432' }, 503) });
		expect(((await actions.lookup(event)) as Failure).data.drawer).toEqual({ code: 'K7F3-A2M9', codeError: SAID.lookupOutage });
	});
});

const APPROVE = { code: 'K7F3-A2M9', fingerprint: REQUEST.fingerprint, lifetime_days: '90', code_expires_at: REQUEST.code_expires_at, step: 'password', password: 'hunter2' };

function approveWith(reply: Response, fields: Record<string, string> = {}, routes: Routes = {}) {
	return act({ ...APPROVE, ...fields }, { [`POST ${REQ}/approve`]: reply, ...routes });
}

describe('approve', () => {
	it('approves with the fingerprint, the lifetime and the password', async () => {
		const { event, calls } = approveWith(json({ status: 'approved', expires_at: '2027-01-28T00:00:00Z' }));
		expect(await actions.approve(event)).toEqual({ approved: { expires_at: '2027-01-28T00:00:00Z' } });
		expect(calls[0].body).toEqual({ fingerprint: REQUEST.fingerprint, lifetime_days: 90, password: 'hunter2' });
	});

	it('sends the MFA code for an account that has one', async () => {
		const { event, calls } = approveWith(json({ status: 'approved', expires_at: 'x' }), { step: 'mfa_code', mfa_code: ' 123456 ', password: '' });
		await actions.approve(event);
		expect(calls[0].body).toEqual({ fingerprint: REQUEST.fingerprint, lifetime_days: 90, mfa_code: '123456' });
	});

	it('asks for the confirmation before it asks the engine', async () => {
		const { event, calls } = approveWith(json({}), { password: '' });
		expect(((await actions.approve(event)) as Failure).data.drawer).toEqual({
			code: 'K7F3-A2M9',
			stepUp: { field: SAID.stepUpMissing, needsMfa: false },
		});
		expect(calls).toEqual([]);
	});

	it('puts step_up_required on the field', async () => {
		const { event } = approveWith(refusal(403, 'step_up_required'));
		expect(((await actions.approve(event)) as Failure).data.drawer).toMatchObject({ stepUp: { field: SAID.stepUpMissing } });
	});

	it('puts a wrong password on the field in the admin words', async () => {
		const { event } = approveWith(refusal(403, 'step_up_refused', 'The password is not valid.'));
		const out = (await actions.approve(event)) as Failure;
		expect(out.status).toBe(403);
		expect(out.data.drawer).toMatchObject({ stepUp: { field: 'That password is not right.', needsMfa: false } });
	});

	it('puts a wrong MFA code on the field', async () => {
		const { event } = approveWith(
			refusal(403, 'step_up_refused', 'The MFA code is not valid, or it was already used. Wait for the next one.'),
			{ step: 'mfa_code', mfa_code: '000000' },
		);
		expect(((await actions.approve(event)) as Failure).data.drawer).toMatchObject({
			stepUp: { field: 'That code is not right. Enter the current code from your authenticator app.', needsMfa: true },
		});
	});

	it('asks for the MFA code when the account has one and the password came', async () => {
		const { event } = approveWith(refusal(403, 'step_up_refused', 'This account has MFA enrolled. Confirm with your MFA code.'));
		expect(((await actions.approve(event)) as Failure).data.drawer).toMatchObject({
			stepUp: { field: 'This account has MFA enrolled. Confirm with your MFA code.', needsMfa: true },
		});
	});

	it('lands a lockout on the field with its own words, never the busy ones', async () => {
		const { event } = approveWith(refusal(429, 'step_up_refused', 'Too many wrong answers. Wait 15 minutes, then try again.'));
		const out = (await actions.approve(event)) as Failure;
		expect(out.status).toBe(429);
		expect(out.data.drawer).toMatchObject({ stepUp: { field: 'Too many wrong answers. Wait 15 minutes, then try again.' } });
	});

	it('says approval is unavailable on an engine without the step-up', async () => {
		const { event } = approveWith(refusal(503, 'approval_unavailable'));
		expect(((await actions.approve(event)) as Failure).data.drawer).toEqual({ code: 'K7F3-A2M9', approvalUnavailable: true });
	});

	it('tells a failed check apart from a refused answer', async () => {
		const { event } = approveWith(refusal(503, 'check_unavailable', 'Your account could not be checked. Try again.'));
		expect(((await actions.approve(event)) as Failure).data.drawer).toEqual({ code: 'K7F3-A2M9', checkUnavailable: true });
	});

	it('tells a store outage apart from both', async () => {
		const { event } = approveWith(refusal(503, 'store_unavailable'));
		expect(((await actions.approve(event)) as Failure).data.drawer).toEqual({ code: 'K7F3-A2M9', error: SAID.approveOutage });
	});

	it('says no request waits under the code while it still had time', async () => {
		const { event } = approveWith(refusal(404, 'request_unknown'));
		expect(((await actions.approve(event)) as Failure).data.drawer).toEqual({ code: 'K7F3-A2M9', codeError: SAID.unknown });
	});

	it('says the request ran out once its code expired', async () => {
		const { event } = approveWith(refusal(404, 'request_unknown'), { code_expires_at: '2020-01-01T00:00:00Z' });
		expect(((await actions.approve(event)) as Failure).data.drawer).toEqual({ code: 'K7F3-A2M9', expired: true });
	});

	it('says another tab decided it first', async () => {
		const { event } = approveWith(refusal(409, 'request_decided'));
		expect(((await actions.approve(event)) as Failure).data.drawer).toEqual({ code: 'K7F3-A2M9', decided: true });
	});

	it('looks the code up again when the key changed', async () => {
		const fresh = { ...REQUEST, fingerprint: 'B704:E15D:22C8:91AF' };
		const { event, calls } = approveWith(refusal(409, 'key_changed'), {}, { [`GET ${REQ}`]: json(fresh) });
		expect(((await actions.approve(event)) as Failure).data.drawer).toEqual({ code: 'K7F3-A2M9', keyChanged: true, request: fresh });
		expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([`POST ${REQ}/approve`, `GET ${REQ}`]);
	});

	it('reads the lifetimes again when an owner shortened them', async () => {
		const fresh = { ...REQUEST, lifetime_days: 30 };
		const { event } = approveWith(refusal(422, 'lifetime_invalid'), {}, { [`GET ${REQ}`]: json(fresh) });
		expect(((await actions.approve(event)) as Failure).data.drawer).toEqual({ code: 'K7F3-A2M9', lifetimeChanged: true, request: fresh });
	});

	it('says so when the tenant has the plugin withheld', async () => {
		const { event } = approveWith(refusal(403, 'TENANT_FEATURE_WITHHELD'));
		expect(((await actions.approve(event)) as Failure).data.drawer).toEqual({ code: 'K7F3-A2M9', withheld: true });
	});

	it("shows the engine's sentence for a builder that is turned off", async () => {
		const msg = 'The builder is turned off. Turn it on under Settings, Builder connections first.';
		const { event } = approveWith(refusal(403, 'builder_off', msg));
		expect(((await actions.approve(event)) as Failure).data.drawer).toEqual({ code: 'K7F3-A2M9', error: msg });
	});
});

describe('decline', () => {
	it('declines the code', async () => {
		const { event, calls } = act({ code: 'K7F3-A2M9' }, { [`POST ${REQ}/decline`]: json({ status: 'declined' }) });
		expect(await actions.decline(event)).toEqual({ declined: true });
		expect(calls).toEqual([{ method: 'POST', path: `${REQ}/decline`, body: {} }]);
	});

	it.each([
		[refusal(409, 'request_decided'), { code: 'K7F3-A2M9', decided: true }],
		[refusal(404, 'request_unknown'), { code: 'K7F3-A2M9', codeError: SAID.unknown }],
		[refusal(403, 'permission_denied', 'Your role cannot decline a builder connection.'), { code: 'K7F3-A2M9', error: 'Your role cannot decline a builder connection.' }],
		[json({ error: 'dial tcp' }, 502), { code: 'K7F3-A2M9', error: SAID.declineOutage }],
	])('reports a refused decline in the drawer', async (reply, drawer) => {
		const { event } = act({ code: 'K7F3-A2M9' }, { [`POST ${REQ}/decline`]: reply });
		expect(((await actions.decline(event)) as Failure).data.drawer).toEqual(drawer);
	});
});

describe('revoke', () => {
	it('revokes the connection and names whose it was', async () => {
		const { event, calls } = act({ id: 'c1', person: 'tom@example.com' }, { [`POST ${BASE}/connections/c1/revoke`]: json({ status: 'revoked' }) });
		expect(await actions.revoke(event)).toEqual({ revoked: 'tom@example.com' });
		expect(calls).toEqual([{ method: 'POST', path: `${BASE}/connections/c1/revoke`, body: {} }]);
	});

	it("relays the engine's sentence for a connection it does not hold", async () => {
		const { event } = act({ id: 'c9', person: 'x' }, { [`POST ${BASE}/connections/c9/revoke`]: refusal(404, 'connection_unknown', 'No connection has this id.') });
		expect(((await actions.revoke(event)) as Failure).data.revokeError).toBe('No connection has this id.');
	});

	it('keeps outage detail off the page', async () => {
		const { event } = act({ id: 'c1', person: 'x' }, { [`POST ${BASE}/connections/c1/revoke`]: json({ error: 'dial tcp' }, 503) });
		expect(((await actions.revoke(event)) as Failure).data.revokeError).toBe(SAID.revokeOutage);
	});

	it('revokes every connection and counts them', async () => {
		const { event } = act({}, { [`POST ${BASE}/connections/revoke-all`]: json({ revoked: 3, declined: 1 }) });
		expect(await actions.revokeAll(event)).toEqual({ revokedAll: 3 });
	});

	it('reports a failed revoke all', async () => {
		const { event } = act({}, { [`POST ${BASE}/connections/revoke-all`]: refusal(503, 'store_unavailable') });
		expect(((await actions.revokeAll(event)) as Failure).data).toEqual({ revokeAllFailed: true });
	});
});

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
	const trigger = { type: 'trigger.event', config: { kind: 'system', name: 'builder.form.submitted' } };
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
				{ id: 'f1', slug: 'notify', name: 'Notify', status: 'active', version: 1, trigger_type: 'trigger.event' },
				{ id: 'f2', slug: 'hook', name: 'Hook', status: 'active', version: 1, trigger_type: 'trigger.http' },
			],
			total: 2,
		}),
		'GET /api/admin/flows/f1/versions/1': json({ definition: { trigger } }),
		'GET /api/admin/schemas/presets': json({ presets: [{ id: 'forms', name: 'Forms', description: '', schemas: [] }] }),
	};

	it('offers the types forms can save into, the preset type first, with the flows and the preset', async () => {
		const { event } = loadEvent(FORMS_ROUTES, { plugins: FULL });
		const out = (await load(event)) as Record<string, unknown>;
		// A type the delivery API serves and the builder's own types are never offered.
		expect(out.formSchemas).toEqual([
			{ name: 'form_submissions', label: 'Form submissions' },
			{ name: 'contact_messages', label: 'Contact messages' },
		]);
		expect(out.flows).toEqual({
			ok: true,
			value: [
				{ id: 'f1', slug: 'notify', name: 'Notify', status: 'active', formTrigger: true },
				{ id: 'f2', slug: 'hook', name: 'Hook', status: 'active', formTrigger: false },
			],
		});
		expect(out.formsPreset).toBe(true);
	});

	it('reads no flows and no preset for a reader who cannot change the settings', async () => {
		const { event, calls } = loadEvent(FORMS_ROUTES, { plugins: FULL, roles: ['editor'] });
		const out = (await load(event)) as Record<string, unknown>;
		expect(out.flows).toBeNull();
		expect(out.formsPreset).toBe(false);
		expect(calls.some((c) => c.path.startsWith('/api/admin/flows') || c.path.startsWith('/api/admin/schemas/presets'))).toBe(false);
	});

	it.each([
		[
			{ field: 'forms', form_schemas_offered: '1', form_schemas: ['form_submissions'], form_flows_offered: '1', form_flows: ['notify'] },
			{ form_schemas: ['form_submissions'], form_flows: ['notify'] },
		],
		// A flow list that failed to load leaves the flows as they are.
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

	it('applies the forms preset and allows its submissions type', async () => {
		const { event, calls } = act(
			{},
			{
				'GET /api/admin/schemas': json([{ name: 'posts' }]),
				[`GET ${BASE}/settings`]: json({ ...SETTINGS, form_schemas: ['contact_messages'] }),
				'POST /api/admin/schemas/presets/forms': json({ created: ['forms', 'form_submissions'] }),
				[`PUT ${BASE}/settings`]: json({ ...SETTINGS, form_schemas: ['contact_messages', 'form_submissions'] }),
			},
		);
		expect(await actions.formsPreset(event)).toMatchObject({ presetApplied: { created: true } });
		expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ form_schemas: ['contact_messages', 'form_submissions'] });
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

	it('says the preset is missing on a 404 and saves nothing', async () => {
		const { event, calls } = act({}, { 'GET /api/admin/schemas': json([]), [`GET ${BASE}/settings`]: json({ ...SETTINGS, form_schemas: [] }) });
		expect(await actions.formsPreset(event)).toMatchObject({ status: 404, data: { presetMissing: true } });
		expect(calls.some((c) => c.method === 'PUT')).toBe(false);
	});
});
