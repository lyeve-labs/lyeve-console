import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@lyeve-labs/client';

const engine = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('#lib/server/authz.ts', async (importOriginal) => ({
	...((await importOriginal()) as object),
	authedClient: vi.fn(() => engine),
	requireUser: vi.fn(async () => ({ id: 'u1', roles: ['admin'] })),
}));

import { actions } from './+page.server';

function event(fields: Record<string, string | string[]>) {
	const data = new FormData();
	for (const [k, v] of Object.entries(fields)) for (const one of Array.isArray(v) ? v : [v]) data.append(k, one);
	return { params: { schema: 'posts', id: 'e1' }, request: { formData: async () => data } } as never;
}

type Failure = { status: number; data: Record<string, unknown> };

beforeEach(() => vi.clearAllMocks());

describe('entry comments', () => {
	it('starts a thread with the people it mentions', async () => {
		engine.post.mockResolvedValue({ id: 'c1' });
		expect(await actions.comment(event({ body: 'Check the date', mentions: ['u2', 'u3'] }))).toEqual({ commented: true });
		expect(engine.post).toHaveBeenCalledWith('/api/admin/content/entries/e1/comments', { body: 'Check the date', mentions: ['u2', 'u3'] });
	});

	it('replies under the thread it names', async () => {
		engine.post.mockResolvedValue({ id: 'c2' });
		await actions.comment(event({ body: 'Fixed', parent_id: 'c1' }));
		expect(engine.post.mock.calls[0][1]).toMatchObject({ parent_id: 'c1' });
	});

	it('keeps a refused comment in the panel, as a refusal', async () => {
		engine.post.mockRejectedValue(
			new ApiError(402, 'payment_required', { error: 'payment_required', plugin: 'example', feature: 'feature:example_capability' }),
		);
		const out = (await actions.comment(event({ body: 'x' }))) as Failure;
		expect(out.status).toBe(402);
		expect(out.data.comments).toBe(true);
		expect(out.data.refused).toMatchObject({ feature: 'example-capability' });
	});

	it('resolves and reopens a thread', async () => {
		engine.post.mockResolvedValue({});
		await actions.resolveThread(event({ comment_id: 'c1', resolved: 'true' }));
		expect(engine.post).toHaveBeenLastCalledWith('/api/admin/content/entries/e1/comments/c1/resolve', {});
		await actions.resolveThread(event({ comment_id: 'c1', resolved: 'false' }));
		expect(engine.post).toHaveBeenLastCalledWith('/api/admin/content/entries/e1/comments/c1/reopen', {});
	});
});

describe('adding the entry to a release', () => {
	it('posts the entry and the action to the release it picked', async () => {
		engine.post.mockResolvedValue({});
		expect(await actions.addToRelease(event({ release_id: 'r1', action: 'unpublish' }))).toEqual({ addedToRelease: 'r1' });
		expect(engine.post).toHaveBeenCalledWith('/api/admin/content/releases/r1/items', { entry_id: 'e1', action: 'unpublish' });
	});
});
