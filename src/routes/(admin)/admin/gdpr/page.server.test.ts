import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@lyeve-labs/client';

const rest = vi.hoisted(() => ({ exportSubject: vi.fn(), eraseSubject: vi.fn() }));
vi.mock('@lyeve-labs/client-rest', () => rest);

const engine = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));

const authz = vi.hoisted(() => ({
	authedClient: vi.fn(() => engine),
	requireRole: vi.fn(async () => ({ id: 'u1', roles: ['super_admin'] })),
	loadUser: vi.fn(async () => ({ id: 'u1', roles: ['super_admin'] })),
}));
vi.mock('$lib/server/authz', () => authz);

import { actions, load } from './+page.server';

function formEvent(fields: Record<string, string>) {
	const body = new FormData();
	for (const [k, v] of Object.entries(fields)) body.set(k, v);
	return { request: new Request('http://admin/admin/gdpr', { method: 'POST', body }), cookies: {}, fetch: vi.fn() } as never;
}

type Failure = { status: number; data: { error: string } };

beforeEach(() => vi.clearAllMocks());

// A failed privacy request names the subject's data. The engine's own text
// for a failure can carry driver detail, so only a refusal written for the
// operator reaches the page.
describe('privacy request failures', () => {
	it('keeps the text of an engine failure off the page on export', async () => {
		rest.exportSubject.mockRejectedValue(new ApiError(500, 'pq: relation "sys_users" does not exist'));
		const out = (await actions.export(formEvent({ subject: 'jane@example.com' }))) as Failure;
		expect(out.data.error).not.toContain('sys_users');
		expect(out.data.error).toBe('Could not export data for this subject. Try again.');
	});

	it('keeps the text of an engine failure off the page on erasure', async () => {
		rest.eraseSubject.mockRejectedValue(new ApiError(503, 'dial tcp 10.0.0.4:5432: connection refused'));
		const out = (await actions.erase(formEvent({ subject: 'jane@example.com', confirm: 'jane@example.com' }))) as Failure;
		expect(out.data.error).not.toContain('10.0.0.4');
		expect(out.data.error).toBe('Could not start the erasure. Nothing was erased. Try again.');
	});

	it('relays a refusal written for the operator', async () => {
		rest.eraseSubject.mockRejectedValue(new ApiError(400, 'identifier must be an email address or a user id', { error: 'identifier must be an email address or a user id', code: 'bad_request' }));
		const out = (await actions.erase(formEvent({ subject: 'x', confirm: 'x' }))) as Failure;
		expect(out.data.error).toBe('identifier must be an email address or a user id');
	});
});

// The engine serves both privacy requests to a super admin only, and an
// erasure cannot be undone, so the action asks before it sends anything.
describe('privacy requests', () => {
	it('exports the named subject and hands back what the engine found', async () => {
		const bundle = {
			identifier: 'jane@example.com',
			plugins: { users: { id: 'u9', email: 'jane@example.com' } },
			incomplete: false,
			scope: { mode: 'tenant', tenants: ['acme'], tenants_requested: 1, tenants_covered: 1 },
			summary: { total_records: 1, plugins_queried: 4, plugins_with_data: 1 },
			errors: [],
		};
		rest.exportSubject.mockResolvedValue(bundle);
		const out = await actions.export(formEvent({ subject: ' jane@example.com ' }));
		expect(rest.exportSubject).toHaveBeenCalledWith('jane@example.com', expect.anything());
		expect(out).toEqual({ action: 'export', ok: true, subject: 'jane@example.com', result: bundle });
	});

	it('erases the subject once the confirmation matches', async () => {
		const erased = { identifier: 'jane@example.com', total_rows: 3, errors: [] };
		rest.eraseSubject.mockResolvedValue(erased);
		const out = await actions.erase(formEvent({ subject: 'jane@example.com', confirm: 'jane@example.com' }));
		expect(rest.eraseSubject).toHaveBeenCalledWith('jane@example.com', expect.anything());
		expect(out).toEqual({ action: 'erase', ok: true, subject: 'jane@example.com', result: erased });
	});

	// The engine answers 200 for an erasure a legal hold stopped. The holds are
	// the only sign that nothing was erased, so they reach the page intact.
	it('hands back the holds that stopped an erasure', async () => {
		const held = { identifier: 'jane@example.com', total_rows: 0, errors: [], holds: [{ id: 'h1', reason: 'Litigation 42' }] };
		rest.eraseSubject.mockResolvedValue(held);
		const out = (await actions.erase(formEvent({ subject: 'jane@example.com', confirm: 'jane@example.com' }))) as { result: typeof held };
		expect(out.result.holds).toEqual([{ id: 'h1', reason: 'Litigation 42' }]);
		expect(out.result.total_rows).toBe(0);
	});

	it('erases nothing when the confirmation names someone else', async () => {
		const out = (await actions.erase(formEvent({ subject: 'jane@example.com', confirm: 'john@example.com' }))) as Failure;
		expect(out.status).toBe(400);
		expect(out.data.error).toBe('Type the subject exactly as above.');
		expect(rest.eraseSubject).not.toHaveBeenCalled();
	});

	it.each(['export', 'erase'] as const)('asks for a subject before %s', async (name) => {
		const out = (await actions[name](formEvent({ subject: ' ', confirm: ' ' }))) as Failure;
		expect(out.data.error).toBe("Enter the subject's email or ID.");
		expect(rest.exportSubject).not.toHaveBeenCalled();
		expect(rest.eraseSubject).not.toHaveBeenCalled();
	});

	it.each(['export', 'erase'] as const)('stops %s for a reader who is not a super admin', async (name) => {
		authz.requireRole.mockRejectedValueOnce(Object.assign(new Error('403'), { status: 403 }));
		await expect(actions[name](formEvent({ subject: 'jane@example.com', confirm: 'jane@example.com' }))).rejects.toMatchObject({ status: 403 });
		expect(authz.requireRole).toHaveBeenCalledWith(expect.anything(), ['super_admin']);
		expect(rest.exportSubject).not.toHaveBeenCalled();
		expect(rest.eraseSubject).not.toHaveBeenCalled();
	});
});

const STEP_UP_URL = '/api/admin/analytics/gdpr/export-step-up';
const named = (running: string[]) => ({ state: 'named', running, withheld: [] });
type Loaded = Exclude<Awaited<ReturnType<typeof load>>, void>;

function loadEvent(plugins: unknown = named(['analytics'])) {
	return { url: new URL('http://admin/admin/gdpr'), cookies: {}, fetch: vi.fn(), parent: async () => ({ plugins, pluginStatus: null }) } as never;
}

function factorsEvent(factors: string[]) {
	const body = new FormData();
	for (const f of factors) body.append('factors', f);
	return { request: new Request('http://admin/admin/gdpr', { method: 'POST', body }), cookies: {}, fetch: vi.fn() } as never;
}

describe('the export step-up load', () => {
	it('carries the stored factors', async () => {
		engine.get.mockResolvedValue({ factors: ['password', 'code'] });
		const out = (await load(loadEvent())) as Loaded;
		expect(engine.get).toHaveBeenCalledWith(STEP_UP_URL);
		expect(out.stepUp).toEqual({ ok: true, value: { factors: ['password', 'code'] } });
	});

	it('says the plugin is stopped, without asking, rather than drawing nothing', async () => {
		const out = (await load(loadEvent(named([])))) as Loaded;
		expect(engine.get).not.toHaveBeenCalled();
		expect(out.stepUp).toEqual({ ok: false, stopped: { state: 'unexplained' } });
	});

	it('leaves the setting out on an engine without the route', async () => {
		engine.get.mockRejectedValue(new ApiError(404, 'not found'));
		expect(((await load(loadEvent())) as Loaded).stepUp).toBeNull();
	});

	it('reports a failed read as a failure, never as no step', async () => {
		engine.get.mockRejectedValue(new ApiError(500, 'boom'));
		expect(((await load(loadEvent())) as Loaded).stepUp).toMatchObject({ ok: false, gate: { state: 'error' } });
	});

	it('refuses a reader who is not a super admin', async () => {
		authz.loadUser.mockResolvedValueOnce({ id: 'u2', roles: ['admin'] });
		await expect(load(loadEvent())).rejects.toMatchObject({ status: 403, body: { message: 'Only a super admin can open this page.' } });
		expect(engine.get).not.toHaveBeenCalled();
	});
});

describe('the export step-up save', () => {
	it('sends the ticked factors', async () => {
		engine.put.mockResolvedValue({ factors: ['password', 'email'] });
		const out = await actions.stepUp(factorsEvent(['password', 'email']));
		expect(engine.put).toHaveBeenCalledWith(STEP_UP_URL, { factors: ['password', 'email'] });
		expect(out).toEqual({ action: 'stepUp', ok: true });
	});

	it('sends an empty list when nothing is ticked', async () => {
		engine.put.mockResolvedValue({ factors: [] });
		await actions.stepUp(factorsEvent([]));
		expect(engine.put).toHaveBeenCalledWith(STEP_UP_URL, { factors: [] });
	});

	it('refuses a factor it does not know without asking the engine', async () => {
		const out = (await actions.stepUp(factorsEvent(['password', 'sms']))) as Failure;
		expect(engine.put).not.toHaveBeenCalled();
		expect(out.status).toBe(400);
	});

	it('says the install cannot send mail when the engine refuses the email factor', async () => {
		engine.put.mockRejectedValue(new ApiError(422, 'this install has no way to send mail, so email cannot be required', { code: 'step_up_mail_unavailable' }));
		const out = (await actions.stepUp(factorsEvent(['email']))) as Failure;
		expect(out.status).toBe(422);
		expect(out.data.error).toContain('Email is not set up');
	});

	it('reads the refusal by its status, whatever its code is named', async () => {
		engine.put.mockRejectedValue(new ApiError(422, 'no mail', { code: 'step_up_email_unavailable' }));
		const out = (await actions.stepUp(factorsEvent(['email']))) as Failure;
		expect(out.data.error).toContain('Email is not set up');
	});

	it("puts the engine's refusal of an unknown factor in the console's words", async () => {
		engine.put.mockRejectedValue(new ApiError(400, 'a factor is not one of password, code and email'));
		const out = (await actions.stepUp(factorsEvent(['code']))) as Failure;
		expect(out.data.error).toBe('One of the chosen steps is not available. Reload the page and try again.');
	});

	it('reports an outage as one, and keeps its engine text off the page', async () => {
		engine.put.mockRejectedValue(new ApiError(503, 'dial tcp 10.0.0.4:5432: connection refused'));
		const out = (await actions.stepUp(factorsEvent(['code']))) as Failure;
		expect(out.status).toBe(503);
		expect(out.data.error).not.toContain('10.0.0.4');
	});

	it('carries a license refusal with its status and its way forward', async () => {
		engine.put.mockRejectedValue(new ApiError(402, 'payment required', { error: 'payment_required', feature: 'analytics', plugin: 'analytics' }));
		const out = (await actions.stepUp(factorsEvent(['code']))) as { status: number; data: { action: string; refused?: { kind: string } } };
		expect(out.status).toBe(402);
		expect(out.data.action).toBe('stepUp');
		expect(out.data.refused?.kind).toBe('feature');
	});
});
