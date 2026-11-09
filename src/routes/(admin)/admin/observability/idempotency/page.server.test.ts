import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@lyeve-labs/client';

const engine = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
const authz = vi.hoisted(() => ({ roles: ['admin'] as string[] }));
vi.mock('$lib/server/authz', async (importOriginal) => ({
	...((await importOriginal()) as object),
	authedClient: vi.fn(() => engine),
	requireRole: vi.fn(async (_event: unknown, allowed: string[]) => {
		if (!allowed.some((r) => authz.roles.includes(r))) throw new Error('403');
		return { id: 'u1', roles: authz.roles };
	}),
}));

import { actions, load } from './+page.server';

function loadEvent(query = '') {
	return {
		url: new URL(`http://localhost/admin/observability/idempotency${query}`),
		parent: async () => ({ plugins: { state: 'named', running: ['idempotency'], withheld: [] } }),
	} as never;
}

function actionEvent(fields: Record<string, string>) {
	const data = new FormData();
	data.set('confirmed', 'yes');
	for (const [k, v] of Object.entries(fields)) data.set(k, v);
	return { request: { formData: async () => data, clone: () => ({ formData: async () => data }) } } as never;
}

beforeEach(() => {
	vi.clearAllMocks();
	authz.roles = ['admin'];
});

describe('releasing a key', () => {
	// The plugin admits any admin to the release. Asking for super admin
	// refused a reader the engine would have answered.
	it('lets an admin release a key, as the plugin does', async () => {
		engine.delete.mockResolvedValue(undefined);
		const out = await actions.release(actionEvent({ key: 'order-17' }));
		expect(out).toEqual({ released: 'order-17' });
		expect(engine.delete).toHaveBeenCalledWith('/api/admin/idempotency/order-17');
	});

	it('refuses a reader who is not an admin', async () => {
		authz.roles = ['editor'];
		await expect(actions.release(actionEvent({ key: 'order-17' }))).rejects.toThrow('403');
	});
});

describe('the key list', () => {
	it('sends an offset past the end back to the last page', async () => {
		engine.get.mockImplementation(async (url: string) =>
			url.includes('/stats') ? { total: 3, completed: 3, in_flight: 0 } : { data: [], total_count: 60 },
		);
		await expect(load(loadEvent('?limit=50&offset=500'))).rejects.toMatchObject({
			status: 307,
			location: expect.stringContaining('offset=50'),
		});
	});
});

describe('a release the engine does not carry out', () => {
	type Failure = { status: number; data: { error: string } };

	it('names nothing to release without a request', async () => {
		const out = (await actions.release(actionEvent({}))) as Failure;
		expect(out.data.error).toBe('This form is missing its key. Reload the page and try again.');
		expect(engine.delete).not.toHaveBeenCalled();
	});

	it('relays the engine refusal', async () => {
		engine.delete.mockRejectedValue(new ApiError(409, 'key is in flight', { error: 'key is in flight', code: 'conflict' }));
		const out = (await actions.release(actionEvent({ key: 'order-17' }))) as Failure;
		expect(out.data.error).toBe('key is in flight');
	});

	it('keeps outage detail off the page', async () => {
		engine.delete.mockRejectedValue(new ApiError(503, 'dial tcp 10.0.0.9:6379: connection refused'));
		const out = (await actions.release(actionEvent({ key: 'order-17' }))) as Failure;
		expect(out.data.error).toBe('Could not release the key. Try again.');
	});
});

describe('the counters', () => {
	// A role refusal and an outage read differently, so a failed read keeps
	// its gate.
	it('keeps the gate of a failed counters read', async () => {
		engine.get.mockImplementation(async (url: string) => {
			if (url.includes('/stats')) throw new ApiError(503, 'down', {});
			return { data: [], total_count: 0 };
		});
		const out = (await load(loadEvent())) as { statsRead: boolean; statsGate: unknown };
		expect(out.statsRead).toBe(false);
		expect(out.statsGate).toEqual({ state: 'unavailable' });
	});
});
