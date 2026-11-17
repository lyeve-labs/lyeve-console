import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@lyeve-labs/client';

const engine = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('#lib/server/authz.ts', async (importOriginal) => ({
	...((await importOriginal()) as object),
	authedClient: vi.fn(() => engine),
}));

import { load } from './+page.server';

const ADMIN = '5cec39db-bbeb-44a3-bdef-912a4f57a344';
const MIRA = '24d6560b-540e-47b6-8957-59934db4021d';

function loadEvent(roles = ['super_admin']) {
	return {
		url: new URL('http://localhost/admin/tenants/usage'),
		parent: async () => ({
			plugins: { state: 'named', running: ['usage'], withheld: [] },
			user: { id: ADMIN, email: 'admin@example.com', roles },
		}),
	} as never;
}

function route(map: Record<string, unknown>) {
	engine.get.mockImplementation(async (url: string) => {
		const path = String(url).split('?')[0];
		if (path in map) {
			const body = map[path];
			if (body instanceof Error) throw body;
			return body;
		}
		throw new ApiError(404, 'not found', {});
	});
}

const request = (requested_by: string) => ({
	id: 'q1',
	tenant_id: 'default',
	requested_by,
	requests_limit: 100000,
	reason: 'Launch traffic in November',
	status: 'pending',
	reviewed_by: '',
	created_at: '2026-10-11T18:36:49Z',
});

beforeEach(() => vi.clearAllMocks());

describe('the usage load', () => {
	// A request carries the requester's account id, so the load reads the
	// account directory to name them.
	it('reads the emails the requests are named by', async () => {
		route({
			'/api/admin/quotas': { data: [], total_count: 0 },
			'/api/admin/quota-requests': { data: [request(MIRA)], total_count: 1 },
			'/api/admin/usage/tenants': [],
			'/api/admin/users': [{ id: MIRA, email: 'mira.costa@example.com', roles: ['editor'] }],
		});

		const out = (await load(loadEvent())) as Record<string, unknown>;

		expect(out.people).toEqual({ [MIRA]: 'mira.costa@example.com', [ADMIN]: 'admin@example.com' });
	});

	it('keeps the page when the directory cannot be read', async () => {
		route({
			'/api/admin/quotas': { data: [], total_count: 0 },
			'/api/admin/quota-requests': { data: [request(MIRA)], total_count: 1 },
			'/api/admin/usage/tenants': [],
			'/api/admin/users': new ApiError(503, 'down', {}),
		});

		const out = (await load(loadEvent())) as Record<string, unknown>;

		expect(out.people).toEqual({ [ADMIN]: 'admin@example.com' });
		expect(out.requests).toMatchObject({ ok: true });
	});
});

describe('the usage load past the end', () => {
	it('sends a super admin search to the engine and back to the page', async () => {
		route({
			'/api/admin/quotas': { data: [], total_count: 0 },
			'/api/admin/quota-requests': { data: [], total_count: 0 },
			'/api/admin/usage/tenants': [],
			'/api/admin/users': [],
		});
		const event = loadEvent() as unknown as { url: URL };
		event.url = new URL('http://localhost/admin/tenants/usage?q=acme');
		const out = (await load(event as never)) as { q: string };
		const asked = engine.get.mock.calls.map(([u]) => String(u)).find((u) => u.startsWith('/api/admin/quotas'))!;
		expect(new URL(asked, 'http://e').searchParams.get('q')).toBe('acme');
		expect(out.q).toBe('acme');
	});

	it('sends no search an admin types, or one the engine would refuse', async () => {
		route({
			'/api/admin/quotas': { data: [], total_count: 0 },
			'/api/admin/quota-requests': { data: [], total_count: 0 },
			'/api/admin/usage/tenants': [],
			'/api/admin/users': [],
		});
		for (const [roles, q] of [[['admin'], 'acme'], [['super_admin'], 'a'.repeat(201)]] as const) {
			engine.get.mockClear();
			const event = loadEvent([...roles]) as unknown as { url: URL };
			event.url = new URL(`http://localhost/admin/tenants/usage?q=${q}`);
			const out = (await load(event as never)) as { q: string };
			const asked = engine.get.mock.calls.map(([u]) => String(u)).find((u) => u.startsWith('/api/admin/quotas'))!;
			expect(asked).not.toContain('q=');
			expect(out.q).toBe('');
		}
	});

	it('sends a page of quotas past the end back to the last page that holds rows', async () => {
		route({
			'/api/admin/quotas': { data: [], total_count: 60 },
			'/api/admin/quota-requests': { data: [], total_count: 0 },
			'/api/admin/usage/tenants': [],
			'/api/admin/users': [],
		});
		const event = loadEvent() as unknown as { url: URL };
		event.url = new URL('http://localhost/admin/tenants/usage?limit=50&offset=200');
		await expect(load(event as never)).rejects.toMatchObject({ status: 307, location: '/admin/tenants/usage?limit=50&offset=50' });
	});

	it('says the usage was not read rather than that nothing was used', async () => {
		route({
			'/api/admin/quotas': { data: [], total_count: 0 },
			'/api/admin/quota-requests': { data: [], total_count: 0 },
			'/api/admin/usage/tenants': new ApiError(503, 'down', {}),
			'/api/admin/users': [],
		});
		const out = (await load(loadEvent())) as Record<string, unknown>;
		expect(out.usage).toEqual({ ok: false, gate: { state: 'unavailable' } });
	});
});

describe('the usage load for each role', () => {
	const usage = { tenant_id: 'acme', billing_period: '2026-10', api_calls: 10, storage_bytes: 0, bandwidth_bytes: 0, content_count: 0, media_count: 0 };

	// The plugin pages its requests newest first across every status, so a
	// read with no status could miss a pending one behind answered ones.
	it('asks for the pending requests only, and keeps the stated total', async () => {
		route({
			'/api/admin/quotas': { data: [], total_count: 0 },
			'/api/admin/quota-requests': { data: [request(MIRA)], total_count: 600 },
			'/api/admin/usage/tenants': [usage],
			'/api/admin/users': [],
		});
		const out = (await load(loadEvent())) as Record<string, unknown>;
		const asked = engine.get.mock.calls.map(([u]) => String(u)).find((u) => u.startsWith('/api/admin/quota-requests'));
		expect(new URL(asked!, 'http://x').searchParams.get('status')).toBe('pending');
		expect(out.requestTotal).toBe(600);
		expect(out.usage).toEqual({ ok: true, value: [usage] });
	});

	// The session names no tenant, so the admin's own quota row is what says
	// which tenant's usage to ask for.
	it("reads an admin's own tenant's quota, requests and usage", async () => {
		route({
			'/api/admin/quotas': { data: [{ id: 'k1', tenant_id: 'acme', requests_limit: 1000 }], total_count: 1 },
			'/api/admin/quota-requests': { data: [], total_count: 0 },
			'/api/admin/usage/tenant/acme': usage,
			'/api/admin/users': [],
		});
		const out = (await load(loadEvent(['admin']))) as Record<string, unknown>;
		expect(out.permitted).toBe(true);
		expect(out.gate).toEqual({ state: 'ok' });
		expect(out.usage).toEqual({ ok: true, value: [usage] });
		const asked = engine.get.mock.calls.map(([u]) => String(u));
		expect(asked.some((u) => u.startsWith('/api/admin/usage/tenants'))).toBe(false);
	});

	it('asks no usage for an admin whose tenant has no quota', async () => {
		route({
			'/api/admin/quotas': { data: [], total_count: 0 },
			'/api/admin/quota-requests': { data: [], total_count: 0 },
			'/api/admin/users': [],
		});
		const out = (await load(loadEvent(['admin']))) as Record<string, unknown>;
		expect(out.usage).toEqual({ ok: true, value: [] });
		const asked = engine.get.mock.calls.map(([u]) => String(u));
		expect(asked.some((u) => u.startsWith('/api/admin/usage/'))).toBe(false);
	});

	it('reads nothing for an editor', async () => {
		const out = (await load(loadEvent(['editor']))) as Record<string, unknown>;
		expect(out.permitted).toBe(false);
		expect(engine.get).not.toHaveBeenCalled();
	});
});
