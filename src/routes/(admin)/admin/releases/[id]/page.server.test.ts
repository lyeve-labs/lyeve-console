import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@lyeve-labs/client';

const engine = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('$lib/server/authz', () => ({
	authedClient: vi.fn(() => engine),
	requireUser: vi.fn(async () => ({ id: 'u1', roles: ['admin'] })),
}));

import { actions, load } from './+page.server';

function event(form: Record<string, string> = {}) {
	const data = new FormData();
	for (const [k, v] of Object.entries(form)) data.set(k, v);
	return { params: { id: 'r1' }, request: { formData: async () => data } } as never;
}

const release = {
	id: 'r1',
	name: 'Launch',
	status: 'draft',
	item_count: 1,
	items: [{ entry_id: 'e1', action: 'publish', added_by: 'u1', created_at: '' }],
};

beforeEach(() => vi.clearAllMocks());

describe('release load', () => {
	it('names each entry from the entry itself and reads the conflicts', async () => {
		engine.get.mockImplementation(async (url: string) => {
			if (url.endsWith('/conflicts')) return { data: [{ entry_id: 'e1', kind: 'other_release', detail: '' }] };
			if (url === '/api/admin/content/e1') return { title: 'Hello', schema: 'posts', status: 'draft' };
			return release;
		});
		const out = (await load(event())) as Record<string, unknown>;
		expect(out.labels).toEqual({ e1: { title: 'Hello', schema: 'posts', status: 'draft' } });
		expect(out.conflicts).toHaveLength(1);
		expect(out.conflictsRead).toBe(true);
	});

	it('offers the entries the release does not hold yet', async () => {
		engine.get.mockImplementation(async (url: string) => {
			if (url.endsWith('/conflicts')) return { data: [] };
			if (url.startsWith('/api/admin/content?')) {
				return {
					data: [
						{ id: 'e1', title: 'Hello', slug: 'hello', schema: 'posts' },
						{ id: 'e2', title: 'Pricing', slug: 'pricing', schema: 'pages', body: { text: 'x' } },
					],
					total_count: 2,
				};
			}
			if (url === '/api/admin/content/e1') return { title: 'Hello', schema: 'posts', status: 'draft' };
			return release;
		});
		const out = (await load(event())) as Record<string, unknown>;
		expect(out.choices).toEqual([{ id: 'e2', title: 'Pricing', slug: 'pricing', schema: 'pages' }]);
		expect(engine.get).toHaveBeenCalledWith('/api/admin/content?limit=200&offset=0');
	});

	it('offers no entries to a release that went out', async () => {
		engine.get.mockImplementation(async (url: string) => {
			if (url.endsWith('/conflicts')) return { data: [] };
			if (url.startsWith('/api/admin/content/')) return { title: 'Hello', schema: 'posts', status: 'published' };
			return { ...release, status: 'published' };
		});
		const out = (await load(event())) as Record<string, unknown>;
		expect(out.choices).toBeNull();
		expect(engine.get.mock.calls.some(([url]) => String(url).startsWith('/api/admin/content?'))).toBe(false);
	});

	it('answers 404 for a release that is not there', async () => {
		engine.get.mockRejectedValue(new ApiError(404, 'release not found'));
		await expect(load(event())).rejects.toMatchObject({ status: 404 });
	});
});

describe('release actions', () => {
	it('returns the conflicts a refused publish carried', async () => {
		const conflicts = [{ entry_id: 'e1', kind: 'entry_schedule', detail: 'publish_at' }];
		engine.post.mockRejectedValue(new ApiError(409, 'the release has conflicts with other schedules', { error: 'x', conflicts }));
		const out = (await actions.publish(event())) as { status: number; data: Record<string, unknown> };
		expect(out.status).toBe(409);
		expect(out.data.conflicts).toEqual(conflicts);
	});

	it('schedules at the UTC instant the browser sent', async () => {
		engine.post.mockResolvedValue(release);
		await actions.schedule(event({ publish_at: '2027-01-02T03:04:00.000Z' }));
		expect(engine.post).toHaveBeenCalledWith('/api/admin/content/releases/r1/schedule', { publish_at: '2027-01-02T03:04:00.000Z' });
	});

	it('renders a refused entry write as a refusal', async () => {
		engine.post.mockRejectedValue(
			new ApiError(402, 'payment_required', { error: 'payment_required', plugin: 'example', feature: 'feature:example_capability' }),
		);
		const out = (await actions.addItem(event({ entry_id: 'e2', action: 'publish' }))) as { status: number; data: Record<string, unknown> };
		expect(out.status).toBe(402);
		expect(out.data.refused).toMatchObject({ kind: 'feature', feature: 'example-capability' });
	});

	it('removes an entry by its id', async () => {
		engine.delete.mockResolvedValue(release);
		await actions.removeItem(event({ entry_id: 'e1' }));
		expect(engine.delete).toHaveBeenCalledWith('/api/admin/content/releases/r1/items/e1');
	});
});

type Failure = { status: number; data: Record<string, unknown> };

describe('release writes', () => {
	it('saves the name and the description', async () => {
		engine.put.mockResolvedValue(release);
		expect(await actions.update(event({ name: ' Launch ', description: 'Spring' }))).toEqual({ saved: true });
		expect(engine.put).toHaveBeenCalledWith('/api/admin/content/releases/r1', { name: 'Launch', description: 'Spring' });
	});

	// The drawers share one form result with the hidden forms, so each failure
	// names the action that caused it.
	it.each([
		['update', () => actions.update(event({ name: 'Launch' })), 'put'],
		['unschedule', () => actions.unschedule(event()), 'delete'],
		['cancel', () => actions.cancel(event()), 'post'],
		['delete', () => actions.delete(event()), 'delete'],
	] as const)('names %s on a refusal and relays its reason', async (action, run, method) => {
		engine[method].mockRejectedValue(new ApiError(409, 'the release is publishing', { error: 'the release is publishing', code: 'conflict' }));
		const out = (await run()) as Failure;
		expect(out.data).toMatchObject({ action, error: 'the release is publishing' });
	});

	it.each([
		['update', () => actions.update(event({ name: 'Launch' })), 'put', 'Could not save the release. Try again.'],
		['unschedule', () => actions.unschedule(event()), 'delete', 'Could not remove the schedule. Try again.'],
		['cancel', () => actions.cancel(event()), 'post', 'Could not cancel the release. Try again.'],
		['delete', () => actions.delete(event()), 'delete', 'Could not delete the release. Try again.'],
	] as const)('keeps outage detail out of %s', async (action, run, method, sentence) => {
		engine[method].mockRejectedValue(new ApiError(503, 'pq: down'));
		expect(((await run()) as Failure).data).toMatchObject({ action, error: sentence });
	});

	it('relays the role refusal the engine sends', async () => {
		engine.post.mockRejectedValue(new ApiError(403, 'insufficient permissions', { error: 'insufficient permissions', code: 'forbidden' }));
		expect(((await actions.cancel(event())) as Failure).data).toMatchObject({ action: 'cancel', error: 'insufficient permissions' });
	});

	it('unschedules, cancels and deletes the release it names', async () => {
		engine.delete.mockResolvedValue(release);
		engine.post.mockResolvedValue(release);
		expect(await actions.unschedule(event())).toEqual({ unscheduled: true });
		expect(engine.delete).toHaveBeenCalledWith('/api/admin/content/releases/r1/schedule');
		expect(await actions.cancel(event())).toEqual({ canceled: true });
		expect(engine.post).toHaveBeenCalledWith('/api/admin/content/releases/r1/cancel', {});
		await expect(actions.delete(event())).rejects.toMatchObject({ status: 303, location: '/admin/releases' });
		expect(engine.delete).toHaveBeenCalledWith('/api/admin/content/releases/r1');
	});

	it('keeps a refused conflict read as its gate, never as no conflicts', async () => {
		engine.get.mockImplementation(async (url: string) => {
			if (url.endsWith('/conflicts')) throw new ApiError(403, 'forbidden');
			if (url === '/api/admin/content/e1') return { title: 'Hello', schema: 'posts', status: 'draft' };
			if (url.startsWith('/api/admin/content?')) return { data: [] };
			return release;
		});
		const out = (await load(event())) as Record<string, unknown>;
		expect(out.conflictsRead).toBe(false);
		expect(out.conflictsGate).toEqual({ state: 'forbidden' });
	});
});

