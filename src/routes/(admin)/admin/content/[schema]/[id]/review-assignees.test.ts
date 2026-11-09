import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Cookies } from '@sveltejs/kit';

const engine = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('$lib/server/authz', async (importOriginal) => {
	const real = await importOriginal<typeof import('$lib/server/authz')>();
	return {
		...real,
		requireUser: vi.fn(async () => ({ id: 'u1', roles: ['admin'] }) as never),
		// The load reads through the real client over its event's fetch. An
		// action's event carries no fetch and gets the fake.
		authedClient: vi.fn((event: { fetch?: unknown }) => (event.fetch ? real.authedClient(event as never) : engine)),
	};
});
vi.mock('@lyeve-labs/client-rest', () => ({
	getSchema: vi.fn(async () => ({ name: 'article', fields: [] })),
}));

import { actions, load } from './+page.server';
import type { EntryReview } from '$lib/server/entry-panels';

const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';
const C = '33333333-3333-3333-3333-333333333333';

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const ASSIGNMENT = { id: 'a1', entry_id: 'e1', definition_id: 'd1', current_stage_id: 's2', assignee_id: A, status: 'in_review' };

async function loadReview(routes: Record<string, unknown>): Promise<EntryReview> {
	const fetch = vi.fn(async (input: string | URL | Request) => {
		const path = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
		for (const [needle, body] of Object.entries(routes)) if (path.includes(needle)) return json(body);
		if (path.includes('/revisions')) return json({ data: [] });
		if (path.includes('/api/admin/review/')) return json({ error: 'not found' }, 404);
		return json({ id: 'e1', created_at: '', updated_at: '', title: 'One', body: {}, status: 'draft' });
	}) as unknown as typeof globalThis.fetch;
	const out = (await load({
		fetch,
		cookies: { get: vi.fn(() => 'token') } as unknown as Cookies,
		url: new URL('http://localhost/admin/content/article/e1'),
		params: { schema: 'article', id: 'e1' },
		parent: async () => ({
			plugins: { state: 'named', running: ['review'], withheld: [] },
			user: { id: A, roles: ['admin'] },
		}),
	} as never)) as unknown as { review: EntryReview };
	return out.review;
}

function actionEvent(fields: Record<string, string>) {
	const data = new FormData();
	for (const [k, v] of Object.entries(fields)) data.set(k, v);
	return { request: { formData: async () => data }, params: { schema: 'article', id: 'e1' } } as never;
}

beforeEach(() => vi.clearAllMocks());

describe('the review bar load', () => {
	it('reads the assignees, the approvals and the quorum from the entry assignment alone', async () => {
		const review = await loadReview({
			'/entries/e1/assignment': { ...ASSIGNMENT, assignee_ids: [A, B], approvals: [B], required_approvals: 2 },
			'/assignments/a1/sla': [],
			'/definitions?': { data: [], licensed: true, limits: { workflows: { limit: null, current: 1 } } },
		});
		expect(review.assignment?.assignee_ids).toEqual([A, B]);
		expect(review.assignment?.approvals).toEqual([B]);
		expect(review.approvalsNeeded).toBe(2);
	});

	it('needs one approval when the read states no quorum', async () => {
		const review = await loadReview({
			'/entries/e1/assignment': ASSIGNMENT,
			'/assignments/a1/sla': [],
			'/definitions?': { data: [] },
		});
		expect(review.assignment?.id).toBe('a1');
		expect(review.assignment?.assignee_ids).toEqual([]);
		expect(review.approvalsNeeded).toBe(1);
	});
});

describe('the review picker', () => {
	it('offers the accounts the directory read answered', async () => {
		const review = await loadReview({
			'/entries/e1/assignment': ASSIGNMENT,
			'/assignments/a1/sla': [],
			'/definitions?': { data: [] },
			'/api/admin/users?': [{ id: B, email: 'mira.costa@example.com' }],
		});
		expect(review.people).toEqual([{ id: B, email: 'mira.costa@example.com', tenant_id: '' }]);
	});
});

describe('starting a review', () => {
	it('sends every assignee, the primary first and none twice', async () => {
		engine.post.mockResolvedValue({ id: 'a2' });
		await expect(
			actions.reviewStart(actionEvent({ definition_id: 'd1', assignee_id: A, other_assignees: `${B}\n${A}, ${B}` })),
		).rejects.toMatchObject({ status: 303 });
		expect(engine.post).toHaveBeenCalledWith('/api/admin/review/assignments', {
			entry_id: 'e1',
			definition_id: 'd1',
			assignee_id: A,
			assignee_ids: [A, B],
		});
	});

	it('reads one field per assignee the picker posts', async () => {
		engine.post.mockResolvedValue({ id: 'a2' });
		const data = new FormData();
		data.set('definition_id', 'd1');
		data.set('assignee_id', A);
		data.append('other_assignees', B);
		data.append('other_assignees', C);
		data.append('other_assignees', A);
		const event = { request: { formData: async () => data }, params: { schema: 'article', id: 'e1' } } as never;
		await expect(actions.reviewStart(event)).rejects.toMatchObject({ status: 303 });
		expect(engine.post.mock.calls[0][1]).toEqual({
			entry_id: 'e1',
			definition_id: 'd1',
			assignee_id: A,
			assignee_ids: [A, B, C],
		});
	});

	it('sends one assignee as it always did', async () => {
		engine.post.mockResolvedValue({ id: 'a2' });
		await expect(actions.reviewStart(actionEvent({ definition_id: 'd1', assignee_id: A }))).rejects.toMatchObject({
			status: 303,
		});
		expect(engine.post.mock.calls[0][1]).toEqual({ entry_id: 'e1', definition_id: 'd1', assignee_id: A });
	});
});
