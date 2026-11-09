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

import { actions, load } from './+page.server';

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function mockCookies(): Cookies {
	return { get: vi.fn((name: string) => (name === '__Host-csrf' ? 'csrf' : 'tok')) } as unknown as Cookies;
}

type Read = { ok: true; value: unknown } | { ok: false; gate: { state: string } };
type Failure = { status: number; data: Record<string, unknown> };
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
	ranking: Read;
	canReindex: boolean;
}

async function runLoad(search: string, routes: Record<string, () => Response> = {}) {
	const { fetch, calls } = engine(routes);
	const event = {
		fetch,
		cookies: mockCookies(),
		url: new URL(`http://localhost/admin/search/settings${search}`),
		parent: async () => ({ user: { roles: ['admin'] } }),
	} as never;
	return { result: (await load(event)) as unknown as Loaded, calls };
}

function actionEvent(fields: Record<string, string | string[]>, routes: Record<string, () => Response> = {}) {
	const { fetch, calls } = engine(routes);
	const fd = new FormData();
	for (const [k, v] of Object.entries(fields)) for (const one of [v].flat()) fd.append(k, one);
	const event = { fetch, cookies: mockCookies(), request: { formData: async () => fd } } as never;
	return { event, calls };
}

beforeEach(() => {
	authz.roles = ['admin'];
});

describe('the settings load', () => {
	it('keeps a failed ranking read as a gate, never as the default weights', async () => {
		const { result } = await runLoad('', { 'GET /api/admin/search/ranking': () => json({ error: 'down' }, 503) });

		expect(result.ranking).toMatchObject({ ok: false, gate: { state: 'unavailable' } });
	});

	// Only a super admin may rebuild the index, so only one is offered it.
	it('offers the index to a super admin only', async () => {
		const me = (roles: string[]) => ({ 'GET /api/admin/auth/me': () => json({ id: 'u1', roles }) });

		expect((await runLoad('', me(['admin']))).result.canReindex).toBe(false);
		expect((await runLoad('', me(['super_admin']))).result.canReindex).toBe(true);
	});
});

describe('saving the default weights', () => {
	const weights = { title_weight: '3', body_weight: '1', tag_weight: '0.5' };

	// The plugin replaces the whole row, so weights sent alone erase the rules.
	it('sends back the boost rules it read beside the weights', async () => {
		const { event, calls } = actionEvent(weights);

		expect(await actions.ranking(event)).toEqual({ rankingSaved: true });
		const put = calls.find((c) => c.method === 'PUT');
		expect(put?.body).toEqual({
			schema_name: '*',
			title_weight: 3,
			body_weight: 1,
			tag_weight: 0.5,
			boost_rules: RANKING.boost_rules,
		});
	});

	it('writes nothing when the rules could not be read', async () => {
		const { event, calls } = actionEvent(weights, { 'GET /api/admin/search/ranking': () => json({ error: 'down' }, 503) });

		const out = (await actions.ranking(event)) as Failure;
		expect(out.data.rankingError).toBe('Could not save the weights. Try again.');
		expect(calls.some((c) => c.method === 'PUT')).toBe(false);
	});

	it('relays the reason the plugin refused', async () => {
		const { event } = actionEvent(weights, { 'PUT /api/admin/search/ranking': () => json({ error: 'schema_name is required', code: 'bad_request' }, 400) });

		expect(((await actions.ranking(event)) as Failure).data.rankingError).toBe('schema_name is required');
	});

	it('refuses a weight outside 0 to 10 before it reaches the plugin', async () => {
		const { event, calls } = actionEvent({ ...weights, tag_weight: '11' });

		expect(((await actions.ranking(event)) as Failure).status).toBe(400);
		expect(calls).toEqual([]);
	});
});

describe('the public schemas', () => {
	it('saves the picked schemas', async () => {
		const { event, calls } = actionEvent({ schemas: ['posts', 'pages'] }, {
			'PUT /api/admin/search/public-schemas': () => json({ schemas: ['posts', 'pages'] }),
		});

		expect(await actions.publicSchemas(event)).toEqual({ publicSaved: 2 });
		expect(calls[0].body).toEqual({ schemas: ['posts', 'pages'] });
	});

	it('relays the reason the plugin refused', async () => {
		const { event } = actionEvent({ schemas: 'nope' }, {
			'PUT /api/admin/search/public-schemas': () => json({ error: 'unknown schema nope', code: 'bad_request' }, 400),
		});

		expect(((await actions.publicSchemas(event)) as Failure).data.publicError).toBe('unknown schema nope');
	});

	it('keeps outage detail out of the message', async () => {
		const { event } = actionEvent({ schemas: 'posts' }, {
			'PUT /api/admin/search/public-schemas': () => json({ error: 'pq: connection refused' }, 503),
		});

		expect(((await actions.publicSchemas(event)) as Failure).data.publicError).toBe('Could not save the public content types. Try again.');
	});
});

describe('rebuilding the index', () => {
	it('reports how many entries were indexed', async () => {
		authz.roles = ['super_admin'];
		const { event } = actionEvent({}, { 'POST /api/admin/search/reindex': () => json({ indexed: 12, message: 'Indexed 12 entries.' }) });

		expect(await actions.reindex(event)).toEqual({ reindexed: 12, reindexMessage: 'Indexed 12 entries.' });
	});

	it('relays the reason the plugin refused', async () => {
		authz.roles = ['super_admin'];
		const { event } = actionEvent({}, { 'POST /api/admin/search/reindex': () => json({ error: 'a reindex is already running', code: 'conflict' }, 409) });

		expect(((await actions.reindex(event)) as Failure).data.reindexError).toBe('a reindex is already running');
	});

	it('keeps outage detail out of the message', async () => {
		authz.roles = ['super_admin'];
		const { event } = actionEvent({}, { 'POST /api/admin/search/reindex': () => json({ error: 'pq: down' }, 503) });

		expect(((await actions.reindex(event)) as Failure).data.reindexError).toBe('Could not rebuild the index. Try again.');
	});

	it('refuses an admin before it reaches the plugin', async () => {
		const { event, calls } = actionEvent({});

		await expect(actions.reindex(event)).rejects.toMatchObject({ status: 403 });
		expect(calls).toEqual([]);
	});
});

describe('the role check', () => {
	const cases = [
		['publicSchemas', { schemas: 'posts' }],
		['ranking', { title_weight: '1', body_weight: '1', tag_weight: '1' }],
	] as const;

	it.each(cases)('refuses %s to an editor before it reaches the plugin', async (name, fields) => {
		authz.roles = ['editor'];
		const { event, calls } = actionEvent(fields);

		await expect(actions[name](event)).rejects.toMatchObject({ status: 403 });
		expect(calls).toEqual([]);
	});
});
