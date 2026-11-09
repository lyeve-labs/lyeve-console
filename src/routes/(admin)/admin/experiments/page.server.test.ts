import { beforeEach, describe, expect, it, vi } from 'vitest';

const engine = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('$lib/server/authz', async (importOriginal) => ({
	...((await importOriginal()) as object),
	authedClient: vi.fn(() => engine),
	requireRole: vi.fn(async () => ({ id: 'u1', roles: ['admin'] })),
}));

import { ApiError } from '@lyeve-labs/client';
import { assertRole, requireRole } from '$lib/server/authz';
import { actions, load } from './+page.server';

function event(form: Record<string, string>) {
	const data = new FormData();
	data.set('confirmed', 'yes');
	for (const [k, v] of Object.entries(form)) data.set(k, v);
	const request = { formData: async () => data, clone: () => request };
	return { request } as never;
}

beforeEach(() => {
	vi.clearAllMocks();
	engine.post.mockResolvedValue({});
	engine.put.mockResolvedValue({});
});

// The engine counts a result as significant when its p-value is below one
// minus the threshold, so the threshold is a confidence level. A form that
// sends 0.05 asks for p < 0.95 and declares a winner on noise.
describe('experiment significance threshold', () => {
	it('sends a confidence of 0.95 when the field is left empty', async () => {
		await actions.create(event({ name: 'Checkout button' }));
		expect(engine.post).toHaveBeenCalledOnce();
		expect(engine.post.mock.calls[0][1]).toMatchObject({ significance_threshold: 0.95 });
	});

	it('saves an experiment stored at 0.95 unchanged', async () => {
		const out = await actions.update(event({ id: 'e1', name: 'Checkout button', significance_threshold: '0.95', min_sample_size: '100' }));
		expect(out).toEqual({ saved: 'Checkout button' });
		expect(engine.put.mock.calls[0][0]).toBe('/api/admin/ab/experiments/e1');
		expect(engine.put.mock.calls[0][1]).toMatchObject({ significance_threshold: 0.95 });
	});

	it.each(['0.5', '0.9', '0.99', '0.999'])('accepts a confidence of %s', async (value) => {
		await actions.create(event({ name: 'x', significance_threshold: value }));
		expect(engine.post.mock.calls[0][1]).toMatchObject({ significance_threshold: Number(value) });
	});

	it.each(['0.05', '0.2', '0.49', '1', '0', '-0.95', 'high'])('refuses %s before calling the engine', async (value) => {
		const out = (await actions.create(event({ name: 'x', significance_threshold: value }))) as { status: number; data: { error: string } };
		expect(out.status).toBe(400);
		expect(out.data.error).toContain('confidence');
		expect(engine.post).not.toHaveBeenCalled();
	});
});

describe('experiments list', () => {
	function loadEvent(href: string) {
		return {
			url: new URL(href),
			parent: async () => ({ plugins: { state: 'named', running: ['ab-testing'], withheld: [] } }),
		} as never;
	}

	// A page past the end of a list that shrank is not an empty list.
	it('sends a page past the end back to the last page', async () => {
		engine.get.mockResolvedValue({ data: [], total_count: 30 });

		await expect(load(loadEvent('http://localhost/admin/experiments?limit=25&offset=50'))).rejects.toMatchObject({
			status: 307,
			location: expect.stringContaining('offset=25'),
		});
	});
});

// The drawer reads only a failure tagged as a save, so each failure is tagged.
describe('experiment action failures', () => {
	it('tags a failed delete as a delete', async () => {
		engine.delete.mockRejectedValue(new Error('down'));
		const out = (await actions.delete(event({ id: 'e1' }))) as { data: { action: string } };
		expect(out.data.action).toBe('delete');
	});

	it('tags a refused save as a save', async () => {
		const out = (await actions.create(event({ name: '' }))) as { data: { action: string } };
		expect(out.data.action).toBe('save');
	});
});

describe('experiment description', () => {
	it('sends an emptied description on an edit as a clear', async () => {
		await actions.update(event({ id: 'e1', name: 'Checkout button', description: '' }));
		expect(engine.put.mock.calls[0][1]).toMatchObject({ description: '' });
	});

	it('leaves an empty description out of a create', async () => {
		await actions.create(event({ name: 'Checkout button', description: '  ' }));
		expect(engine.post.mock.calls[0][1].description).toBeUndefined();
	});
});

describe('experiment moves', () => {
	it('posts the move to its own route', async () => {
		const out = await actions.move(event({ id: 'e1', move: 'start' }));
		expect(out).toEqual({ moved: 'start' });
		expect(engine.post.mock.calls[0][0]).toBe('/api/admin/ab/experiments/e1/start');
	});

	it('relays the reason the plugin refuses a move with', async () => {
		engine.post.mockRejectedValue(new ApiError(409, 'cannot start an experiment that is stopped', { error: 'cannot start an experiment that is stopped', code: 'conflict' }));
		const out = (await actions.move(event({ id: 'e1', move: 'start' }))) as { status: number; data: { action: string; error: string } };
		expect(out.status).toBe(400);
		expect(out.data).toEqual({ action: 'move', error: 'cannot start an experiment that is stopped' });
	});

	it('keeps driver text out of a move that meets an outage', async () => {
		engine.post.mockRejectedValue(new ApiError(503, 'pq: connection refused'));
		const out = (await actions.move(event({ id: 'e1', move: 'pause' }))) as { data: { action: string; error: string } };
		expect(out.data.action).toBe('move');
		expect(out.data.error).not.toContain('pq:');
	});

	it('refuses a move that is not one of the four', async () => {
		const out = (await actions.move(event({ id: 'e1', move: 'archive' }))) as { status: number };
		expect(out.status).toBe(400);
		expect(engine.post).not.toHaveBeenCalled();
	});

	it('refuses an editor before calling the plugin', async () => {
		vi.mocked(requireRole).mockImplementationOnce(async (_event, roles) => assertRole({ id: 'u2', roles: ['editor'] } as never, roles));
		await expect(actions.move(event({ id: 'e1', move: 'start' }))).rejects.toMatchObject({ status: 403 });
		expect(engine.post).not.toHaveBeenCalled();
	});
});
