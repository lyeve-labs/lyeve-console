import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@lyeve-labs/client';
import { isRedirect } from '@sveltejs/kit';

const engine = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('#lib/server/authz.ts', () => ({
	authedClient: vi.fn(() => engine),
	requireUser: vi.fn(async () => ({ id: 'u1', roles: ['admin'] })),
}));

import { actions, load } from './+page.server';

const running = { state: 'named', running: ['content'], withheld: [] };

function event(form: Record<string, string> = {}, url = 'http://x/admin/releases', plugins: unknown = running) {
	const data = new FormData();
	for (const [k, v] of Object.entries(form)) data.set(k, v);
	return {
		url: new URL(url),
		parent: async () => ({ plugins }),
		request: { formData: async () => data },
	} as never;
}

beforeEach(() => vi.clearAllMocks());

describe('releases load', () => {
	it('reads the page the status filter names', async () => {
		engine.get.mockResolvedValue({ data: [{ id: 'r1', name: 'Launch' }], total_count: 1 });
		const out = (await load(event({}, 'http://x/admin/releases?status=scheduled'))) as Record<string, unknown>;
		expect(engine.get.mock.calls[0][0]).toContain('status=scheduled');
		expect(out.releases).toHaveLength(1);
		expect(out.gate).toEqual({ state: 'ok' });
	});

	it('reads nothing while the content plugin does not run', async () => {
		const out = (await load(event({}, undefined, { state: 'named', running: [], withheld: [] }))) as Record<string, unknown>;
		expect(engine.get).not.toHaveBeenCalled();
		expect(out.gate).toEqual({ state: 'absent' });
	});

	it('says a failed read failed, never that there are none', async () => {
		engine.get.mockRejectedValue(new ApiError(500, 'internal error'));
		const out = (await load(event())) as { gate: { state: string; message?: string } };
		expect(out.gate.state).toBe('error');
		expect(out.gate.message).toBe('Could not load releases.');
	});

	it('sends a page past the end back to the last page that holds releases', async () => {
		engine.get.mockResolvedValue({ data: [], total_count: 120 });
		const thrown = await Promise.resolve(load(event({}, 'http://x/admin/releases?limit=50&offset=500'))).catch((err: unknown) => err);
		expect(isRedirect(thrown)).toBe(true);
		expect((thrown as { location: string }).location).toBe('/admin/releases?limit=50&offset=100');
	});
});

describe('releases create', () => {
	it('returns the refusal when the license lacks the capability', async () => {
		engine.post.mockRejectedValue(
			new ApiError(402, 'payment_required', { error: 'payment_required', plugin: 'example', feature: 'feature:example_capability', upgrade_url: '' }),
		);
		const out = (await actions.create(event({ name: 'Launch' }))) as { status: number; data: Record<string, unknown> };
		expect(out.status).toBe(402);
		expect(out.data.refused).toEqual({ kind: 'feature', feature: 'example-capability', plugin: 'example', upgradeUrl: '' });
	});

	it('asks for a name before it calls the engine', async () => {
		const out = (await actions.create(event({ name: ' ' }))) as { status: number; data: { fields: Record<string, string> } };
		expect(out.status).toBe(400);
		expect(out.data.fields.name).toBe('Enter a name.');
		expect(engine.post).not.toHaveBeenCalled();
	});

	it('opens the new release once it exists', async () => {
		engine.post.mockResolvedValue({ id: 'r9', name: 'Launch' });
		await expect(actions.create(event({ name: 'Launch', description: 'All of it' }))).rejects.toMatchObject({
			status: 303,
			location: '/admin/releases/r9',
		});
		expect(engine.post).toHaveBeenCalledWith('/api/admin/content/releases', { name: 'Launch', description: 'All of it', items: [] });
	});
});
