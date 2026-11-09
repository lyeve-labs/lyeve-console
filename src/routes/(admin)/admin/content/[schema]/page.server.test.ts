import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Cookies } from '@sveltejs/kit';

// The real session client, so every read goes through the event's fetch with
// the session's headers.
vi.mock('$lib/server/authz', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/authz')>()),
	requireUser: vi.fn(async () => ({ id: 'u1' })),
}));

const rest = vi.hoisted(() => ({
	getSchemas: vi.fn(async () => [{ name: 'posts', display_name: 'Posts' }]),
	getSchema: vi.fn(async () => ({ name: 'posts', display_name: 'Posts', fields: [] })),
}));
vi.mock('@lyeve-labs/client-rest', () => rest);

import { ApiError } from '@lyeve-labs/client';
import { isHttpError, isRedirect } from '@sveltejs/kit';
import { actions, load } from './+page.server';

/**
 * The load's own return type is widened by the framework to include void, so
 * every read of a returned field trips the type checker. The shape asserted
 * here is the one the page consumes.
 */
type Loaded = {
	items: { ok: true; value: { data: Record<string, unknown> }[] } | { ok: false; gate: { state: string } };
	schemas: { ok: boolean };
	limit: number;
	offset: number;
	total: number;
};

function mockCookies(initial: Record<string, string> = {}): Cookies {
	return {
		get: vi.fn((name: string) => initial[name] ?? undefined),
		set: vi.fn(),
		delete: vi.fn(),
		getAll: vi.fn(() => []),
		serialize: vi.fn(() => ''),
	} as unknown as Cookies;
}

function rows(count: number, from = 0) {
	return Array.from({ length: count }, (_, i) => ({
		id: `e${from + i}`,
		title: `Entry ${from + i}`,
		body: { headline: `h${from + i}` },
		status: 'published',
		created_at: '2026-01-01T00:00:00Z',
		updated_at: '2026-01-02T00:00:00Z',
	}));
}

async function runLoad(query: string, body: unknown) {
	const fetch = vi.fn(
		async () =>
			new Response(JSON.stringify(body), {
				status: 200,
				headers: { 'content-type': 'application/json' },
			}),
	);
	const result = (await load({
		fetch,
		cookies: mockCookies({ '__Host-sys_session': 'tok' }),
		params: { schema: 'posts' },
		url: new URL(`http://localhost/admin/content/posts${query}`),
	} as never)) as unknown as Loaded;
	return { fetch, result };
}

/** The `limit=` value of the single content listing request the load makes. */
function requestedLimit(fetch: { mock: { calls: unknown[][] } }): number {
	const requested = new URL(String((fetch.mock.calls[0] as unknown[])[0]), 'http://localhost');
	return Number(requested.searchParams.get('limit'));
}

// The engine answers list endpoints through httpx.Paginated, whose envelope is
// {"data", "total_count", "limit", "offset"}. The load keeps the count, because
// items.length is the size of the page rather than of the collection.
describe('content listing reads the collection total from the envelope', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('takes total from total_count, not from the number of rows', async () => {
		const { result } = await runLoad('?limit=100', {
			data: rows(100),
			total_count: 4000,
			limit: 100,
			offset: 0,
		});

		expect(result.total).toBe(4000);
		expect(result.items.ok && result.items.value).toHaveLength(100);
	});

	it('keeps the envelope total on a later page', async () => {
		const { result } = await runLoad('?limit=100&offset=300', {
			data: rows(100, 300),
			total_count: 4000,
			limit: 100,
			offset: 300,
		});

		expect(result.total).toBe(4000);
		expect(result.offset).toBe(300);
	});

	it('never reports a total below the rows already paged past', async () => {
		// A response carrying no count would otherwise fall back to the page
		// length, which is smaller than the offset the reader already passed.
		const { result } = await runLoad('?limit=100&offset=300', { data: rows(100, 300) });

		expect(result.total).toBe(400);
	});

	it.each([
		[503, 'unavailable'],
		[500, 'error'],
		[403, 'forbidden'],
	])('draws a gate, never an empty collection, when the listing answers %i', async (status, state) => {
		const fetch = vi.fn(async () => new Response('nope', { status }));
		const result = (await load({
			fetch,
			cookies: mockCookies({ '__Host-sys_session': 'tok' }),
			params: { schema: 'posts' },
			url: new URL('http://localhost/admin/content/posts'),
		} as never)) as unknown as Loaded;

		expect(result.items).toMatchObject({ ok: false, gate: { state } });
		expect(result.total).toBe(0);
	});

	it('sends a page past the end back to the last page that holds rows', async () => {
		const pending = load({
			fetch: vi.fn(async () => new Response(JSON.stringify({ data: [], total_count: 120 }), { status: 200 })),
			cookies: mockCookies({ '__Host-sys_session': 'tok' }),
			params: { schema: 'posts' },
			url: new URL('http://localhost/admin/content/posts?limit=50&offset=500'),
		} as never);

		const thrown = await Promise.resolve(pending).catch((err: unknown) => err);
		expect(isRedirect(thrown)).toBe(true);
		expect((thrown as { location: string }).location).toBe('/admin/content/posts?limit=50&offset=100');
	});
});

describe('content listing reads its collection', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('answers 404 only when the engine says the collection does not exist', async () => {
		rest.getSchema.mockRejectedValueOnce(new ApiError(404, 'not found'));
		const thrown = await runLoad('', { data: [] }).catch((err: unknown) => err);
		expect(isHttpError(thrown) && thrown.status).toBe(404);
	});

	it('reports an outage as an outage, not as a missing collection', async () => {
		rest.getSchema.mockRejectedValueOnce(new ApiError(503, 'unavailable'));
		const thrown = await runLoad('', { data: [] }).catch((err: unknown) => err);
		expect(isHttpError(thrown) && thrown.status).toBe(503);
	});

	it('keeps the picker read apart from the entries read', async () => {
		rest.getSchemas.mockRejectedValueOnce(new ApiError(503, 'unavailable'));
		const { result } = await runLoad('', { data: rows(2), total_count: 2 });
		expect(result.schemas.ok).toBe(false);
		expect(result.items.ok).toBe(true);
	});

	it('asks the listing for the status the URL names, and ignores one it does not know', async () => {
		const { fetch, result } = await runLoad('?status=draft', { data: [], total_count: 0 });
		expect(new URL(String((fetch.mock.calls[0] as unknown[])[0]), 'http://localhost').searchParams.get('status')).toBe('draft');
		expect((result as unknown as { status: string | null }).status).toBe('draft');

		const other = await runLoad('?status=famous', { data: [], total_count: 0 });
		expect(new URL(String((other.fetch.mock.calls[0] as unknown[])[0]), 'http://localhost').searchParams.has('status')).toBe(false);
	});

	it('reads the listing as the session', async () => {
		const { fetch } = await runLoad('', { data: [], total_count: 0 });
		const init = (fetch.mock.calls[0] as unknown[])[1] as RequestInit;
		expect(init.headers).toMatchObject({ Authorization: 'Bearer tok' });
	});
});

// reqparse.MaxPageLimit is 500 and ParsePagination clamps an over-limit request
// rather than rejecting it, so asking for more comes back silently truncated.
describe('content listing clamps the page size to the server maximum', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('clamps a request above the server maximum to 500', async () => {
		const { fetch, result } = await runLoad('?limit=1000', {
			data: rows(500),
			total_count: 4000,
		});

		expect(requestedLimit(fetch)).toBe(500);
		expect(result.limit).toBe(500);
	});

	it('asks for exactly the limit, with no has-more probe row', async () => {
		const { fetch, result } = await runLoad('?limit=100', { data: rows(100), total_count: 4000 });

		expect(requestedLimit(fetch)).toBe(100);
		expect(result.items.ok && result.items.value).toHaveLength(100);
	});

	it('asks for exactly 500 at the top of the range, never 501', async () => {
		// A limit+1 probe here would ask for 501, which the server clamps to
		// 500. A full page would then look short and report no next page.
		const { fetch } = await runLoad('?limit=500', { data: rows(500), total_count: 4000 });

		expect(requestedLimit(fetch)).toBe(500);
	});

	it('falls back to 100 when no limit is given', async () => {
		const { fetch, result } = await runLoad('', { data: rows(100), total_count: 4000 });

		expect(requestedLimit(fetch)).toBe(100);
		expect(result.limit).toBe(100);
	});

	it('floors a negative limit at one, so no request carries a negative page size', async () => {
		const { fetch, result } = await runLoad('?limit=-5', { data: rows(1), total_count: 4000 });

		expect(requestedLimit(fetch)).toBe(1);
		expect(result.limit).toBe(1);
	});
});

describe('content listing, an integer past 2^53', () => {
	it('shows the stored digits of an integer field, and a json number as a number', async () => {
		rest.getSchema.mockResolvedValueOnce({
			name: 'posts',
			display_name: 'Posts',
			fields: [
				{ name: 'views', field_type: 'integer' },
				{ name: 'stats', field_type: 'json' },
			],
		} as never);
		const raw =
			'{"data":[{"id":"e1","title":"One","status":"published","created_at":"","updated_at":"",' +
			'"body":{"views":9007199254740993,"stats":{"big":1790000000000000000}}}],"total_count":1}';
		const fetch = vi.fn(async () => new Response(raw, { status: 200, headers: { 'content-type': 'application/json' } }));
		const result = (await load({
			fetch,
			cookies: mockCookies({ '__Host-sys_session': 'tok' }),
			params: { schema: 'posts' },
			url: new URL('http://localhost/admin/content/posts'),
		} as never)) as unknown as Loaded;

		if (!result.items.ok) throw new Error('the listing failed');
		expect(result.items.value[0].data.views).toBe('9007199254740993');
		expect(result.items.value[0].data.stats).toEqual({ big: 1790000000000000000 });
	});
});

// A link to an author is stored as the author's id. The table shows the
// author's title instead, read once for the linked content type.
describe('content listing names linked entries', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('replaces a linked id with the linked entry and its title', async () => {
		rest.getSchema.mockResolvedValueOnce({
			name: 'posts',
			display_name: 'Posts',
			fields: [
				{ name: 'headline', field_type: 'text' },
				{ name: 'author', field_type: 'relation', relation_type: 'belongs_to', relation_to: 'author' },
			],
		} as never);
		const posts = {
			data: [
				{ ...rows(1)[0], body: { headline: 'h', author: 'a1' } },
				{ ...rows(1, 1)[0], body: { headline: 'h', author: 'missing' } },
			],
			total_count: 2,
		};
		const authors = { data: [{ id: 'a1', title: 'Ada Park', created_at: '', updated_at: '' }], total_count: 1 };
		const fetch = vi.fn(async (input: string | URL | Request) => {
			const u = new URL(String(input), 'http://localhost');
			const body = u.searchParams.get('schema') === 'author' ? authors : posts;
			return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
		});
		const result = (await load({
			fetch,
			cookies: mockCookies({ '__Host-sys_session': 'tok' }),
			params: { schema: 'posts' },
			url: new URL('http://localhost/admin/content/posts'),
		} as never)) as unknown as Loaded;

		if (!result.items.ok) throw new Error('the listing failed');
		expect(result.items.value[0].data.author).toEqual({ id: 'a1', title: 'Ada Park' });
		expect(result.items.value[1].data.author).toBe('missing');
		const authorReads = fetch.mock.calls.filter((c) => String(c[0]).includes('schema=author'));
		expect(authorReads).toHaveLength(1);
	});

	it('reads a link stored under its key column, the way the console form writes it', async () => {
		rest.getSchema.mockResolvedValueOnce({
			name: 'posts',
			display_name: 'Posts',
			fields: [
				{ name: 'author', field_type: 'relation', relation_type: 'belongs_to', relation_to: 'author' },
				{ name: 'editor', field_type: 'relation', relation_to: 'author', relation_fk_name: 'edited_by' },
			],
		} as never);
		const posts = {
			data: [
				{ ...rows(1)[0], body: { author_id: 'a1', edited_by: 'a1' } },
				{ ...rows(1, 1)[0], body: { author: 'a1' } },
				{ ...rows(1, 2)[0], body: { author_id: 'missing' } },
				{ ...rows(1, 3)[0], body: { author_id: '', author: 'a1' } },
				{ ...rows(1, 4)[0], body: { author_id: 'missing', author: { id: 'b2', title: 'Bo Lee' } } },
			],
			total_count: 5,
		};
		const authors = { data: [{ id: 'a1', title: 'Ada Park', created_at: '', updated_at: '' }], total_count: 1 };
		const fetch = vi.fn(async (input: string | URL | Request) => {
			const u = new URL(String(input), 'http://localhost');
			const body = u.searchParams.get('schema') === 'author' ? authors : posts;
			return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
		});
		const result = (await load({
			fetch,
			cookies: mockCookies({ '__Host-sys_session': 'tok' }),
			params: { schema: 'posts' },
			url: new URL('http://localhost/admin/content/posts'),
		} as never)) as unknown as Loaded;

		if (!result.items.ok) throw new Error('the listing failed');
		const [byKey, byName, unknown, blankKey, carried] = result.items.value;
		expect(byKey.data.author).toEqual({ id: 'a1', title: 'Ada Park' });
		expect(byKey.data.editor).toEqual({ id: 'a1', title: 'Ada Park' });
		expect(byName.data.author).toEqual({ id: 'a1', title: 'Ada Park' });
		expect(unknown.data.author).toBe('missing');
		expect(blankKey.data.author).toEqual({ id: 'a1', title: 'Ada Park' });
		expect(carried.data.author).toEqual({ id: 'b2', title: 'Bo Lee' });
	});

	it('reads nothing more when no row links anywhere', async () => {
		const { fetch } = await runLoad('', { data: rows(3), total_count: 3 });
		expect(fetch).toHaveBeenCalledTimes(1);
	});
});

describe('deleting an entry', () => {
	function json(body: unknown, status: number): Response {
		return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
	}

	function deleteEvent(answer: () => Promise<Response>, id = 'e/1') {
		const calls: { method: string; path: string }[] = [];
		const fetch = vi.fn(async (path: string, init?: RequestInit) => {
			calls.push({ method: init?.method ?? 'GET', path });
			return answer();
		}) as unknown as typeof globalThis.fetch;
		const fd = new FormData();
		fd.set('confirmed', 'yes');
		fd.set('id', id);
		const event = {
			fetch,
			cookies: mockCookies({ '__Host-sys_session': 'tok', '__Host-csrf': 'csrf' }),
			params: { schema: 'posts' },
			request: { formData: async () => fd, clone: () => ({ formData: async () => fd }) },
		} as never;
		return { event, calls };
	}

	it('deletes the entry it names, with the id encoded', async () => {
		const { event, calls } = deleteEvent(async () => new Response(null, { status: 204 }));
		const out = await actions.delete(event);
		expect(out).toEqual({ ok: true });
		expect(calls).toEqual([{ method: 'DELETE', path: '/api/admin/content/e%2F1' }]);
	});

	it('relays the reason the plugin refused', async () => {
		const { event } = deleteEvent(async () => json({ error: 'entry is referenced by another entry', code: 'conflict' }, 409));
		const out = (await actions.delete(event)) as { status: number; data: { error: string } };
		expect(out.status).toBe(400);
		expect(out.data.error).toBe('entry is referenced by another entry');
	});

	it('relays the role refusal the engine sends', async () => {
		const { event } = deleteEvent(async () => json({ error: 'insufficient permissions', code: 'forbidden' }, 403));
		const out = (await actions.delete(event)) as { status: number; data: { error: string } };
		expect(out.data.error).toBe('insufficient permissions');
	});

	it('keeps outage detail out of the message', async () => {
		const { event } = deleteEvent(async () => json({ error: 'pq: connection refused' }, 503));
		const out = (await actions.delete(event)) as { status: number; data: { error: string } };
		expect(out.data.error).toBe('Could not delete the entry. Try again.');
	});
});

