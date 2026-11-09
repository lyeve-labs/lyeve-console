import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@lyeve-labs/client';
import { isRedirect } from '@sveltejs/kit';

const engine = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('$lib/server/authz', async (importOriginal) => ({
	...((await importOriginal()) as object),
	authedClient: vi.fn(() => engine),
	requireRole: vi.fn(async () => ({ id: 'u1', roles: ['admin'] })),
}));
vi.mock('@lyeve-labs/client-rest', () => ({ getSchemas: vi.fn(async () => [{ name: 'article' }]) }));

import { load } from './+page.server';
import type { ReviewsPage } from './+page.server';

function loadEvent() {
	return {
		url: new URL('http://localhost/admin/reviews'),
		parent: async () => ({
			user: { id: 'u1', roles: ['admin'] },
			plugins: { state: 'named', running: ['review'], withheld: [] },
		}),
	} as never;
}

beforeEach(() => {
	vi.clearAllMocks();
	engine.get.mockImplementation(async (url: string) => {
		if (url.startsWith('/api/admin/review/definitions?')) {
			return {
				data: [{ id: 'd1', name: 'Editorial', slug: 'editorial', content_schema: 'article' }],
				total_count: 1,
				licensed: false,
				limits: { workflows: { limit: 1, current: 1 } },
			};
		}
		if (url.startsWith('/api/admin/review/definitions/')) {
			return {
				definition: { id: 'd1', name: 'Editorial' },
				stages: [{ id: 's1', name: 'Legal', position: 1, quorum: 2, escalate_to_role: 'lead', condition: { field: 'category', op: 'in', values: ['legal', 4] } }],
			};
		}
		return { data: [], total_count: 0 };
	});
});

describe('the assignments load', () => {
	// The queue names each assignment's definition and stage from the
	// definitions, so an operator's load reads them with their stages.
	it('reads the definitions that name each assignment', async () => {
		const out = (await load(loadEvent())) as ReviewsPage;
		expect(out.definitions).toMatchObject({ ok: true, value: [{ definition: { id: 'd1' }, stages: [{ id: 's1', name: 'Legal' }] }] });
		expect(engine.get.mock.calls.some(([url]) => String(url).startsWith('/api/admin/schemas'))).toBe(false);
	});

	it('reads no definitions for a reviewer who is not an operator', async () => {
		const out = (await load({
			url: new URL('http://localhost/admin/reviews'),
			parent: async () => ({
				user: { id: 'u1', roles: ['editor'] },
				plugins: { state: 'named', running: ['review'], withheld: [] },
			}),
		} as never)) as ReviewsPage;
		expect(out.definitions).toEqual({ ok: true, value: [] });
		expect(engine.get.mock.calls.some(([url]) => String(url).startsWith('/api/admin/review/definitions'))).toBe(false);
	});
});

describe('the assignment names', () => {
	const ENTRY = 'e1e1e1e1-0000-0000-0000-000000000000';
	const OTHER = 'e2e2e2e2-0000-0000-0000-000000000000';
	const MIRA = '22222222-2222-2222-2222-222222222222';

	beforeEach(() => {
		const base = engine.get.getMockImplementation() as (url: string) => Promise<unknown>;
		engine.get.mockImplementation(async (url: string) => {
			if (url.startsWith('/api/admin/review/assignments?')) {
				return {
					data: [
						{ id: 'a1', entry_id: ENTRY, definition_id: 'd1', current_stage_id: 's1', assignee_id: MIRA, status: 'in_review' },
						{ id: 'a2', entry_id: OTHER, definition_id: 'd1', current_stage_id: 's1', assignee_id: 'u1', status: 'in_review' },
					],
					total_count: 2,
				};
			}
			if (url === `/api/admin/content/${ENTRY}`) return { id: ENTRY, title: 'Spring launch notes', body: {} };
			if (url === `/api/admin/content/${OTHER}`) throw new ApiError(404, 'not found', {});
			if (url.startsWith('/api/admin/users?')) return [{ id: MIRA, email: 'mira.costa@example.com' }];
			return base(url);
		});
	});

	it('reads each entry title and each account email', async () => {
		const out = (await load(loadEvent())) as ReviewsPage;
		expect(out.entries).toEqual({ [ENTRY]: 'Spring launch notes' });
		expect(out.people[MIRA]).toBe('mira.costa@example.com');
	});

	it('names the signed-in reviewer without reading the directory', async () => {
		const out = (await load({
			url: new URL('http://localhost/admin/reviews'),
			parent: async () => ({
				user: { id: 'u1', email: 'reviewer@example.com', roles: ['editor'] },
				plugins: { state: 'named', running: ['review'], withheld: [] },
			}),
		} as never)) as ReviewsPage;
		expect(out.people).toEqual({ u1: 'reviewer@example.com' });
		expect(engine.get.mock.calls.some(([url]) => String(url).startsWith('/api/admin/users'))).toBe(false);
	});

	it('reads no entry title for a reviewer the content routes refuse', async () => {
		const out = (await load({
			url: new URL('http://localhost/admin/reviews'),
			parent: async () => ({
				user: { id: 'u1', roles: ['editor'] },
				plugins: { state: 'named', running: ['review'], withheld: [] },
			}),
		} as never)) as ReviewsPage;
		expect(out.entriesNamed).toBe(false);
		expect(out.assignments.ok && out.assignments.value).toHaveLength(2);
		expect(engine.get.mock.calls.some(([url]) => String(url).startsWith('/api/admin/content/'))).toBe(false);
	});
});

describe('the reviews load when a read fails', () => {
	it('keeps each failed read as its own gate', async () => {
		engine.get.mockImplementation(async (url: string) => {
			if (url.startsWith('/api/admin/review/assignments?')) throw new ApiError(503, 'unavailable');
			if (url.startsWith('/api/admin/review/definitions?')) throw new ApiError(500, 'internal');
			return { data: [], total_count: 0 };
		});
		const out = (await load(loadEvent())) as ReviewsPage;
		expect(out.assignments).toMatchObject({ ok: false, gate: { state: 'unavailable' } });
		expect(out.definitions).toMatchObject({ ok: false, gate: { state: 'error' } });
	});

	it('sends a page past the end back to the last page that holds assignments', async () => {
		engine.get.mockImplementation(async (url: string) => {
			if (url.startsWith('/api/admin/review/assignments?')) return { data: [], total_count: 60 };
			return { data: [], total_count: 0 };
		});
		const thrown = await Promise.resolve(load({
			url: new URL('http://localhost/admin/reviews?offset=500'),
			parent: async () => ({
				user: { id: 'u1', roles: ['admin'] },
				plugins: { state: 'named', running: ['review'], withheld: [] },
			}),
		} as never)).catch((err: unknown) => err);
		expect(isRedirect(thrown)).toBe(true);
		expect((thrown as { location: string }).location).toBe('/admin/reviews?offset=50');
	});
});
