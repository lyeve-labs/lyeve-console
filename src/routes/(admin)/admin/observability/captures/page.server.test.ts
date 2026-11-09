import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiError } from '@lyeve-labs/client';

const api = vi.hoisted(() => ({
	listCaptures: vi.fn(),
	listCaptureRules: vi.fn(),
	listReplaySets: vi.fn(),
	createCaptureRule: vi.fn(),
	updateCaptureRule: vi.fn(),
	deleteCaptureRule: vi.fn(),
	createReplaySet: vi.fn(),
	deleteReplaySet: vi.fn(),
	replaySet: vi.fn(),
}));

vi.mock('$lib/api/request-capture', async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	...api,
}));

const authz = vi.hoisted(() => ({ roles: ['admin'] as string[] }));

vi.mock('$lib/server/authz', () => ({
	authedClient: vi.fn(() => ({})),
	requireRole: vi.fn(async (_event: unknown, allowed: string[]) => {
		if (!allowed.some((r) => authz.roles.includes(r))) throw new Error('403');
		return { id: 'u1', roles: authz.roles };
	}),
}));

import { load, actions } from './+page.server';

type Loaded = Exclude<Awaited<ReturnType<typeof load>>, void>;

// The session cookie as the engine signs it. The engine's me answer carries no
// tenant, so the page takes it from the token.
function sessionCookies(tenant: string) {
	const part = (v: object) => Buffer.from(JSON.stringify(v)).toString('base64url');
	const token = `${part({ alg: 'HS256' })}.${part({ sub: 'u', roles: ['super_admin'], ...(tenant ? { tenant_id: tenant } : {}) })}.s`;
	return { get: (name: string) => (name === 'sys_session' ? token : undefined) };
}

function loadEvent(plugins?: unknown, roles = ['admin'], tenant = '') {
	return {
		url: new URL('http://admin/admin/observability/captures'),
		fetch: vi.fn(),
		cookies: sessionCookies(tenant),
		parent: async () => ({ user: { roles }, plugins }),
	} as never;
}

function formEvent(fields: Record<string, string | string[]>) {
	const body = new FormData();
	for (const [k, v] of Object.entries(fields)) {
		for (const one of Array.isArray(v) ? v : [v]) body.append(k, one);
	}
	return {
		request: new Request('http://admin/admin/observability/captures', { method: 'POST', body }),
		cookies: {},
		fetch: vi.fn(),
	} as never;
}

const capture = {
	id: 'c1',
	captured_at: '2026-10-06T10:00:00Z',
	method: 'GET',
	url: 'http://localhost:3002/api/v1/content/posts',
	status_code: 200,
	duration_ms: 12.5,
	ttl_seconds: 86400,
};

beforeEach(() => {
	vi.clearAllMocks();
	authz.roles = ['admin'];
	api.listCaptures.mockResolvedValue({ data: [capture], total_count: 1, licensed: false });
});

describe('captures load', () => {
	it('reads the captures, and takes licensed from the plugin', async () => {
		const result = (await load(loadEvent())) as Loaded;
		expect(result.gate).toEqual({ state: 'ok' });
		expect(result.captures).toEqual([capture]);
		expect(result.licensed).toBe(false);
	});

	it('reports a refused captures read through the gate', async () => {
		api.listCaptures.mockRejectedValue(new ApiError(404, 'not found'));
		const result = (await load(loadEvent())) as Loaded;
		expect(result.gate).toEqual({ state: 'absent' });
		expect(result.captures).toEqual([]);
	});

	// The plugin applies no tenant filter to a super admin's read, so the page
	// has to know whose requests it lists.
	it('says whether the list is every tenant\'s', async () => {
		expect(((await load(loadEvent())) as Loaded).superAdmin).toBe(false);
		expect(((await load(loadEvent(undefined, ['super_admin']))) as Loaded).superAdmin).toBe(true);
	});

	// A replay set takes only the session tenant's captures.
	it("hands the page the session's own tenant", async () => {
		expect(((await load(loadEvent(undefined, ['super_admin'], 'acme'))) as Loaded).ownTenant).toBe('acme');
		expect(((await load(loadEvent(undefined, ['super_admin']))) as Loaded).ownTenant).toBeNull();
	});
});

describe('the captures pager', () => {
	it('sends an offset past the end back to the last page', async () => {
		api.listCaptures.mockResolvedValue({ data: [], total_count: 60, licensed: true });
		const event = loadEvent() as unknown as { url: URL };
		event.url = new URL('http://admin/admin/observability/captures?limit=50&offset=500');
		await expect(load(event as never)).rejects.toMatchObject({ status: 307, location: expect.stringContaining('offset=50') });
	});
});

describe('replay sets', () => {
	it('creates a set from the selected captures in order, without repeats', async () => {
		api.createReplaySet.mockResolvedValue({});
		await actions.createSet(formEvent({ name: 'checkout', capture_id: ['c2', 'c1', 'c2'] }));
		expect(api.createReplaySet).toHaveBeenCalledWith(expect.anything(), { name: 'checkout', capture_ids: ['c2', 'c1'] });
	});

	it('refuses a set past 50 captures', async () => {
		const ids = Array.from({ length: 51 }, (_, i) => `c${i}`);
		const out = (await actions.createSet(formEvent({ name: 'big', capture_id: ids }))) as { status: number };
		expect(out.status).toBe(400);
		expect(api.createReplaySet).not.toHaveBeenCalled();
	});
});

describe('which surface a failure belongs to', () => {
	it('tags a failed set save for the set drawer', async () => {
		const out = (await actions.createSet(formEvent({ name: '' }))) as { data: Record<string, unknown> };
		expect(out.data.drawer).toBe('set');
	});
});
