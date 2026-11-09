import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiError } from '@lyeve-labs/client';

const engine = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));

vi.mock('$lib/server/authz', () => ({
	authedClient: vi.fn(() => engine),
	requireRole: vi.fn(async () => ({ id: 'u1', roles: ['admin'] })),
}));

import { load, actions } from './+page.server';

type Loaded = Exclude<Awaited<ReturnType<typeof load>>, void>;

const named = (running: string[]) => ({ state: 'named', running, withheld: [] });

function loadEvent(plugins: unknown = named(['schema']), roles: string[] = ['admin']) {
	return {
		url: new URL('http://admin/admin/settings/privacy'),
		cookies: {},
		fetch: vi.fn(),
		parent: async () => ({ user: { roles }, plugins, pluginStatus: null }),
	} as never;
}

function formEvent(fields: Record<string, string>) {
	const body = new FormData();
	for (const [k, v] of Object.entries(fields)) body.set(k, v);
	return {
		request: new Request('http://admin/admin/settings/privacy', { method: 'POST', body }),
		cookies: {},
		fetch: vi.fn(),
	} as never;
}

beforeEach(() => vi.clearAllMocks());

describe('privacy settings load', () => {
	it('carries the stored form erasure mode', async () => {
		engine.get.mockResolvedValue({ mode: 'soft' });
		const result = (await load(loadEvent())) as Loaded;
		expect(engine.get).toHaveBeenCalledWith('/api/admin/schemas/form-erasure');
		expect(result.formErasure).toEqual({ ok: true, value: { mode: 'soft' } });
	});

	it('says the plugin is stopped, without asking, rather than drawing nothing', async () => {
		const result = (await load(loadEvent(named([])))) as Loaded;
		expect(engine.get).not.toHaveBeenCalled();
		expect(result.formErasure).toEqual({ ok: false, stopped: { state: 'unexplained' } });
	});

	it('says a plugin withheld from this tenant is withheld', async () => {
		const result = (await load(loadEvent({ state: 'named', running: [], withheld: ['schema'] }))) as Loaded;
		expect(result.formErasure).toEqual({ ok: false, stopped: { state: 'withheld' } });
	});

	it('answers 403 to a role that may not use the page, without asking the engine', async () => {
		await expect(load(loadEvent(named(['schema']), ['editor']))).rejects.toMatchObject({
			status: 403,
			body: { message: 'Only an admin or a super admin can open this page.' },
		});
		expect(engine.get).not.toHaveBeenCalled();
	});

	it('opens for a super admin', async () => {
		engine.get.mockResolvedValue({ mode: 'auto' });
		const result = (await load(loadEvent(named(['schema']), ['super_admin']))) as Loaded;
		expect(result.formErasure).toEqual({ ok: true, value: { mode: 'auto' } });
	});

	it('leaves the setting out on an engine whose route is not there', async () => {
		engine.get.mockRejectedValue(new ApiError(404, 'not found'));
		const result = (await load(loadEvent())) as Loaded;
		expect(result.formErasure).toBeNull();
	});

	it('reports a failed read as a failure, never as the default', async () => {
		engine.get.mockRejectedValue(new ApiError(500, 'boom'));
		const result = (await load(loadEvent())) as Loaded;
		expect(result.formErasure).toMatchObject({ ok: false, gate: { state: 'error' } });
	});

	it('reports an outage as one', async () => {
		engine.get.mockRejectedValue(new ApiError(503, 'down'));
		const result = (await load(loadEvent())) as Loaded;
		expect(result.formErasure).toEqual({ ok: false, gate: { state: 'unavailable' } });
	});

	it('says once that the session names no tenant, and draws no card', async () => {
		engine.get.mockRejectedValue(new ApiError(400, 'the form erasure mode belongs to a tenant, and the request names none'));
		const result = (await load(loadEvent())) as Loaded;
		expect(result).toEqual({ noTenant: true, formErasure: null, exportSections: null, exportRoles: null });
	});
});

describe('privacy settings: form erasure save', () => {
	it('sends the chosen mode', async () => {
		engine.put.mockResolvedValue({ mode: 'hard' });
		const result = await actions.erasure(formEvent({ mode: 'hard' }));
		expect(engine.put).toHaveBeenCalledWith('/api/admin/schemas/form-erasure', { mode: 'hard' });
		expect(result).toEqual({ action: 'erasure', saved: true });
	});

	it('refuses a mode the engine does not know without asking it', async () => {
		const result = (await actions.erasure(formEvent({ mode: 'delete' }))) as { status: number; data: { action: string } };
		expect(engine.put).not.toHaveBeenCalled();
		expect(result.status).toBe(400);
		expect(result.data.action).toBe('erasure');
	});

	it('reports an outage as one, and keeps its engine detail off the page', async () => {
		engine.put.mockRejectedValue(new ApiError(503, 'pq: connection refused'));
		const result = (await actions.erasure(formEvent({ mode: 'auto' }))) as { status: number; data: { error: string } };
		expect(result.status).toBe(503);
		expect(result.data.error).not.toContain('pq');
		expect(result.data.error).toContain('Could not save');
	});
});

/** Answers each route the load reads from `answers`, by path. A value that is an Error is thrown. */
function route(answers: Record<string, unknown>) {
	engine.get.mockImplementation(async (url: string) => {
		const answer = answers[url];
		if (answer instanceof Error) throw answer;
		if (answer === undefined) throw new ApiError(404, 'not found');
		return answer;
	});
}

const SECTIONS_URL = '/api/admin/analytics/gdpr/export-sections';
const ROLES_URL = '/api/admin/analytics/gdpr/export-roles';
const sections = { sections: [{ section: 'engine', offered: true }, { section: 'analytics', offered: false }], excluded: ['analytics'] };

describe('privacy settings load: the self-service export', () => {
	it('reads the sections and the roles while the plugin runs', async () => {
		route({ [SECTIONS_URL]: sections, [ROLES_URL]: { roles: ['editor'] } });
		const result = (await load(loadEvent(named(['analytics'])))) as Loaded;
		expect(result.exportSections).toEqual({ ok: true, value: sections });
		expect(result.exportRoles).toEqual({ ok: true, value: { roles: ['editor'] } });
		expect(result.formErasure).toEqual({ ok: false, stopped: { state: 'unexplained' } });
	});

	it('says both are stopped, without asking, while the plugin is stopped', async () => {
		route({ '/api/admin/schemas/form-erasure': { mode: 'auto' } });
		const result = (await load(loadEvent(named(['schema'])))) as Loaded;
		expect(engine.get).not.toHaveBeenCalledWith(SECTIONS_URL);
		expect(engine.get).not.toHaveBeenCalledWith(ROLES_URL);
		expect(result.exportSections).toEqual({ ok: false, stopped: { state: 'unexplained' } });
		expect(result.exportRoles).toEqual({ ok: false, stopped: { state: 'unexplained' } });
	});

	it('draws no card when an export read says the session names no tenant', async () => {
		route({ [SECTIONS_URL]: new ApiError(400, 'missing tenant context'), [ROLES_URL]: new ApiError(400, 'missing tenant context') });
		const result = (await load(loadEvent(named(['analytics'])))) as Loaded;
		expect(result).toEqual({ noTenant: true, formErasure: null, exportSections: null, exportRoles: null });
	});

	it('leaves out the roles on an engine without that route and keeps the sections', async () => {
		route({ [SECTIONS_URL]: sections });
		const result = (await load(loadEvent(named(['analytics'])))) as Loaded;
		expect(result.exportSections).toMatchObject({ ok: true });
		expect(result.exportRoles).toBeNull();
	});

	it('keeps one failed read from hiding the other', async () => {
		route({ [SECTIONS_URL]: new ApiError(503, 'down'), [ROLES_URL]: { roles: [] } });
		const result = (await load(loadEvent(named(['analytics'])))) as Loaded;
		expect(result.exportSections).toEqual({ ok: false, gate: { state: 'unavailable' } });
		expect(result.exportRoles).toEqual({ ok: true, value: { roles: [] } });
	});

	it('draws a refused license as one', async () => {
		route({ [SECTIONS_URL]: new ApiError(402, 'not licensed', {}), [ROLES_URL]: new ApiError(402, 'not licensed', {}) });
		const result = (await load(loadEvent(named(['analytics'])))) as Loaded;
		expect(result.exportSections).toMatchObject({ ok: false, gate: { state: 'locked' } });
	});
});

function formWith(entries: [string, string][]) {
	const body = new FormData();
	for (const [k, v] of entries) body.append(k, v);
	return {
		request: new Request('http://admin/admin/settings/privacy', { method: 'POST', body }),
		cookies: {},
		fetch: vi.fn(),
	} as never;
}

describe('privacy settings: export sections save', () => {
	it('leaves out what was shown and not ticked, and keeps a section that is not available now', async () => {
		engine.put.mockResolvedValue({});
		const result = await actions.sections(
			formWith([
				['available', 'engine'],
				['available', 'analytics'],
				['available', 'schema'],
				['offered', 'engine'],
				['kept', 'media'],
			]),
		);
		expect(engine.put).toHaveBeenCalledWith(SECTIONS_URL, { excluded: ['analytics', 'schema', 'media'] });
		expect(result).toEqual({ action: 'sections', saved: true });
	});

	it('sends an empty list when every section is ticked', async () => {
		engine.put.mockResolvedValue({});
		await actions.sections(formWith([['available', 'engine'], ['offered', 'engine']]));
		expect(engine.put).toHaveBeenCalledWith(SECTIONS_URL, { excluded: [] });
	});

	it("relays the engine's refusal of a section it does not know", async () => {
		engine.put.mockRejectedValue(new ApiError(400, 'an excluded section is not known', { error: 'an excluded section is not known', code: 'bad_request' }));
		const result = (await actions.sections(formWith([['available', 'engine']]))) as { data: { action: string; error: string } };
		expect(result.data).toMatchObject({ action: 'sections', error: 'an excluded section is not known' });
	});
});

describe('privacy settings: export save failures', () => {
	const refusal = new ApiError(402, 'payment required', { error: 'payment_required', feature: 'analytics', plugin: 'analytics' });
	const cases: [string, () => unknown][] = [
		['sections', () => actions.sections(formWith([['available', 'engine']]))],
		['roles', () => actions.roles(formWith([['scope', 'every']]))],
	];
	for (const [action, save] of cases) {
		it(`carries a license refusal on the ${action} save, with its status`, async () => {
			engine.put.mockRejectedValue(refusal);
			const result = (await save()) as { status: number; data: { action: string; refused?: { kind: string } } };
			expect(result.status).toBe(402);
			expect(result.data.action).toBe(action);
			expect(result.data.refused?.kind).toBe('feature');
		});

		it(`reports an outage on the ${action} save as one, without engine detail`, async () => {
			engine.put.mockRejectedValue(new ApiError(503, 'dial tcp 10.0.0.4:5432: connection refused'));
			const result = (await save()) as { status: number; data: { action: string; error: string } };
			expect(result.status).toBe(503);
			expect(result.data.action).toBe(action);
			expect(result.data.error).not.toContain('10.0.0.4');
		});
	}
});

describe('privacy settings: export roles save', () => {
	it('sends an empty list for every role', async () => {
		engine.put.mockResolvedValue({ roles: [] });
		const result = await actions.roles(formWith([['scope', 'every'], ['roles', 'editor']]));
		expect(engine.put).toHaveBeenCalledWith(ROLES_URL, { roles: [] });
		expect(result).toEqual({ action: 'roles', saved: true });
	});

	it('sends the ticked roles, trimmed and once each', async () => {
		engine.put.mockResolvedValue({ roles: ['editor', 'auditor'] });
		await actions.roles(formWith([['scope', 'chosen'], ['roles', 'editor'], ['roles', ' auditor '], ['roles', 'editor']]));
		expect(engine.put).toHaveBeenCalledWith(ROLES_URL, { roles: ['editor', 'auditor'] });
	});

	it('limits the export to admins when no role is ticked, since an empty list means every role', async () => {
		engine.put.mockResolvedValue({ roles: ['admin'] });
		await actions.roles(formWith([['scope', 'chosen']]));
		expect(engine.put).toHaveBeenCalledWith(ROLES_URL, { roles: ['admin'] });
	});

	it('refuses a role name past 64 characters without asking the engine', async () => {
		const result = (await actions.roles(formWith([['scope', 'chosen'], ['roles', 'r'.repeat(65)]]))) as { status: number };
		expect(engine.put).not.toHaveBeenCalled();
		expect(result.status).toBe(400);
	});

	it('refuses more than 64 roles without asking the engine', async () => {
		const many: [string, string][] = Array.from({ length: 65 }, (_, i) => ['roles', `role-${i}`]);
		const result = (await actions.roles(formWith([['scope', 'chosen'], ...many]))) as { status: number };
		expect(engine.put).not.toHaveBeenCalled();
		expect(result.status).toBe(400);
	});

	it('refuses a scope it does not know', async () => {
		const result = (await actions.roles(formWith([['scope', 'some']]))) as { status: number };
		expect(engine.put).not.toHaveBeenCalled();
		expect(result.status).toBe(400);
	});
});
