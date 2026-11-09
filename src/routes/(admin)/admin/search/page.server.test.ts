import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Cookies } from '@sveltejs/kit';

// The session client is real and runs over the event's fetch, so every read
// and write lands in one call log with the body it would send.
const authz = vi.hoisted(() => ({ roles: ['admin'] as string[] }));
vi.mock('$lib/server/authz', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/authz')>()),
	requireRole: vi.fn(async (_event: unknown, allowed: string[]) => {
		if (!allowed.some((r) => authz.roles.includes(r))) throw Object.assign(new Error('403'), { status: 403 });
		return { id: 'u1', roles: authz.roles };
	}),
}));

import { load } from './+page.server';

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function mockCookies(): Cookies {
	return { get: vi.fn((name: string) => (name === '__Host-csrf' ? 'csrf' : 'tok')) } as unknown as Cookies;
}

type Read = { ok: true; value: unknown } | { ok: false; gate: { state: string } };
interface Call {
	method: string;
	path: string;
	body: unknown;
}

const RANKING = {
	schema_name: '*',
	title_weight: 2,
	body_weight: 1,
	tag_weight: 1,
	boost_rules: [{ field: 'status', value: 'featured', boost: 3 }],
};

/**
 * A fetch answering each route from `routes`, by the first key the path
 * starts with after the method. Anything unrouted answers an empty success.
 */
function engine(routes: Record<string, () => Response> = {}) {
	const calls: Call[] = [];
	const fetch = vi.fn(async (path: string, init?: RequestInit) => {
		const method = init?.method ?? 'GET';
		calls.push({ method, path, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
		for (const [key, answer] of Object.entries(routes)) {
			if (`${method} ${path}`.startsWith(key)) return answer();
		}
		if (path.startsWith('/api/admin/search/ranking')) return json(RANKING);
		if (path.startsWith('/api/admin/search/synonyms')) return json({ data: [], total_count: 0 });
		if (path.startsWith('/api/admin/search/public-schemas')) return json({ schemas: [] });
		if (path.startsWith('/api/admin/schemas')) return json([]);
		return json({});
	}) as unknown as typeof globalThis.fetch;
	return { fetch, calls };
}

interface Loaded {
	limit: number;
	results: Read | null;
	analytics: Read;
}

async function runLoad(search: string, routes: Record<string, () => Response> = {}) {
	const { fetch, calls } = engine(routes);
	const event = {
		fetch,
		cookies: mockCookies(),
		url: new URL(`http://localhost/admin/search${search}`),
		parent: async () => ({ user: { roles: ['admin'] } }),
	} as never;
	return { result: (await load(event)) as unknown as Loaded, calls };
}

beforeEach(() => {
	authz.roles = ['admin'];
});

describe('the search load', () => {
	it('asks for one page of results and keeps the total the plugin counted', async () => {
		const { result, calls } = await runLoad('?q=cats', {
			'GET /api/admin/search?': () => json({ results: [{ entry_id: 'e1' }], total: 73 }),
		});

		const asked = new URL(calls.find((c) => c.path.startsWith('/api/admin/search?'))!.path, 'http://x');
		expect(asked.searchParams.get('limit')).toBe('20');
		expect(asked.searchParams.get('offset')).toBe('0');
		expect(result.results).toEqual({ ok: true, value: { results: [{ entry_id: 'e1' }], total: 73 } });
	});

	it('pages by the 200 results the search store returns at most, so no result is skipped', async () => {
		const page = Array.from({ length: 200 }, (_, i) => ({ entry_id: `e${i}` }));
		const { result, calls } = await runLoad('?q=cats&limit=300&offset=200', {
			'GET /api/admin/search?': () => json({ results: page, total: 650 }),
		});

		const asked = new URL(calls.find((c) => c.path.startsWith('/api/admin/search?'))!.path, 'http://x');
		expect(asked.searchParams.get('limit')).toBe('200');
		expect(asked.searchParams.get('offset')).toBe('200');
		expect(result.limit).toBe(200);
	});

	it('keeps a failed search as a gate instead of an empty result set', async () => {
		const { result } = await runLoad('?q=cats', { 'GET /api/admin/search?': () => json({ error: 'search failed' }, 500) });

		expect(result.results).toMatchObject({ ok: false, gate: { state: 'error' } });
	});

	it('skips the search call when the query is empty', async () => {
		const { result, calls } = await runLoad('');

		expect(calls.some((c) => c.path.startsWith('/api/admin/search?'))).toBe(false);
		expect(result.results).toBeNull();
	});

	it('treats a missing results array as no hits, not a failure', async () => {
		const { result } = await runLoad('?q=cats', { 'GET /api/admin/search?': () => json({}) });

		expect(result.results).toEqual({ ok: true, value: { results: [], total: 0 } });
	});

	it('sends a page past the end back to the last page that holds rows', async () => {
		await expect(
			runLoad('?q=cats&offset=200', { 'GET /api/admin/search?': () => json({ results: [], total: 30 }) }),
		).rejects.toMatchObject({ status: 307, location: '/admin/search?q=cats&offset=20' });
	});

	// The analytics card sits beside the results, so its read runs with every
	// query and a failure is drawn as its gate.
	it('keeps a failed analytics read as a gate', async () => {
		const { result } = await runLoad('', { 'GET /api/admin/search/analytics': () => json({ error: 'down' }, 503) });

		expect(result.analytics).toMatchObject({ ok: false, gate: { state: 'unavailable' } });
	});
});
