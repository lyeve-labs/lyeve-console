import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiError } from '@lyeve-labs/client';

const engine = vi.hoisted(() => ({ get: vi.fn() }));
const authz = vi.hoisted(() => ({
	authedClient: vi.fn(() => engine),
	loadUser: vi.fn(async () => ({ id: 'u1', roles: ['admin'] })),
}));
vi.mock('#lib/server/authz.ts', () => authz);

const rest = vi.hoisted(() => ({ getSchemas: vi.fn(), listTenants: vi.fn() }));
vi.mock('@lyeve-labs/client-rest', () => rest);

import { load } from './+page.server';

type Loaded = Exclude<Awaited<ReturnType<typeof load>>, void>;

const ROW = {
	id: 'a1',
	tenant_id: 'acme',
	schema_name: 'article',
	entry_id: '11111111-1111-1111-1111-111111111111',
	action: 'updated',
	source: 'console',
	fields: ['title'],
	actor_id: '22222222-2222-2222-2222-222222222222',
	created_at: '2026-10-21T10:00:00Z',
};

const RUNNING = { state: 'named', running: ['content', 'multitenant'], withheld: [] };

function loadEvent(query = '', plugins: unknown = RUNNING) {
	return {
		url: new URL(`http://admin/admin/content-activity${query}`),
		fetch: vi.fn(),
		cookies: {},
		parent: async () => ({ plugins }),
	} as never;
}

/** The path and query of the one activity read the load made. */
function activityRead(): URL {
	const call = engine.get.mock.calls.find(([path]) => String(path).startsWith('/api/admin/content/activity'));
	if (!call) throw new Error('no activity read');
	return new URL(String(call[0]), 'http://engine');
}

const asSuperAdmin = () => authz.loadUser.mockResolvedValue({ id: 'u1', roles: ['super_admin'] });

beforeEach(() => {
	vi.clearAllMocks();
	authz.loadUser.mockResolvedValue({ id: 'u1', roles: ['admin'] });
	engine.get.mockResolvedValue({ data: [ROW], total_count: 1 });
	rest.getSchemas.mockResolvedValue([{ name: 'article', display_name: 'Articles' }]);
	rest.listTenants.mockResolvedValue({ items: [{ id: '7c9e6679-7425-40de-944b-e07fc1f90ae7', slug: 'acme', name: 'Acme' }] });
});

describe('content activity load', () => {
	it("reads the tenant's own activity, first page, for an admin", async () => {
		const out = (await load(loadEvent())) as Loaded;
		const read = activityRead();
		expect(read.pathname).toBe('/api/admin/content/activity');
		expect(read.searchParams.get('limit')).toBe('50');
		expect(read.searchParams.get('offset')).toBe('0');
		expect(out.activity).toEqual({ ok: true, value: [ROW] });
		expect(out.total).toBe(1);
		expect(out.superAdmin).toBe(false);
	});

	it('passes every filter, with the chosen days as whole days', async () => {
		await load(
			loadEvent(
				'?schema=article&entry_id=e1&actor=u2&action=published&source=api&from=2026-10-01&to=2026-10-20&offset=50',
			),
		);
		const q = activityRead().searchParams;
		expect(Object.fromEntries(q)).toEqual({
			schema: 'article',
			entry_id: 'e1',
			actor: 'u2',
			action: 'published',
			source: 'api',
			from: '2026-10-01T00:00:00Z',
			to: '2026-10-21T00:00:00Z',
			limit: '50',
			offset: '50',
		});
	});

	it('swaps reversed dates and drops a date that is not a day', async () => {
		const out = (await load(loadEvent('?from=2026-10-20&to=2026-10-01'))) as Loaded;
		expect(out.filter).toMatchObject({ from: '2026-10-01', to: '2026-10-20' });
		const bad = (await load(loadEvent('?from=yesterday'))) as Loaded;
		expect(bad.filter.from).toBe('');
	});

	it('ignores a tenant in the address for a reader who is not a super admin', async () => {
		const out = (await load(loadEvent('?tenant_id=t2'))) as Loaded;
		expect(activityRead().pathname).toBe('/api/admin/content/activity');
		expect(activityRead().searchParams.has('tenant_id')).toBe(false);
		expect(out.tenant).toBeNull();
		expect(rest.listTenants).not.toHaveBeenCalled();
	});

	it('reads every tenant for a super admin, and offers the tenants', async () => {
		asSuperAdmin();
		const out = (await load(loadEvent())) as Loaded;
		expect(activityRead().pathname).toBe('/api/admin/content/activity/all');
		expect(activityRead().searchParams.has('tenant_id')).toBe(false);
		expect(out.superAdmin).toBe(true);
		expect(out.tenant).toBe('');
		// Rows carry the slug, so the choice is keyed by it and never by the id.
		expect(out.tenants).toEqual({ ok: true, value: [{ slug: 'acme', label: 'Acme' }] });
	});

	it("narrows a super admin's read to the tenant chosen", async () => {
		asSuperAdmin();
		const out = (await load(loadEvent('?tenant_id=acme&action=deleted'))) as Loaded;
		const read = activityRead();
		expect(read.pathname).toBe('/api/admin/content/activity/all');
		expect(read.searchParams.get('tenant_id')).toBe('acme');
		expect(read.searchParams.get('action')).toBe('deleted');
		expect(out.tenant).toBe('acme');
	});

	it('asks for no tenant list where the multitenant plugin does not run', async () => {
		asSuperAdmin();
		const out = (await load(loadEvent('', { state: 'named', running: ['content'], withheld: [] }))) as Loaded;
		expect(rest.listTenants).not.toHaveBeenCalled();
		expect(out.tenants).toEqual({ ok: true, value: [] });
	});

	it('reads an engine without the route as one older than the feature', async () => {
		engine.get.mockRejectedValue(new ApiError(404, 'not found'));
		const out = (await load(loadEvent())) as Loaded;
		expect(out.activity).toEqual({ ok: false, gate: { state: 'absent' } });
		expect(out.total).toBeNull();
	});

	it('reports a 5xx as the engine not answering, never as no activity', async () => {
		engine.get.mockRejectedValue(new ApiError(503, 'database unavailable'));
		const out = (await load(loadEvent())) as Loaded;
		expect(out.activity).toEqual({ ok: false, gate: { state: 'unavailable' } });
	});

	it('reports a role the plugin refuses as forbidden', async () => {
		engine.get.mockRejectedValue(new ApiError(403, 'forbidden'));
		const out = (await load(loadEvent())) as Loaded;
		expect(out.activity).toEqual({ ok: false, gate: { state: 'forbidden' } });
	});

	it('sends a page past the end back to the last one', async () => {
		engine.get.mockResolvedValue({ data: [], total_count: 60 });
		await expect(load(loadEvent('?offset=500'))).rejects.toMatchObject({
			status: 307,
			location: '/admin/content-activity?offset=50',
		});
	});
});
