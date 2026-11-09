import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiError } from '@lyeve-labs/client';

const engine = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), post: vi.fn(), delete: vi.fn() }));
const authz = vi.hoisted(() => ({
	authedClient: vi.fn(() => engine),
	requireRole: vi.fn(async () => ({ id: 'u1', roles: ['admin'] })),
}));
vi.mock('$lib/server/authz', () => authz);

const rest = vi.hoisted(() => ({ getSchemas: vi.fn() }));
vi.mock('@lyeve-labs/client-rest', () => rest);

import { load, actions } from './+page.server';

type Loaded = Exclude<Awaited<ReturnType<typeof load>>, void>;
type Failed = { status: number; data: { action?: string; error: string; fields?: Record<string, string> } };

const SETTINGS = {
	settings: {
		history_mode: 'selected',
		schemas: ['article'],
		keep_days: 90,
		keep_versions: 20,
		activity_enabled: true,
		activity_keep_days: 365,
		updated_at: '2026-10-21T10:00:00Z',
	},
	locked: [],
	env: { history: 'console', activity: 'console' },
	defaults: { keep_days: 0, keep_versions: 0, activity_keep_days: 0 },
};

const USAGE = {
	commits: 120,
	objects: 300,
	stored_bytes: 4096,
	logical_bytes: 65536,
	legacy_rows: 40,
	legacy_bytes: 81920,
	oldest_at: '2026-01-02T00:00:00Z',
};

function loadEvent(features: string[] = []) {
	return {
		url: new URL('http://admin/admin/settings/content-history'),
		fetch: vi.fn(),
		cookies: {},
		parent: async () => ({ entitlements: { plan: 'free', state: 'free', features, tenant_quota: 0 } }),
	} as never;
}

function formEvent(fields: Record<string, string | readonly string[]>) {
	const body = new FormData();
	body.set('confirmed', 'yes');
	for (const [k, v] of Object.entries(fields)) {
		for (const one of typeof v === 'string' ? [v] : v) body.append(k, one);
	}
	return {
		request: new Request('http://admin/admin/settings/content-history', { method: 'POST', body }),
		cookies: {},
		fetch: vi.fn(),
	} as never;
}

function routeReads(settings: unknown, usage: unknown = USAGE) {
	engine.get.mockImplementation(async (path: string) => {
		if (path === '/api/admin/content/history/settings') {
			if (settings instanceof Error) throw settings;
			return settings;
		}
		if (path === '/api/admin/content/history/usage') {
			if (usage instanceof Error) throw usage;
			return usage;
		}
		throw new Error(`unexpected read ${path}`);
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	rest.getSchemas.mockResolvedValue([
		{ name: 'article', display_name: 'Articles' },
		{ name: 'page', display_name: '' },
	]);
});

describe('content history load', () => {
	it.each(['off', 'all', 'selected'] as const)('carries the %s mode as the plugin stored it', async (mode) => {
		routeReads({ ...SETTINGS, settings: { ...SETTINGS.settings, history_mode: mode } });
		const out = (await load(loadEvent())) as Loaded;
		expect(out.settings).toMatchObject({ ok: true, value: { settings: { history_mode: mode } } });
	});

	it('carries the retention, the usage and the type list', async () => {
		routeReads(SETTINGS);
		const out = (await load(loadEvent())) as Loaded;
		expect(out.settings).toMatchObject({
			ok: true,
			value: { settings: { keep_days: 90, keep_versions: 20, activity_enabled: true, activity_keep_days: 365 } },
		});
		expect(out.usage).toEqual({ ok: true, value: USAGE });
		expect(out.schemas).toEqual({
			ok: true,
			value: [
				{ name: 'article', label: 'Articles' },
				{ name: 'page', label: 'page' },
			],
		});
	});

	it('carries the fields the environment fixes and what it set them to', async () => {
		routeReads({ ...SETTINGS, locked: ['history_mode', 'schemas', 'not_a_field'], env: { history: 'on', activity: 'console' } });
		const out = (await load(loadEvent())) as Loaded;
		expect(out.settings).toMatchObject({
			ok: true,
			value: { locked: ['history_mode', 'schemas'], env: { history: 'on', activity: 'console' } },
		});
	});

	it('says whether the license reads versions past the read window', async () => {
		routeReads(SETTINGS);
		expect(((await load(loadEvent())) as Loaded).readsOlder).toBe(false);
		expect(((await load(loadEvent(['content-pro']))) as Loaded).readsOlder).toBe(true);
	});

	it('reads an engine without the routes as one older than the feature', async () => {
		routeReads(new ApiError(404, 'not found'), new ApiError(404, 'not found'));
		const out = (await load(loadEvent())) as Loaded;
		expect(out.settings).toEqual({ ok: false, gate: { state: 'absent' } });
		expect(out.usage).toEqual({ ok: false, gate: { state: 'absent' } });
	});

	it('reports a 5xx as the engine not answering, never as history off', async () => {
		routeReads(new ApiError(503, 'database unavailable'));
		const out = (await load(loadEvent())) as Loaded;
		expect(out.settings).toEqual({ ok: false, gate: { state: 'unavailable' } });
	});

	it('reports a role the plugin refuses as forbidden', async () => {
		routeReads(new ApiError(403, 'forbidden'), new ApiError(403, 'forbidden'));
		const out = (await load(loadEvent())) as Loaded;
		expect(out.settings).toEqual({ ok: false, gate: { state: 'forbidden' } });
	});

	it('keeps a failed type list apart from the settings', async () => {
		routeReads(SETTINGS);
		rest.getSchemas.mockRejectedValue(new Error('boom'));
		const out = (await load(loadEvent())) as Loaded;
		expect(out.settings.ok).toBe(true);
		expect(out.schemas).toMatchObject({ ok: false, gate: { state: 'error' } });
	});
});

describe('content history save', () => {
	beforeEach(() => {
		// Braced: a function returned here would run as the test's teardown.
		engine.put.mockResolvedValue(SETTINGS);
	});

	it.each([
		['off', {}],
		['all', {}],
		['selected', { schemas: ['article', 'page'] }],
	] as const)('saves the %s mode', async (mode, extra) => {
		const out = await actions.save(formEvent({ history_mode: mode, schemas_sent: '1', ...extra }));
		expect(out).toEqual({ action: 'save', saved: true });
		expect(engine.put).toHaveBeenCalledWith('/api/admin/content/history/settings', {
			history_mode: mode,
			schemas: 'schemas' in extra ? extra.schemas : [],
		});
	});

	it('refuses Selected types with no type chosen, without a request', async () => {
		const out = (await actions.save(formEvent({ history_mode: 'selected', schemas_sent: '1' }))) as Failed;
		expect(out.status).toBe(400);
		expect(out.data.fields?.schemas).toMatch(/at least one content type/);
		expect(engine.put).not.toHaveBeenCalled();
	});

	it('sends the retention values as whole numbers, with 0 for no limit', async () => {
		await actions.save(
			formEvent({ keep_days: '0', keep_versions: '25', activity: 'off', activity_keep_days: '180' }),
		);
		expect(engine.put).toHaveBeenCalledWith('/api/admin/content/history/settings', {
			keep_days: 0,
			keep_versions: 25,
			activity_enabled: false,
			activity_keep_days: 180,
		});
	});

	it('refuses a retention value that is not a whole number in range', async () => {
		const out = (await actions.save(formEvent({ keep_days: '-3', keep_versions: '1.5', activity_keep_days: '99999999' }))) as Failed;
		expect(out.status).toBe(400);
		expect(Object.keys(out.data.fields ?? {}).sort()).toEqual(['activity_keep_days', 'keep_days', 'keep_versions']);
		expect(engine.put).not.toHaveBeenCalled();
	});

	it('leaves out every field the form did not post, which is how a locked field stays out of the write', async () => {
		await actions.save(formEvent({ keep_days: '30' }));
		expect(engine.put).toHaveBeenCalledWith('/api/admin/content/history/settings', { keep_days: 30 });
	});

	it('says in its own words that the environment now fixes a field, on a 409', async () => {
		engine.put.mockRejectedValue(new ApiError(409, 'history_mode is set by CONTENT_HISTORY'));
		const out = (await actions.save(formEvent({ history_mode: 'all' }))) as Failed;
		expect(out.status).toBe(409);
		expect(out.data.error).toMatch(/environment variable now sets one of the settings/);
		expect(out.data.error).not.toContain('CONTENT_HISTORY');
	});

	it('keeps engine text off the page on a 5xx', async () => {
		engine.put.mockRejectedValue(new ApiError(500, 'pq: deadlock detected'));
		const out = (await actions.save(formEvent({ history_mode: 'all' }))) as Failed;
		expect(out.data.error).toBe('Could not save content history settings. Try again.');
	});

	it('writes nothing when the form changed nothing', async () => {
		const out = await actions.save(formEvent({}));
		expect(out).toEqual({ action: 'save', saved: true });
		expect(engine.put).not.toHaveBeenCalled();
	});

	it('takes an admin role before it writes', async () => {
		await actions.save(formEvent({ history_mode: 'all' }));
		expect(authz.requireRole).toHaveBeenCalledWith(expect.anything(), ['admin', 'super_admin']);
	});
});

describe('prune and delete', () => {
	it('runs retention and carries the counts', async () => {
		engine.post.mockResolvedValue({ commits: 12, legacy_rows: 3, activity_rows: 40, done: true });
		const out = await actions.prune(formEvent({}));
		expect(engine.post).toHaveBeenCalledWith('/api/admin/content/history/prune', {});
		expect(out).toEqual({ action: 'prune', pruned: { commits: 12, legacy_rows: 3, activity_rows: 40, done: true } });
	});

	it('carries a run that continues in the background as not done', async () => {
		engine.post.mockResolvedValue({ commits: 500, legacy_rows: 0, activity_rows: 0, done: false });
		const out = (await actions.prune(formEvent({}))) as { pruned: { done: boolean } };
		expect(out.pruned.done).toBe(false);
	});

	it('reports a prune that failed without engine text', async () => {
		engine.post.mockRejectedValue(new ApiError(502, '<html>Bad Gateway</html>'));
		const out = (await actions.prune(formEvent({}))) as Failed;
		expect(out.data).toEqual({ action: 'prune', error: 'Could not run retention. Nothing was removed. Try again.' });
	});

	it("deletes one type's history by name", async () => {
		engine.delete.mockResolvedValue({ commits: 10, held: 3 });
		const out = await actions.deleteType(formEvent({ schema: 'blog post' }));
		expect(engine.delete).toHaveBeenCalledWith('/api/admin/content/history?schema=blog%20post');
		expect(out).toEqual({ action: 'deleteType', deleted: 'blog post', commits: 10, held: 3 });
	});

	it('refuses a delete that names no type, without a request', async () => {
		const out = (await actions.deleteType(formEvent({ schema: ' ' }))) as Failed;
		expect(out.status).toBe(400);
		expect(engine.delete).not.toHaveBeenCalled();
	});

	it('relays the reason a delete was refused', async () => {
		engine.delete.mockRejectedValue(new ApiError(422, 'unknown content type', { error: 'unknown content type', code: 'http_422' }));
		const out = (await actions.deleteType(formEvent({ schema: 'nope' }))) as Failed;
		expect(out.data.error).toBe('unknown content type');
	});
});
