import { describe, expect, it, vi } from 'vitest';
import type { Cookies } from '@sveltejs/kit';
import { actions, load } from './+page.server';

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

function loadEvent(roles: string[]) {
	const { fetch, calls } = fetchFor({}, roles);
	return {
		event: { fetch, cookies: mockCookies(), url: new URL('http://localhost/admin/observability/profiler/capture') } as never,
		calls,
	};
}

function actionEvent(fields: Record<string, string>, routes: Record<string, Route>, roles: string[]) {
	const { fetch, calls } = fetchFor(routes, roles);
	const body = new FormData();
	for (const [k, v] of Object.entries(fields)) body.set(k, v);
	return {
		event: { fetch, cookies: mockCookies(), request: new Request('http://localhost/admin/observability/profiler/capture', { method: 'POST', body }) } as never,
		calls,
	};
}

describe('profiler capture load', () => {
	// A capture blocks for its window, so the tab reads nothing until asked.
	it('reads nothing from the profiler for a super admin', async () => {
		const { event, calls } = loadEvent(['super_admin']);
		expect(await load(event)).toEqual({});
		expect(calls.some((c) => c.url.includes('/debug/profiler'))).toBe(false);
	});

	it('refuses an admin who is not super admin', async () => {
		const { event } = loadEvent(['admin']);
		await expect(load(event)).rejects.toMatchObject({ status: 403 });
	});
});

describe('the flamegraph action', () => {
	it('captures a flamegraph for the named endpoint over a clamped window', async () => {
		const { event, calls } = actionEvent(
			{ endpoint: '/api/v1/content', duration_sec: '99' },
			{ '/debug/profiler/flamegraph/': (url) => json({ endpoint: '/api/v1/content', duration_sec: Number(new URL(url, 'http://x').searchParams.get('duration_sec')), svg: '<svg/>', profile_type: 'cpu', captured_at: 'now' }) },
			['super_admin'],
		);
		const result = await actions.flamegraph(event);
		expect(result).toMatchObject({ form: 'flamegraph', graph: { svg: '<svg/>', duration_sec: 25 } });
		const post = calls.find((c) => c.url.includes('/debug/profiler/flamegraph/'));
		expect(post?.url).toContain('/api/admin/debug/profiler/flamegraph/api/v1/content?duration_sec=25');
		expect(post?.init?.method).toBe('POST');
	});

	it('refuses a flamegraph with no endpoint before the round trip', async () => {
		const { event, calls } = actionEvent({ endpoint: '', duration_sec: '5' }, {}, ['super_admin']);
		const result = await actions.flamegraph(event);
		expect(result).toMatchObject({ status: 422, data: { form: 'flamegraph' } });
		expect(calls.some((c) => c.init?.method === 'POST')).toBe(false);
	});

	it('refuses an admin who is not super admin before the round trip', async () => {
		const { event, calls } = actionEvent({ endpoint: '/api/v1/content', duration_sec: '5' }, {}, ['admin']);
		await expect(actions.flamegraph(event)).rejects.toMatchObject({ status: 403 });
		expect(calls.some((c) => c.init?.method === 'POST')).toBe(false);
	});
});
