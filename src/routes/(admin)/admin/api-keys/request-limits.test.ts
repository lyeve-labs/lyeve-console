import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@lyeve-labs/client';

const engine = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('#lib/server/authz.ts', async (importOriginal) => ({
	...((await importOriginal()) as object),
	authedClient: vi.fn(() => engine),
	requireUser: vi.fn(async () => ({ id: 'u1', roles: ['super_admin'] })),
	requireRole: vi.fn(async () => ({ id: 'u1', roles: ['super_admin'] })),
}));

import { actions } from './+page.server';

function event(fields: Record<string, string | string[]>, params: Record<string, string> = {}) {
	const data = new FormData();
	for (const [k, v] of Object.entries(fields)) for (const one of Array.isArray(v) ? v : [v]) data.append(k, one);
	return { params, request: { formData: async () => data } } as never;
}

type Failure = { status: number; data: Record<string, unknown> };

beforeEach(() => vi.clearAllMocks());

describe('a key request limits', () => {
	it('sends a new key each ceiling only when one was filled in', async () => {
		engine.post.mockResolvedValue({ raw_key: 'k', name: 'svc' });
		await actions.create(event({ name: 'svc', scopes: 'content:read', monthly_limit: '0' }));
		const first = engine.post.mock.calls[0][1];
		expect(first).not.toHaveProperty('monthly_limit');
		expect(first).not.toHaveProperty('daily_limit');
		expect(first).not.toHaveProperty('hourly_limit');
		await actions.create(event({ name: 'svc', scopes: 'content:read', hourly_limit: '60', daily_limit: '600', monthly_limit: '5000' }));
		expect(engine.post.mock.calls[1][1]).toMatchObject({ hourly_limit: 60, daily_limit: 600, monthly_limit: 5000 });
	});

	it('refuses an hourly ceiling above the daily one before it calls the engine', async () => {
		const out = (await actions.create(event({ name: 'svc', scopes: 'content:read', hourly_limit: '700', daily_limit: '600' }))) as Failure;
		expect(out.status).toBe(400);
		expect(out.data.fields).toMatchObject({ hourly_limit: expect.stringContaining('daily') });
		expect(engine.post).not.toHaveBeenCalled();
	});

	it('sets every ceiling and renders the capability refusal the engine sent', async () => {
		engine.patch.mockRejectedValue(
			new ApiError(402, 'payment_required', { error: 'payment_required', plugin: 'example', feature: 'feature:example_capability' }),
		);
		const out = (await actions.limit(event({ id: 'k1', hourly_limit: '10', monthly_limit: '100' }))) as Failure;
		expect(engine.patch).toHaveBeenCalledWith('/api/admin/api-keys/k1/limits', { hourly_limit: 10, daily_limit: 0, monthly_limit: 100 });
		expect(out.status).toBe(402);
		expect(out.data.refused).toMatchObject({ feature: 'example-capability' });
	});

	it('refuses a ceiling that is not a whole number before it calls the engine', async () => {
		const out = (await actions.limit(event({ id: 'k1', monthly_limit: '1.5' }))) as Failure;
		expect(out.status).toBe(400);
		expect(engine.patch).not.toHaveBeenCalled();
	});
});
