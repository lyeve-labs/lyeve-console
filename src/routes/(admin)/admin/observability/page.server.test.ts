import { describe, expect, it, vi } from 'vitest';
import type { Cookies } from '@sveltejs/kit';
import { load } from './+page.server';
import { NO_ENTITLEMENTS } from '$lib/entitlements';

type Loaded = Exclude<Awaited<ReturnType<typeof load>>, void>;

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function mockCookies(): Cookies {
	return { get: vi.fn(() => 'tok'), set: vi.fn(), delete: vi.fn(), getAll: vi.fn(() => []), serialize: vi.fn(() => '') } as unknown as Cookies;
}

type Route = (url: string, init?: RequestInit) => Response;

function fetchFor(routes: Record<string, Route>, roles = ['super_admin']) {
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

const POOL = { size: 64, active: 0, waiting: 0, completed: 1, failed: 0, dropped: 0, avg_latency: '0s', task_timeout: '30s' };
const PARALLEL = { max_concurrent: 8, timeout: '30s' };
const ASYNC = { enabled: true, workers: 4, queue_size: 1024, timeout: '5s', queued: 0, running: 0, overflow: 0, dropped: 0 };
const SNAPSHOT = { total: 5, runtime_total: 40, by_owner: { engine: { total: 2, oldest: '1s' }, cron: { total: 3, oldest: '2m' } } };

const views: Record<string, Route> = {
	'/pool/health': () => json({ engine: 'postgres', healthy: true }),
	'/debug/latency': () => json({ slowest: [], total: 0 }),
	'/debug/goroutines/pool': () => json(POOL),
	'/debug/goroutines/parallel': () => json(PARALLEL),
	'/debug/goroutines/async-hooks': () => json(ASYNC),
	'/debug/goroutines/tuning': () => json({ licensed: true }),
	'/debug/goroutines': () => json(SNAPSHOT),
};

// The layout hands every page the entitlements. This one reads none of them,
// so an instance that serves no feature is the case to prove.
function loadEvent(routes: Record<string, Route>, roles = ['super_admin'], plugins: unknown = null) {
	const { fetch } = fetchFor(routes, roles);
	return {
		fetch,
		cookies: mockCookies(),
		url: new URL('http://localhost/admin/observability'),
		parent: async () => ({ user: { id: 'u1', roles }, entitlements: NO_ENTITLEMENTS, plugins }),
	} as never;
}

describe('observability load', () => {
	// The pool row reads the runtime's goroutine count from the goroutine
	// engine's snapshot. The engine's own panel is a tab of its own.
	it('reads the runtime goroutine count for the pool row', async () => {
		const result = (await load(loadEvent(views))) as Loaded;
		expect(result.goroutines).toBe(40);
		expect(result).not.toHaveProperty('goroutineEngine');
		expect(result).not.toHaveProperty('logTail');
	});

	it('refuses a role below admin before any read', async () => {
		await expect(load(loadEvent(views, ['editor']))).rejects.toMatchObject({
			status: 403,
			body: { message: 'Only an admin or a super admin can open this page.' },
		});
	});
});

describe('observability reads that fail', () => {
	it('keeps a failed latency read as a gate rather than an empty ranking', async () => {
		const result = (await load(loadEvent({ ...views, '/debug/latency': () => json({ error: 'down' }, 503) }))) as Loaded;
		expect(result.latency).toEqual({ ok: false, gate: { state: 'unavailable' } });
	});

	it('keeps a failed pool health read as a gate rather than an unhealthy pool', async () => {
		const result = (await load(loadEvent({ ...views, '/pool/health': () => json({ error: 'boom' }, 500) }))) as Loaded;
		expect(result.poolHealth.ok).toBe(false);
	});
});
