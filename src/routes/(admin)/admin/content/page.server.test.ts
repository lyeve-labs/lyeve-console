import { describe, it, expect, vi } from 'vitest';
import type { Cookies } from '@sveltejs/kit';
import { isRedirect } from '@sveltejs/kit';

import { load } from './+page.server';
import { signedIn } from '$lib/server/test-support/signed-in';

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' },
	});
}

function mockCookies(): Cookies {
	return {
		get: vi.fn(() => 'tok'),
		set: vi.fn(),
		delete: vi.fn(),
		getAll: vi.fn(() => []),
		serialize: vi.fn(() => ''),
	} as unknown as Cookies;
}

function schemas(count: number, from = 0) {
	return Array.from({ length: count }, (_, i) => ({
		name: `collection_${from + i}`,
		display_name: `Collection ${from + i}`,
		fields: [],
	}));
}

function loadEvent(body: unknown, search = '') {
	const fetch = vi.fn(async () => json(body)) as unknown as typeof globalThis.fetch;
	return {
		fetch: signedIn(fetch, { roles: ['super_admin'] }),
		cookies: mockCookies(),
		url: new URL(`http://localhost/admin/content${search}`),
	} as never;
}

type Loaded = Exclude<Awaited<ReturnType<typeof load>>, void>;

/** The rows a load answered with. A test that reads them expects the read to have succeeded. */
function loadedRows(result: Loaded) {
	if (!result.schemas.ok) throw new Error('the collections read failed');
	return result.schemas.value;
}

/*
 * The index renders one slice of the collections. The schemas endpoint
 * answers with a bare array and no row count, so the total is knowable here
 * only because the whole array is in hand: it is measured rather than probed,
 * and the slice is what bounds the page.
 */
describe('admin/content/+page.server.ts load', () => {
	it('bounds the list and states the measured total', async () => {
		const result = (await load(loadEvent(schemas(400), '?limit=50'))) as Loaded;

		expect(loadedRows(result)).toHaveLength(50);
		expect(result.total).toBe(400);
		expect(result.hasMore).toBe(true);
	});

	it('reports the end of the list on the last page', async () => {
		const result = (await load(loadEvent(schemas(120), '?limit=50&offset=100'))) as Loaded;

		expect(loadedRows(result)).toHaveLength(20);
		expect(result.hasMore).toBe(false);
		expect(result.offset).toBe(100);
	});

	// Narrowing after the page was cut would page the whole set and then hide
	// most of the page, leaving a next button that leads to an empty screen.
	it('narrows by the search before it cuts the page', async () => {
		const rows = [...schemas(300), { name: 'zebra_one', display_name: 'Zebra one', fields: [] },
			{ name: 'zebra_two', display_name: 'Zebra two', fields: [] }];

		const result = (await load(loadEvent(rows, '?q=zebra'))) as Loaded;

		expect(result.total).toBe(2);
		expect(loadedRows(result).map((schema: { name: string }) => schema.name)).toEqual([
			'zebra_one',
			'zebra_two',
		]);
		expect(result.hasMore).toBe(false);
	});

	// Resolution reads the whole set, because a name typed into the picker can
	// match a collection on any page.
	it('opens a collection that a name resolves to on a later page', async () => {
		const rows = [...schemas(300), { name: 'far_away', display_name: 'Far away', fields: [] }];

		await expect(load(loadEvent(rows, '?q=far_away'))).rejects.toSatisfy(isRedirect);
	});

	// "This tenant has exactly one collection" is a fact about the set, not
	// about the page on screen.
	it('still redirects a tenant with one collection', async () => {
		await expect(load(loadEvent(schemas(1)))).rejects.toSatisfy(isRedirect);
	});

	it('counts the rows of the collections on this page, and only those', async () => {
		// A card with no number chooses nothing. The count comes from the
		// stats endpoint per collection, asked for the page and not the tenant,
		// and a collection whose count cannot be read shows no count rather
		// than a zero nobody measured.
		const calls: string[] = [];
		const fetch = vi.fn(async (input: string | URL | Request) => {
			const url = String(input);
			calls.push(url);
			if (url.endsWith('/stats')) {
				if (url.includes('collection_1/')) return json({ error: 'no' }, 503);
				return json({ rows: 7, table: '_x' });
			}
			return json(schemas(60));
		}) as unknown as typeof globalThis.fetch;
		const event = {
			fetch: signedIn(fetch, { roles: ['super_admin'] }),
			cookies: mockCookies(),
			url: new URL('http://localhost/admin/content?limit=3'),
		} as never;

		const data = (await load(event)) as Loaded;

		expect(calls.filter((u) => u.endsWith('/stats'))).toHaveLength(3);
		expect(data.stats).toEqual({
			collection_0: { rows: 7, last_updated: undefined },
			collection_2: { rows: 7, last_updated: undefined },
		});
	});

	it.each([
		[500, 'error'],
		[503, 'unavailable'],
		[403, 'forbidden'],
	])('draws a gate, never an empty index, when the read answers %i', async (status, state) => {
		const fetch = vi.fn(async () => json({ error: 'nope' }, status)) as unknown as typeof globalThis.fetch;
		const event = {
			fetch: signedIn(fetch, { roles: ['super_admin'] }),
			cookies: mockCookies(),
			url: new URL('http://localhost/admin/content'),
		} as never;

		const result = (await load(event)) as Loaded;

		expect(result.schemas.ok).toBe(false);
		if (!result.schemas.ok) expect(result.schemas.gate.state).toBe(state);
		expect(result.total).toBe(0);
	});

	/*
	 * A row count is asked for the page and not the tenant, which is right
	 * until the order depends on it: a page cut before the counts are in is a
	 * page of whatever came first, sorted afterwards, which is not the largest
	 * collections. Sorting by rows counts the matching set first, and only
	 * that sort does.
	 */
	it('sorts by rows across the whole matching set before cutting the page', async () => {
		const calls: string[] = [];
		const fetch = vi.fn(async (input: string | URL | Request) => {
			const url = String(input);
			calls.push(url);
			if (url.endsWith('/stats')) {
				const n = Number(/collection_(\d+)\/stats/.exec(url)?.[1]);
				if (n === 4) return json({ error: 'no' }, 503);
				return json({ rows: n === 7 ? 900 : n, table: '_x' });
			}
			return json(schemas(9));
		}) as unknown as typeof globalThis.fetch;
		const event = {
			fetch: signedIn(fetch, { roles: ['super_admin'] }),
			cookies: mockCookies(),
			url: new URL('http://localhost/admin/content?limit=3&sort=rows'),
		} as never;

		const data = (await load(event)) as Loaded;

		expect(calls.filter((u) => u.endsWith('/stats'))).toHaveLength(9);
		expect(loadedRows(data).map((s: { name: string }) => s.name)).toEqual(['collection_7', 'collection_8', 'collection_6']);
		expect(data.sort).toBe('rows');
		expect(data.dir).toBe('desc');
	});

	it('puts a count that could not be read after every count that could', async () => {
		const fetch = vi.fn(async (input: string | URL | Request) => {
			const url = String(input);
			if (url.endsWith('/stats')) {
				const n = Number(/collection_(\d+)\/stats/.exec(url)?.[1]);
				if (n === 1) return json({ error: 'no' }, 503);
				return json({ rows: n, table: '_x' });
			}
			return json(schemas(4));
		}) as unknown as typeof globalThis.fetch;
		const event = {
			fetch: signedIn(fetch, { roles: ['super_admin'] }),
			cookies: mockCookies(),
			url: new URL('http://localhost/admin/content?sort=rows&dir=asc'),
		} as never;

		const data = (await load(event)) as Loaded;

		expect(loadedRows(data).map((s: { name: string }) => s.name)).toEqual([
			'collection_0',
			'collection_2',
			'collection_3',
			'collection_1',
		]);
	});

	it('sorts by fields without counting rows for the set', async () => {
		const calls: string[] = [];
		const fetch = vi.fn(async (input: string | URL | Request) => {
			const url = String(input);
			calls.push(url);
			if (url.endsWith('/stats')) return json({ rows: 1, table: '_x' });
			return json(
				schemas(5).map((s, i) => ({
					...s,
					fields: Array.from({ length: i === 2 ? 6 : i }, (_, k) => ({ name: `f${k}` })),
				})),
			);
		}) as unknown as typeof globalThis.fetch;
		const event = {
			fetch: signedIn(fetch, { roles: ['super_admin'] }),
			cookies: mockCookies(),
			url: new URL('http://localhost/admin/content?limit=2&sort=fields'),
		} as never;

		const data = (await load(event)) as Loaded;

		expect(loadedRows(data).map((s: { name: string }) => s.name)).toEqual(['collection_2', 'collection_4']);
		expect(calls.filter((u) => u.endsWith('/stats'))).toHaveLength(2);
	});

	it('falls back to name order for a sort it does not know', async () => {
		const data = (await load(loadEvent(schemas(3), '?sort=owner&dir=sideways'))) as Loaded;

		expect(data.sort).toBe('name');
		expect(data.dir).toBe('asc');
	});

	/*
	 * The engine answers last_updated per collection. Sorting by it reads the
	 * whole matching set like the rows sort does, newest first, and a table
	 * with no timestamp (empty, or an engine that does not send it) sorts
	 * after every dated one rather than as the oldest.
	 */
	it('sorts by last change across the set, undated last', async () => {
		const dates: Record<number, string | null | undefined> = {
			0: '2026-09-01T00:00:00Z',
			1: null,
			2: '2026-09-13T00:00:00Z',
			3: undefined,
			4: '2026-09-07T00:00:00Z',
		};
		const calls: string[] = [];
		const fetch = vi.fn(async (input: string | URL | Request) => {
			const url = String(input);
			calls.push(url);
			if (url.endsWith('/stats')) {
				const n = Number(/collection_(\d+)\/stats/.exec(url)?.[1]);
				const body: Record<string, unknown> = { rows: 1, table: '_x' };
				if (dates[n] !== undefined) body.last_updated = dates[n];
				return json(body);
			}
			return json(schemas(5));
		}) as unknown as typeof globalThis.fetch;
		const event = {
			fetch: signedIn(fetch, { roles: ['super_admin'] }),
			cookies: mockCookies(),
			url: new URL('http://localhost/admin/content?limit=3&sort=updated'),
		} as never;

		const data = (await load(event)) as Loaded;

		expect(calls.filter((u) => u.endsWith('/stats'))).toHaveLength(5);
		expect(loadedRows(data).map((s: { name: string }) => s.name)).toEqual([
			'collection_2',
			'collection_4',
			'collection_0',
		]);
		expect(data.stats.collection_1.last_updated).toBeNull();
		expect(data.stats.collection_3.last_updated).toBeUndefined();
	});

	/*
	 * A chip narrows the searched set before the page is cut, so the pager
	 * counts what the chip shows. The option chips read only the schema list.
	 * The rows chips cost a stats read per collection in the set.
	 */
	it('narrows to the collections made with an option, without counting rows', async () => {
		const calls: string[] = [];
		const fetch = vi.fn(async (input: string | URL | Request) => {
			const url = String(input);
			calls.push(url);
			if (url.endsWith('/stats')) return json({ rows: 1, table: '_x' });
			return json(
				schemas(6).map((s, i) => ({
					...s,
					with_draft_publish: i % 2 === 0,
					with_localization: i === 1,
				}))
			);
		}) as unknown as typeof globalThis.fetch;
		const event = {
			fetch: signedIn(fetch, { roles: ['super_admin'] }),
			cookies: mockCookies(),
			url: new URL('http://localhost/admin/content?filter=draft-publish&limit=2'),
		} as never;

		const data = (await load(event)) as Loaded;

		expect(data.filter).toBe('draft-publish');
		expect(loadedRows(data).map((s: { name: string }) => s.name)).toEqual(['collection_0', 'collection_2']);
		expect(data.total).toBe(3);
		expect(data.hasMore).toBe(true);
		expect(calls.filter((u) => u.endsWith('/stats'))).toHaveLength(2);
	});

	it('narrows to the empty collections by counting the whole searched set', async () => {
		const calls: string[] = [];
		const fetch = vi.fn(async (input: string | URL | Request) => {
			const url = String(input);
			calls.push(url);
			if (url.endsWith('/stats')) {
				const n = Number(/collection_(\d+)\/stats/.exec(url)?.[1]);
				if (n === 3) return json({ error: 'no' }, 503);
				return json({ rows: n % 2, table: '_x' });
			}
			return json(schemas(5));
		}) as unknown as typeof globalThis.fetch;
		const event = {
			fetch: signedIn(fetch, { roles: ['super_admin'] }),
			cookies: mockCookies(),
			url: new URL('http://localhost/admin/content?filter=empty'),
		} as never;

		const data = (await load(event)) as Loaded;

		expect(calls.filter((u) => u.endsWith('/stats'))).toHaveLength(5);
		expect(loadedRows(data).map((s: { name: string }) => s.name)).toEqual(['collection_0', 'collection_2', 'collection_4']);
		expect(data.total).toBe(3);
	});

	it('falls back to the whole set for a filter it does not know', async () => {
		const data = (await load(loadEvent(schemas(3), '?filter=famous'))) as Loaded;

		expect(data.filter).toBe('all');
		expect(loadedRows(data)).toHaveLength(3);
	});

	// Every content route refuses a reader below admin, so the index refuses too
	// instead of listing collections whose New entry buttons all end in a refusal.
	it.each(['editor', 'viewer'])('refuses the %s role without reading', async (role) => {
		const fetch = vi.fn(async () => json(schemas(3))) as unknown as typeof globalThis.fetch;
		const event = {
			fetch: signedIn(fetch, { roles: [role] }),
			cookies: mockCookies(),
			url: new URL('http://localhost/admin/content'),
		} as never;

		const thrown = await Promise.resolve(load(event)).catch((err: unknown) => err);

		expect(thrown).toMatchObject({ status: 403, body: { message: 'Only an admin or a super admin can open this page.' } });
		expect(fetch).not.toHaveBeenCalled();
	});
});
