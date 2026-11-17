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

describe('image transforms and the focal point', () => {
	it('signs a transform URL from the fields that were filled in', async () => {
		engine.post.mockResolvedValue({ url: '/api/v1/media/m1/transform?w=800&sig=s', expires_at: null });
		const out = await actions.transformUrl(event({ id: 'm1', w: '800', h: '0', fmt: 'webp', fit: '', use_focal: 'false' }));
		expect(engine.post).toHaveBeenCalledWith('/api/admin/media/m1/transform-url', { w: 800, fmt: 'webp' });
		expect(out).toEqual({ transform: { id: 'm1', url: '/api/v1/media/m1/transform?w=800&sig=s', expires_at: null } });
	});

	it('renders the capability refusal the engine sent against the file asked for', async () => {
		engine.post.mockRejectedValue(
			new ApiError(402, 'payment_required', { error: 'payment_required', plugin: 'example', feature: 'feature:example_capability' }),
		);
		const out = (await actions.transformUrl(event({ id: 'm1', w: '100' }))) as Failure;
		expect(out.status).toBe(402);
		expect(out.data.transformId).toBe('m1');
		expect(out.data.transformRefused).toMatchObject({ feature: 'example-capability' });
	});

	it('saves a focal point and clears one back to the center', async () => {
		engine.patch.mockResolvedValue({ id: 'm1' });
		await actions.focal(event({ id: 'm1', x: '0.3', y: '0.4' }));
		expect(engine.patch).toHaveBeenLastCalledWith('/api/admin/media/m1', { focal_point: { x: 0.3, y: 0.4 } });
		await actions.focal(event({ id: 'm1', clear: 'true' }));
		expect(engine.patch).toHaveBeenLastCalledWith('/api/admin/media/m1', { focal_point: null });
	});
});

describe('a write that names no file', () => {
	it('answers a page-level failure, since no drawer belongs to it', async () => {
		for (const action of ['update', 'publish', 'focal', 'transformUrl', 'describe'] as const) {
			const out = (await actions[action](event({}))) as Failure;
			expect(out.status, action).toBe(400);
			expect(out.data, action).toEqual({ error: 'This form is missing its file. Reload the page and try again.' });
		}
		expect(engine.patch).not.toHaveBeenCalled();
		expect(engine.post).not.toHaveBeenCalled();
	});
});

