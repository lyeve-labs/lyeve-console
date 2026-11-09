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
	synonyms: Read;
}

async function runLoad(search: string, routes: Record<string, () => Response> = {}) {
	const { fetch, calls } = engine(routes);
	const event = {
		fetch,
		cookies: mockCookies(),
		url: new URL(`http://localhost/admin/search/synonyms${search}`),
		parent: async () => ({ user: { roles: ['admin'] } }),
	} as never;
	return { result: (await load(event)) as unknown as Loaded, calls };
}

function actionEvent(fields: Record<string, string | string[]>, routes: Record<string, () => Response> = {}) {
	const { fetch, calls } = engine(routes);
	const fd = new FormData();
	fd.set('confirmed', 'yes');
	for (const [k, v] of Object.entries(fields)) for (const one of [v].flat()) fd.append(k, one);
	const event = { fetch, cookies: mockCookies(), request: { formData: async () => fd, clone: () => ({ formData: async () => fd }) } } as never;
	return { event, calls };
}

beforeEach(() => {
	authz.roles = ['admin'];
});

describe('the synonyms load', () => {
	it('reads the synonym groups up to the page ceiling and keeps their total', async () => {
		const { result, calls } = await runLoad('', {
			'GET /api/admin/search/synonyms': () => json({ data: [{ id: 's1', base_term: 'tv', synonyms: ['telly'] }], total_count: 612 }),
		});

		const asked = new URL(calls.find((c) => c.path.startsWith('/api/admin/search/synonyms'))!.path, 'http://x');
		expect(asked.searchParams.get('limit')).toBe('500');
		expect(result.synonyms).toMatchObject({ ok: true, value: { total: 612 } });
	});

	it('keeps a failed synonym read as a gate, never as no groups', async () => {
		const { result } = await runLoad('', { 'GET /api/admin/search/synonyms': () => json({ error: 'internal' }, 500) });

		expect(result.synonyms).toMatchObject({ ok: false, gate: { state: 'error' } });
	});
});

describe('the synonym groups', () => {
	it('creates a group named after its term', async () => {
		const { event, calls } = actionEvent({ base_term: 'tv', synonyms: 'telly, television' });

		expect(await actions.createSynonym(event)).toEqual({ synonymSaved: true });
		expect(calls[0]).toMatchObject({ method: 'POST', body: { name: 'tv', base_term: 'tv', synonyms: ['telly', 'television'] } });
	});

	it('relays the reason the plugin refused a group', async () => {
		const { event } = actionEvent({ base_term: 'tv', synonyms: 'telly' }, {
			'POST /api/admin/search/synonyms': () => json({ error: 'synonym group already exists', code: 'conflict' }, 409),
		});

		expect(((await actions.createSynonym(event)) as Failure).data.synonymError).toBe('synonym group already exists');
	});

	it('keeps outage detail out of a failed create', async () => {
		const { event } = actionEvent({ base_term: 'tv', synonyms: 'telly' }, {
			'POST /api/admin/search/synonyms': () => json({ error: 'pq: down' }, 503),
		});

		expect(((await actions.createSynonym(event)) as Failure).data.synonymError).toBe('Could not save the synonym. Try again.');
	});

	it('deletes the named group', async () => {
		const { event, calls } = actionEvent({ id: 's 1' });

		expect(await actions.deleteSynonym(event)).toEqual({ synonymDeleted: true });
		expect(calls[0]).toMatchObject({ method: 'DELETE', path: '/api/admin/search/synonyms/s%201' });
	});

	// The New synonym drawer shows create failures. A delete failure under the
	// same key opened the next drawer with it, as if the create had failed.
	it('returns a failed delete under its own key', async () => {
		const { event } = actionEvent({ id: 's1' }, { 'DELETE /api/admin/search/synonyms': () => json({ error: 'not found', code: 'not_found' }, 404) });

		const out = (await actions.deleteSynonym(event)) as Failure;
		expect(out.data).toEqual({ synonymDeleteError: 'not found' });
	});

	it('keeps outage detail out of a failed delete', async () => {
		const { event } = actionEvent({ id: 's1' }, { 'DELETE /api/admin/search/synonyms': () => json({ error: 'pq: down' }, 503) });

		expect(((await actions.deleteSynonym(event)) as Failure).data).toEqual({ synonymDeleteError: 'Could not delete the synonym. Try again.' });
	});
});

describe('the role check', () => {
	const cases = [
		['createSynonym', { base_term: 'tv', synonyms: 'telly' }],
		['deleteSynonym', { id: 's1' }],
	] as const;

	it.each(cases)('refuses %s to an editor before it reaches the plugin', async (name, fields) => {
		authz.roles = ['editor'];
		const { event, calls } = actionEvent(fields);

		await expect(actions[name](event)).rejects.toMatchObject({ status: 403 });
		expect(calls).toEqual([]);
	});
});
