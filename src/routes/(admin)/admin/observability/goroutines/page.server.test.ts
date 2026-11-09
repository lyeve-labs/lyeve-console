import { describe, expect, it, vi } from 'vitest';
import type { Cookies } from '@sveltejs/kit';
import { actions, load } from './+page.server';
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

// The tuning answer replaces the default one. The more specific needle has
// to come before the snapshot's, which matches every goroutine route.
function withTuning(tuning: Route): Record<string, Route> {
	const { '/debug/goroutines': snapshot, ...rest } = views;
	return { ...rest, '/debug/goroutines/tuning': tuning, '/debug/goroutines': snapshot };
}

// The layout hands every page the entitlements. This one reads none of them,
// so an instance that serves no feature is the case to prove.
function loadEvent(routes: Record<string, Route>, roles = ['super_admin'], plugins: unknown = null) {
	const { fetch } = fetchFor(routes, roles);
	return {
		fetch,
		cookies: mockCookies(),
		url: new URL('http://localhost/admin/observability/goroutines'),
		parent: async () => ({ user: { id: 'u1', roles }, entitlements: NO_ENTITLEMENTS, plugins }),
	} as never;
}

function actionEvent(form: FormData, routes: Record<string, Route>, roles = ['super_admin']) {
	const { fetch, calls } = fetchFor(routes, roles);
	return {
		event: { fetch, cookies: mockCookies(), request: new Request('http://localhost/admin/observability/goroutines', { method: 'POST', body: form }) } as never,
		calls,
	};
}

function form(fields: Record<string, string>): FormData {
	const data = new FormData();
	for (const [k, v] of Object.entries(fields)) data.set(k, v);
	return data;
}

describe('goroutine engine load', () => {
	it('reads the four views and ranks the owners, and marks a super admin able to tune', async () => {
		const result = (await load(loadEvent(views))) as Loaded;
		expect(result.goroutineEngine.pool).toEqual(POOL);
		expect(result.goroutineEngine.parallel).toEqual(PARALLEL);
		expect(result.goroutineEngine.asyncHooks).toEqual(ASYNC);
		expect(result.goroutineEngine.byOwner.map((r: { owner: string }) => r.owner)).toEqual(['cron', 'engine']);
		expect(result.goroutineEngine.superAdmin).toBe(true);
		expect(result.goroutineEngine.licensed).toBe(true);
		expect(result.goroutineEngine).not.toHaveProperty('entitled');
	});

	it('carries the plugin saying tuning is not licensed, and keeps every view', async () => {
		const result = (await load(loadEvent(withTuning(() => json({ licensed: false }))))) as Loaded;
		expect(result.goroutineEngine.licensed).toBe(false);
		expect(result.goroutineEngine.superAdmin).toBe(true);
		expect(result.goroutineEngine.pool).toEqual(POOL);
		expect(result.goroutineEngine.asyncHooks).toEqual(ASYNC);
	});

	// An older plugin has no tuning route and a failed read proves nothing,
	// so both keep the forms and leave a refusal to the write's own 402.
	it('reads a failed or missing tuning answer as licensed', async () => {
		for (const tuning of [() => json({ error: 'unavailable' }, 503), () => json({ error: 'not found' }, 404)]) {
			const result = (await load(loadEvent(withTuning(tuning)))) as Loaded;
			expect(result.goroutineEngine.licensed).toBe(true);
			expect(result.goroutineEngine.pool).toEqual(POOL);
		}
	});

	it('reads the views for an admin and says only the role locks the forms', async () => {
		const result = (await load(loadEvent(views, ['admin']))) as Loaded;
		expect(result.goroutineEngine.pool).toEqual(POOL);
		expect(result.goroutineEngine.superAdmin).toBe(false);
		expect(result.goroutineEngine).not.toHaveProperty('entitled');
	});

	it('reports a view the engine did not answer as absent, not as zeros', async () => {
		const result = (await load(loadEvent({ ...views, '/debug/goroutines/pool': () => json({ error: 'down' }, 503) }))) as Loaded;
		expect(result.goroutineEngine.pool).toBeNull();
		expect(result.goroutineEngine.parallel).toEqual(PARALLEL);
	});

	it('refuses a role below admin before any read', async () => {
		await expect(load(loadEvent(views, ['editor']))).rejects.toMatchObject({
			status: 403,
			body: { message: 'Only an admin or a super admin can open this page.' },
		});
	});
});

describe('the tunable actions', () => {
	it('puts the pool size and answers with the view', async () => {
		const { event, calls } = actionEvent(form({ size: '128' }), {
			'/debug/goroutines/pool': (_, init) => json({ ...POOL, size: JSON.parse(String(init?.body)).size }),
		});
		const result = await actions.pool(event);
		expect(result).toMatchObject({ form: 'pool', saved: true, view: { size: 128 } });
		const put = calls.find((c) => c.url.includes('/debug/goroutines/pool'));
		expect(put?.init?.method).toBe('PUT');
		expect(JSON.parse(String(put?.init?.body))).toEqual({ size: 128 });
	});

	// A refusal that is not the bounds message is reported on the form that
	// asked, with the fallback sentence.
	it('answers a refusal on the form that asked, with the fallback sentence', async () => {
		const { event } = actionEvent(form({ max_concurrent: '16', timeout: '1m' }), {
			'/debug/goroutines/parallel': () => json({ error: 'unavailable' }, 503),
		});
		const result = await actions.parallel(event);
		expect(result).toMatchObject({ status: 400, data: { form: 'parallel' } });
		const data = (result as { data: { error: string } }).data;
		expect(data.error).toBe('Could not save the parallel engine settings. Try again.');
	});

	it('returns a 402 as the license refusal, not as a generic error', async () => {
		const { event } = actionEvent(form({ size: '128' }), {
			'/debug/goroutines/pool': () =>
				json({ error: 'payment_required', plugin: 'example', feature: 'feature:example_feature' }, 402),
		});
		const result = (await actions.pool(event)) as {
			status: number;
			data: { form: string; refused: { kind: string; feature: string }; error?: string };
		};
		expect(result.status).toBe(402);
		expect(result.data.form).toBe('pool');
		expect(result.data.refused).toMatchObject({ kind: 'feature', feature: 'example-feature' });
		expect(result.data.error).toBeUndefined();
	});

	it('relays the plugin bounds message on a 422', async () => {
		const { event } = actionEvent(form({ workers: '8', queue_size: '64', timeout: '5s', enabled: 'on' }), {
			'/debug/goroutines/async-hooks': () => json({ error: 'workers must be between 1 and 1024', code: 'http_422' }, 422),
		});
		const result = await actions.asyncHooks(event);
		expect(result).toMatchObject({ status: 422, data: { form: 'asyncHooks', error: 'workers must be between 1 and 1024' } });
	});

	it('refuses an out-of-bounds value before the round trip', async () => {
		const { event, calls } = actionEvent(form({ size: '9000' }), {});
		const result = await actions.pool(event);
		expect(result).toMatchObject({ status: 422, data: { form: 'pool', error: 'Enter a value from 1 to 4096 for pool size.' } });
		expect(calls.some((c) => c.init?.method === 'PUT')).toBe(false);
	});

	it('refuses an admin who is not super admin before the round trip', async () => {
		const { event, calls } = actionEvent(form({ size: '10' }), {}, ['admin']);
		await expect(actions.pool(event)).rejects.toMatchObject({ status: 403 });
		expect(calls.some((c) => c.init?.method === 'PUT')).toBe(false);
	});
});
