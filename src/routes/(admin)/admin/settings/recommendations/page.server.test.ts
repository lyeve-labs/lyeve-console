import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@lyeve-labs/client';

const engine = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('$lib/server/authz', async (importOriginal) => ({
	...((await importOriginal()) as object),
	authedClient: vi.fn(() => engine),
	requireRole: vi.fn(async () => ({ id: 'u1', roles: ['super_admin'] })),
}));

import { requireRole } from '$lib/server/authz';
import { actions } from './+page.server';

type Failure = { status: number; data: Record<string, unknown> };

const READER = '24d6560b-540e-47b6-8957-59934db4021d';

function actionEvent(fields: Record<string, string>) {
	const data = new FormData();
	for (const [k, v] of Object.entries(fields)) data.set(k, v);
	return { request: { formData: async () => data } } as never;
}

beforeEach(() => vi.clearAllMocks());

describe('the per-reader preview', () => {
	it('generates the feed of the id posted and reads the entries the plugin answers', async () => {
		const entry = { id: 'f1', user_id: READER, content_id: 'c1', score: 0.5, source: 'trending', created_at: '' };
		engine.post.mockResolvedValue({ entries: [entry], total: 1 });
		const out = await actions.preview(actionEvent({ user_id: ` ${READER} ` }));
		expect(engine.post).toHaveBeenCalledWith(`/api/admin/recommendations/generate-feed/${READER}`, {});
		expect(out).toEqual({ previewFor: READER, feed: [entry] });
	});

	it('refuses what is not a user id before asking the plugin', async () => {
		const out = (await actions.preview(actionEvent({ user_id: 'mira@example.com' }))) as Failure;
		expect(out.status).toBe(400);
		expect(String(out.data.error)).toContain('not a user id');
		expect(engine.post).not.toHaveBeenCalled();
	});

	it('asks for a reader when none was given', async () => {
		const out = (await actions.preview(actionEvent({ user_id: '' }))) as Failure;
		expect(out.status).toBe(400);
		expect(String(out.data.error)).toContain('Enter a user id.');
	});

	it('keeps a refusal as a failure', async () => {
		engine.post.mockRejectedValue(new ApiError(503, 'failed to generate feed', {}));
		const out = (await actions.preview(actionEvent({ user_id: READER }))) as Failure;
		expect(out.status).toBe(400);
	});
});

describe('the recompute', () => {
	it('starts it and reports what it computed', async () => {
		engine.post.mockResolvedValue({
			similarity_pairs_computed: 12,
			trending_items_computed: 4,
			feeds_generated: 3,
			duration_ms: 80,
		});
		const out = await actions.refresh(actionEvent({}));
		expect(engine.post).toHaveBeenCalledWith('/api/admin/recommendations/refresh', {});
		expect(out).toEqual({ refreshed: true, pairs: 12, trending: 4, feeds: 3, ms: 80 });
	});

	it('relays the reason the plugin gives for a refusal', async () => {
		engine.post.mockRejectedValue(new ApiError(422, 'no content to rank', { error: 'no content to rank', code: 'http_422' }));
		const out = (await actions.refresh(actionEvent({}))) as Failure;
		expect(out.status).toBe(400);
		expect(out.data).toMatchObject({ action: 'refresh' });
		expect(String(out.data.error)).toContain('no content to rank');
	});

	it('says a second recompute waits for the running one', async () => {
		engine.post.mockRejectedValue(new ApiError(409, 'already running', {}));
		const out = (await actions.refresh(actionEvent({}))) as Failure;
		expect(out.status).toBe(409);
		expect(String(out.data.error)).toContain('already running');
	});

	it('gives its own sentence for an outage, not the driver text', async () => {
		engine.post.mockRejectedValue(new ApiError(503, 'dial tcp: connection refused', {}));
		const out = (await actions.refresh(actionEvent({}))) as Failure;
		expect(String(out.data.error)).toContain('Could not start the recompute. Try again.');
		expect(String(out.data.error)).not.toContain('dial tcp');
	});

	it('is for a super admin only', async () => {
		vi.mocked(requireRole).mockRejectedValueOnce(new Error('forbidden'));
		await expect(actions.refresh(actionEvent({}))).rejects.toThrow('forbidden');
		expect(vi.mocked(requireRole).mock.calls[0][1]).toEqual(['super_admin']);
		expect(engine.post).not.toHaveBeenCalled();
	});
});
