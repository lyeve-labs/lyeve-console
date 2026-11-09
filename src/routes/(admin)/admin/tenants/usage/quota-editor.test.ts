import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@lyeve-labs/client';

const engine = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('$lib/server/authz', async (importOriginal) => ({
	...((await importOriginal()) as object),
	authedClient: vi.fn(() => engine),
	requireUser: vi.fn(async () => ({ id: 'u1', roles: ['super_admin'] })),
	requireRole: vi.fn(async () => ({ id: 'u1', roles: ['super_admin'] })),
}));

import { actions } from './+page.server';

function event(fields: Record<string, string | string[]>, params: Record<string, string> = {}) {
	const data = new FormData();
	data.set('confirmed', 'yes');
	for (const [k, v] of Object.entries(fields)) for (const one of Array.isArray(v) ? v : [v]) data.append(k, one);
	const url = new URL('http://admin/admin/tenants/usage');
	return { params, url, request: new Request(url, { method: 'POST', body: data }) } as never;
}

type Failure = { status: number; data: Record<string, unknown> };

beforeEach(() => vi.clearAllMocks());

describe('the quota editor', () => {
	it('writes the whole setting in the units the engine stores', async () => {
		engine.put.mockResolvedValue({});
		await actions.quota(
			event({ tenant_id: 'acme', requests_limit: '1000', storage_gib: '2', bandwidth_gib: '0', is_hard_limit: 'true', block_on_exceeded: 'true' }),
		);
		expect(engine.put).toHaveBeenCalledWith('/api/admin/quotas/acme', {
			requests_limit: 1000,
			storage_bytes_limit: 2 * 1024 ** 3,
			bandwidth_bytes_limit: 0,
			is_hard_limit: true,
			grace_period_hours: 0,
			warn_at_pct_80: false,
			warn_at_pct_90: false,
			block_on_exceeded: true,
		});
	});

	it('renders the capability refusal the engine sent', async () => {
		engine.put.mockRejectedValue(
			new ApiError(402, 'payment_required', { error: 'payment_required', plugin: 'example', feature: 'feature:example_capability' }),
		);
		const out = (await actions.quota(event({ tenant_id: 'acme', requests_limit: '10' }))) as Failure;
		expect(out.data.refused).toMatchObject({ feature: 'example-capability' });
	});

	it('renders a refused approval the same way', async () => {
		engine.post.mockRejectedValue(
			new ApiError(402, 'payment_required', { error: 'payment_required', plugin: 'example', feature: 'feature:example_capability' }),
		);
		const out = (await actions.review(event({ id: 'q1', decision: 'approve' }))) as Failure;
		expect(out.status).toBe(402);
		expect(out.data.refused).toMatchObject({ feature: 'example-capability' });
	});

	// The plugin decodes the review strictly, so a key it does not read fails
	// every approval and denial with 400.
	it.each([
		['approve', 'approved'],
		['deny', 'denied'],
	])('sends only the status to %s a request', async (decision, status) => {
		engine.post.mockResolvedValue({});
		expect(await actions.review(event({ id: 'q1', decision, note: 'ignored' }))).toEqual({ reviewed: 'q1' });
		expect(engine.post).toHaveBeenCalledWith('/api/admin/quota-requests/q1/review', { status });
	});

	it('sends a byte limit posted in bytes as it is, without rounding through GiB', async () => {
		engine.put.mockResolvedValue({});
		await actions.quota(
			event({ tenant_id: 'acme', storage_bytes_limit: '1234567', storage_gib: '0', bandwidth_bytes_limit: '5000000' }),
		);
		expect(engine.put).toHaveBeenCalledWith(
			'/api/admin/quotas/acme',
			expect.objectContaining({ storage_bytes_limit: 1234567, bandwidth_bytes_limit: 5000000 }),
		);
	});

	it('removes a quota', async () => {
		engine.delete.mockResolvedValue(undefined);
		expect(await actions.clearQuota(event({ tenant_id: 'acme' }))).toEqual({ quotaCleared: 'acme' });
		expect(engine.delete).toHaveBeenCalledWith('/api/admin/quotas/acme');
	});
});
