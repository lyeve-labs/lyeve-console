import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@lyeve-labs/client';

const engine = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('$lib/server/authz', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/authz')>()),
	requireUser: vi.fn(async () => ({ id: 'u1', roles: ['admin'] }) as never),
	authedClient: vi.fn(() => engine),
}));

import { actions } from './+page.server';

type Failure = { status: number; data: Record<string, unknown> };

function actionEvent(fields: Record<string, string> = {}) {
	const data = new FormData();
	for (const [k, v] of Object.entries(fields)) data.set(k, v);
	return { request: { formData: async () => data }, params: { schema: 'article', id: 'e1' } } as never;
}

beforeEach(() => vi.clearAllMocks());

describe('publishing an entry', () => {
	it('sets the entry published and reloads it', async () => {
		engine.put.mockResolvedValue({});
		await expect(actions.publish(actionEvent())).rejects.toMatchObject({ status: 303, location: '/admin/content/article/e1' });
		expect(engine.put).toHaveBeenCalledWith('/api/admin/content/e1', { status: 'published' });
	});

	it('relays the reason the plugin refused', async () => {
		engine.put.mockRejectedValue(new ApiError(409, 'entry has a pending review', { error: 'entry has a pending review', code: 'conflict' }));
		const out = (await actions.publish(actionEvent())) as Failure;
		expect(out.data.error).toBe('entry has a pending review');
	});

	it('relays the role refusal the engine sends', async () => {
		engine.put.mockRejectedValue(new ApiError(403, 'insufficient permissions', { error: 'insufficient permissions', code: 'forbidden' }));
		const out = (await actions.publish(actionEvent())) as Failure;
		expect(out.data.error).toBe('insufficient permissions');
	});

	it('keeps outage detail out of the message', async () => {
		engine.put.mockRejectedValue(new ApiError(503, 'pq: connection refused'));
		const out = (await actions.publish(actionEvent())) as Failure;
		expect(out.data.error).toBe('Could not publish the entry. Try again.');
	});
});

describe('moving a review', () => {
	it('sends the action and the comment to the assignment', async () => {
		engine.post.mockResolvedValue({ id: 'a1' });
		await expect(
			actions.reviewTransition(actionEvent({ assignment_id: 'a1', action: 'approve', comment: 'Fine' })),
		).rejects.toMatchObject({ status: 303 });
		expect(engine.post).toHaveBeenCalledWith('/api/admin/review/assignments/a1/transition', { action: 'approve', comment: 'Fine' });
	});

	it('refuses an action the plugin does not know without calling it', async () => {
		const out = (await actions.reviewTransition(actionEvent({ assignment_id: 'a1', action: 'shred' }))) as Failure;
		expect(out.status).toBe(400);
		expect(engine.post).not.toHaveBeenCalled();
	});

	it('keeps the 403 so the bar can say the refusal is a role rule', async () => {
		engine.post.mockRejectedValue(new ApiError(403, 'not an approver for this stage', { error: 'not an approver for this stage', code: 'forbidden' }));
		const out = (await actions.reviewTransition(actionEvent({ assignment_id: 'a1', action: 'approve' }))) as Failure;
		expect(out.status).toBe(403);
		expect(out.data).toMatchObject({ review: true, reviewStatus: 403, error: 'not an approver for this stage' });
	});

	it('keeps outage detail out of the message', async () => {
		engine.post.mockRejectedValue(new ApiError(503, 'pq: connection refused'));
		const out = (await actions.reviewTransition(actionEvent({ assignment_id: 'a1', action: 'approve' }))) as Failure;
		expect(out.data).toMatchObject({ error: 'Could not move the review. Try again.', reviewStatus: 503 });
	});
});
