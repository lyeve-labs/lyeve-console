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

const MEMORY = {
	snapshots: [{ timestamp: '2026-09-21T10:00:00Z', heap_alloc: 1024, heap_objects: 10, total_alloc: 4096, num_gc: 2, num_goroutine: 30 }],
	slope_bytes_per_sec: 0,
	leak_likely: false,
};

const views: Record<string, Route> = {
	'/debug/profiler/memory': () => json(MEMORY),
};

function loadEvent(routes: Record<string, Route>, roles: string[]) {
	const { fetch, calls } = fetchFor(routes, roles);
	return {
		event: { fetch, cookies: mockCookies(), url: new URL('http://localhost/admin/observability/profiler/memory') } as never,
		calls,
	};
}

function actionEvent(routes: Record<string, Route>, roles: string[]) {
	const { fetch, calls } = fetchFor(routes, roles);
	const body = new FormData();
	body.set('confirmed', 'yes');
	return {
		event: { fetch, cookies: mockCookies(), request: new Request('http://localhost/admin/observability/profiler/memory', { method: 'POST', body }) } as never,
		calls,
	};
}

describe('profiler memory load', () => {
	it('reads the memory trend under /api/admin/debug/profiler for a super admin', async () => {
		const { event, calls } = loadEvent(views, ['super_admin']);
		const result = (await load(event)) as Loaded;
		expect(result.memory).toEqual({ ok: true, value: MEMORY });
		const asked = calls.map((c) => c.url).filter((u) => u.includes('/debug/profiler'));
		expect(asked).toEqual([expect.stringContaining('/api/admin/debug/profiler/memory')]);
	});

	it('keeps the reason the trend did not answer rather than drawing zeros', async () => {
		const { event } = loadEvent({ '/debug/profiler/memory': () => json({ error: 'down' }, 503) }, ['super_admin']);
		const result = (await load(event)) as Loaded;
		expect(result.memory).toEqual({ ok: false, gate: { state: 'unavailable' } });
	});

	it('refuses an admin who is not super admin before any read', async () => {
		const { event, calls } = loadEvent(views, ['admin']);
		await expect(load(event)).rejects.toMatchObject({ status: 403 });
		expect(calls.some((c) => c.url.includes('/debug/profiler'))).toBe(false);
	});
});

// One reset clears the samples and the snapshots alike, so this tab resets
// through the same call as the timings tab.
describe('the memory reset', () => {
	it('posts the reset to the engine and says so', async () => {
		const { event, calls } = actionEvent({ '/debug/profiler/reset': () => json({ status: 'reset' }) }, ['super_admin']);
		expect(await actions.reset(event)).toEqual({ form: 'reset', reset: true });
		expect(calls.find((c) => c.url.includes('/debug/profiler/reset'))?.init?.method).toBe('POST');
	});

	it('reports a failed reset on the reset form', async () => {
		const { event } = actionEvent({ '/debug/profiler/reset': () => json({ error: 'down' }, 503) }, ['super_admin']);
		expect(await actions.reset(event)).toMatchObject({ data: { form: 'reset' } });
	});
});
