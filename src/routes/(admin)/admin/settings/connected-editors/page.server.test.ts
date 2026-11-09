import { describe, expect, it, vi } from 'vitest';

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
	'GET /api/admin/mfa/status': json({ enabled: false }),
};

describe('connected editors load', () => {
	it('makes no engine call while the plugin does not run', async () => {
		const { event, calls } = loadEvent(LISTED, { plugins: { state: 'named', running: [], withheld: [] } });
		const out = (await load(event)) as { gate: { state: string } };
		expect(out.gate).toEqual({ state: 'absent' });
		expect(calls).toEqual([]);
	});

	it('reads the list for an owner, and leaves the settings to their own page', async () => {
		const { event, calls } = loadEvent(LISTED);
		const out = (await load(event)) as Record<string, unknown>;
		expect(out.connections).toEqual([CONNECTION]);
		expect(out.owner).toBe(true);
		expect(calls.map((c) => c.path)).toContain(`${BASE}/connections?limit=50&offset=0`);
		expect(calls.some((c) => c.path.startsWith(`${BASE}/settings`))).toBe(false);
		expect(calls.some((c) => c.path === '/api/admin/schemas')).toBe(false);
	});

	it('marks a person below owner, who manages only their own connections', async () => {
		const { event } = loadEvent(LISTED, { roles: ['editor'] });
		expect(((await load(event)) as { owner: boolean }).owner).toBe(false);
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

describe('revoking every connection', () => {
	it('revokes nothing on a post that skipped the question', async () => {
		const e = engine({});
		const url = new URL('http://admin/admin/settings/connected-editors?/revokeAll');
		const out = await actions.revokeAll({ fetch: e.fetch, url, request: new Request(url, { method: 'POST', body: new FormData() }) } as never);
		expect(e.calls).toEqual([]);
		expect(out).toMatchObject({ unconfirmed: { question: 'Revoke all builder connections?', label: 'Revoke all', fields: [] } });
	});
});

function act(fields: Record<string, string | string[]>, routes: Routes) {
	const e = engine(routes);
	const body = new FormData();
	body.set('confirmed', 'yes');
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
		expect(((await actions.lookup(event)) as Failure).data.drawer).toEqual({ code: 'K7F3-A2M9', codeError: SAID.lookupFailed });
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

	it.each([
		[refusal(503, 'store_unavailable'), { revokeAllError: SAID.revokeAllFailed }],
		[refusal(403, 'TENANT_FEATURE_WITHHELD'), { revokeError: SAID.withheld }],
		[
			refusal(403, 'permission_denied', 'Your role cannot revoke builder connections.'),
			{ revokeAllError: 'Your role cannot revoke builder connections.' },
		],
		[json({ error: 'boom' }, 500), { revokeAllError: 'Could not revoke the connections. Try again.' }],
	])('reports a failed revoke all in its own words', async (reply, data) => {
		const { event } = act({}, { [`POST ${BASE}/connections/revoke-all`]: reply });
		expect(((await actions.revokeAll(event)) as Failure).data).toEqual(data);
	});
});
