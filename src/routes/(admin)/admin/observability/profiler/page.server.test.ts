import { describe, expect, it, vi } from 'vitest';
import type { Cookies } from '@sveltejs/kit';
import { actions, load } from './+page.server';

type Loaded = Exclude<Awaited<ReturnType<typeof load>>, void>;

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function mockCookies(): Cookies {
	return { get: vi.fn(() => 'tok'), set: vi.fn(), delete: vi.fn(), getAll: vi.fn(() => []), serialize: vi.fn(() => '') } as unknown as Cookies;
}

type Route = (url: string, init?: RequestInit) => Response;

function fetchFor(routes: Record<string, Route>, roles: string[]) {
	const calls: { url: string; init?: RequestInit }[] = [];
	const fetch = vi.fn(async (url: string, init?: RequestInit) => {
		const asked = String(url);
		calls.push({ url: asked, init });
		if (asked.includes('/auth/me')) return json({ id: 'u1', roles, disabled: false });
		for (const [needle, route] of Object.entries(routes)) if (asked.includes(needle)) return route(asked, init);
		return json({ error: 'no route' }, 404);
	}) as unknown as typeof globalThis.fetch;
	return { fetch, calls };
}

const STATS = {
	endpoint: '/api/v1/content',
	method: 'GET',
	count: 4,
	avg_duration_ns: 1_500_000,
	p50_duration_ns: 1_000_000,
	p95_duration_ns: 2_000_000,
	p99_duration_ns: 3_000_000,
	max_duration_ns: 4_000_000,
	avg_alloc_bytes: 2048,
	total_alloc_bytes: 8192,
	last_seen: '2026-09-21T10:00:00Z',
};

const DETAIL = { endpoint: '/api/v1/content', methods: [{ method: 'GET', count: 4, stats: STATS, recent_entries: [] }], total_count: 4, limit: 100, offset: 0 };

const views: Record<string, Route> = {
	'/debug/profiler/endpoints': () => json({ endpoints: [STATS], count: 1 }),
	'/debug/profiler/slowest': () => json({ slowest: [STATS] }),
	'/debug/profiler/plugins': () => json({ plugins: [{ plugin: 'core', count: 4, avg_duration_ns: 1, max_duration_ns: 2, total_alloc_bytes: 3 }] }),
	'/debug/profiler/endpoint/api/v1/content': () => json(DETAIL),
};

function loadEvent(routes: Record<string, Route>, roles: string[], search = '') {
	const { fetch, calls } = fetchFor(routes, roles);
	return {
		event: {
			fetch,
			cookies: mockCookies(),
			url: new URL(`http://localhost/admin/observability/profiler${search}`),
			parent: async () => ({ user: { id: 'u1', roles }, entitlements: { plan: '', state: '', features: [], tenant_quota: 1 } }),
		} as never,
		calls,
	};
}

function actionEvent(fields: Record<string, string>, routes: Record<string, Route>, roles: string[]) {
	const { fetch, calls } = fetchFor(routes, roles);
	const body = new FormData();
	body.set('confirmed', 'yes');
	for (const [k, v] of Object.entries(fields)) body.set(k, v);
	return {
		event: { fetch, cookies: mockCookies(), request: new Request('http://localhost/admin/observability/profiler', { method: 'POST', body }) } as never,
		calls,
	};
}

describe('profiler load', () => {
	// The views live under /api/admin/debug/profiler.
	it('reads the three timing views under /api/admin/debug/profiler for a super admin', async () => {
		const { event, calls } = loadEvent(views, ['super_admin']);
		const result = (await load(event)) as Loaded;
		expect(result.endpoints).toEqual({ ok: true, value: [STATS] });
		expect(result.slowest).toEqual({ ok: true, value: [STATS] });
		expect(result.plugins.ok && result.plugins.value[0].plugin).toBe('core');
		expect(result).not.toHaveProperty('memory');
		expect(result.selected).toBeNull();
		expect(result.detail).toBeNull();
		const asked = calls.map((c) => c.url).filter((u) => u.includes('/debug/profiler'));
		expect(asked).toHaveLength(3);
		expect(asked.every((u) => u.includes('/api/admin/debug/profiler/'))).toBe(true);
	});

	it('reads the selected endpoint from the URL as the path the engine sampled', async () => {
		const { event, calls } = loadEvent(views, ['super_admin'], '?endpoint=api%2Fv1%2Fcontent');
		const result = (await load(event)) as Loaded;
		expect(result.selected).toBe('/api/v1/content');
		expect(result.detail).toEqual({ ok: true, value: DETAIL });
		expect(calls.some((c) => c.url.includes('/debug/profiler/endpoint/api/v1/content?limit=100'))).toBe(true);
	});

	it('keeps the reason a view did not answer rather than drawing zeros', async () => {
		const { event } = loadEvent({ ...views, '/debug/profiler/plugins': () => json({ error: 'down' }, 503) }, ['super_admin'], '?endpoint=nothing');
		const result = (await load(event)) as Loaded;
		expect(result.plugins).toEqual({ ok: false, gate: { state: 'unavailable' } });
		expect(result.slowest).toEqual({ ok: true, value: [STATS] });
		expect(result.selected).toBe('/nothing');
		expect(result.detail).toEqual({ ok: true, value: null });
	});

	// The plugin answers 404 for a path its ring holds no sample of. Read as
	// a missing route, the page said the profiler was not in this build.
	it('reads a 404 for the selected endpoint as no samples, not as a missing plugin', async () => {
		const { event } = loadEvent(
			{ ...views, '/debug/profiler/endpoint/': () => json({ error: 'no data for endpoint: /nothing' }, 404) },
			['super_admin'],
			'?endpoint=nothing',
		);
		const result = (await load(event)) as Loaded;
		expect(result.detail).toEqual({ ok: true, value: null });
	});

	it('keeps any other failure of the selected endpoint as a gate', async () => {
		const { event } = loadEvent(
			{ ...views, '/debug/profiler/endpoint/': () => json({ error: 'down' }, 503) },
			['super_admin'],
			'?endpoint=nothing',
		);
		const result = (await load(event)) as Loaded;
		expect(result.detail).toEqual({ ok: false, gate: { state: 'unavailable' } });
	});

	// The ring describes every tenant's traffic and the exports carry process
	// memory, so an admin who is not a super admin is refused before a read.
	it('refuses an admin who is not super admin before any read', async () => {
		const { event, calls } = loadEvent(views, ['admin']);
		await expect(load(event)).rejects.toMatchObject({ status: 403 });
		expect(calls.some((c) => c.url.includes('/debug/profiler'))).toBe(false);
	});
});

describe('the profiler actions', () => {
	it('reset posts to the engine and says so', async () => {
		const { event, calls } = actionEvent({}, { '/debug/profiler/reset': () => json({ status: 'reset' }) }, ['super_admin']);
		expect(await actions.reset(event)).toEqual({ form: 'reset', reset: true });
		const post = calls.find((c) => c.url.includes('/debug/profiler/reset'));
		expect(post?.init?.method).toBe('POST');
	});

	it('refuses an admin who is not super admin before the round trip', async () => {
		const { event, calls } = actionEvent({}, {}, ['admin']);
		await expect(actions.reset(event)).rejects.toMatchObject({ status: 403 });
		expect(calls.some((c) => c.init?.method === 'POST')).toBe(false);
	});
});
