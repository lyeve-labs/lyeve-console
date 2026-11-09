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


const RUNTIME = {
	available: true,
	licensed: true,
	stored: true,
	revision: 4,
	settings: {},
	facts: {},
	replicas: { count: 1, known: false, attached: false, applied: 1 },
};
const RECOMMENDATIONS = { facts: {}, presets: {}, recommended: {}, warnings: [] };

describe('the runtime settings read', () => {
	function loadAt(search: string, routes: Record<string, Route>, roles = ['super_admin']) {
		const { fetch, calls } = fetchFor(routes, roles);
		const event = {
			fetch,
			cookies: mockCookies(),
			url: new URL(`http://localhost/admin/observability/goroutines${search}`),
			parent: async () => ({ user: { id: 'u1', roles }, entitlements: NO_ENTITLEMENTS, plugins: null }),
		} as never;
		return { event, calls };
	}

	it('reads the recommendations with the typed inputs when the settings say they are licensed', async () => {
		const { event, calls } = loadAt('?replicas=3&database_cores=8', {
			...views,
			'/runtime/settings': () => json(RUNTIME),
			'/runtime/recommendations': () => json(RECOMMENDATIONS),
		});
		const result = (await load(event)) as Loaded;
		expect(result.runtime.settings).toEqual({ ok: true, value: RUNTIME });
		expect(result.runtime.recommendations).toEqual({ ok: true, value: RECOMMENDATIONS });
		expect(result.runtime.inputs).toEqual({ replicas: 3, database_cores: 8 });
		expect(calls.find((c) => c.url.includes('/runtime/recommendations'))?.url).toContain('?replicas=3&database_cores=8');
	});

	it('does not ask for recommendations on an unlicensed or unavailable engine', async () => {
		for (const over of [{ licensed: false }, { available: false }]) {
			const { event, calls } = loadAt('', { ...views, '/runtime/settings': () => json({ ...RUNTIME, ...over }) });
			const result = (await load(event)) as Loaded;
			expect(result.runtime.recommendations).toBeNull();
			expect(calls.some((c) => c.url.includes('/runtime/recommendations'))).toBe(false);
		}
	});

	it('makes no runtime read for an admin who is not a super admin', async () => {
		const { event, calls } = loadAt('?replicas=3', {
			...views,
			'/runtime/settings': () => json(RUNTIME),
			'/runtime/recommendations': () => json(RECOMMENDATIONS),
		}, ['admin']);
		const result = (await load(event)) as Loaded;
		expect(result.runtime.settings).toEqual({ ok: false, gate: { state: 'forbidden' } });
		expect(result.runtime.recommendations).toBeNull();
		expect(result.runtime.superAdmin).toBe(false);
		expect(calls.some((c) => c.url.includes('/api/admin/runtime/'))).toBe(false);
		expect(result.goroutineEngine.pool).toEqual(POOL);
	});

	it('keeps a 403 from either runtime read as the forbidden gate', async () => {
		const settings = loadAt('', { ...views, '/runtime/settings': () => json({ error: 'forbidden' }, 403) });
		expect(((await load(settings.event)) as Loaded).runtime.settings).toEqual({ ok: false, gate: { state: 'forbidden' } });
		const recs = loadAt('', {
			...views,
			'/runtime/settings': () => json(RUNTIME),
			'/runtime/recommendations': () => json({ error: 'forbidden' }, 403),
		});
		expect(((await load(recs.event)) as Loaded).runtime.recommendations).toEqual({ ok: false, gate: { state: 'forbidden' } });
	});

	it('keeps a failed settings read as a gate and leaves the other panels', async () => {
		const { event } = loadAt('', { ...views, '/runtime/settings': () => json({ error: 'boom' }, 500) });
		const result = (await load(event)) as Loaded;
		expect(result.runtime.settings).toEqual({ ok: false, gate: { state: 'error', message: 'Could not load runtime settings.' } });
		expect(result.goroutineEngine.pool).toEqual(POOL);
	});
});

describe('the runtime action', () => {
	const put = (route: Route, fields: Record<string, string> = { revision: '4', gc_percent: '200' }, roles = ['super_admin']) =>
		actionEvent(form(fields), { '/runtime/settings': route }, roles);

	it('puts only the changed fields with the revision', async () => {
		const { event, calls } = put(() => json(RUNTIME));
		const result = await actions.runtime(event);
		expect(result).toEqual({ form: 'runtime', saved: true, stored: true, poolWarning: false });
		const sent = calls.find((c) => c.url.includes('/runtime/settings'));
		expect(sent?.init?.method).toBe('PUT');
		expect(JSON.parse(String(sent?.init?.body))).toEqual({ revision: 4, gc_percent: 200 });
	});

	it('says when the change was applied but not stored', async () => {
		const { event } = put(() => json({ ...RUNTIME, stored: false }));
		expect(await actions.runtime(event)).toEqual({ form: 'runtime', saved: true, stored: false, poolWarning: false });
	});

	it('carries only that the engine warned about the pool, never its words', async () => {
		const { event } = put(() => json({ ...RUNTIME, warning: 'pool takes 40 of 100 connections' }), { revision: '4', database_max_connections: '40' });
		const result = await actions.runtime(event);
		expect(result).toEqual({ form: 'runtime', saved: true, stored: true, poolWarning: true });
		expect(JSON.stringify(result)).not.toContain('pool takes');
	});

	it('returns a 402 as the license refusal', async () => {
		const { event } = put(() => json({ error: 'payment_required', plugin: 'example', feature: 'feature:example_feature' }, 402));
		const result = (await actions.runtime(event)) as { status: number; data: { form: string; refused: unknown; error?: string } };
		expect(result.status).toBe(402);
		expect(result.data.form).toBe('runtime');
		expect(result.data.refused).toMatchObject({ kind: 'feature', feature: 'example-feature' });
		expect(result.data.error).toBe('This is not enabled on this engine. Nothing was changed.');
	});

	it.each([
		[
			{ error: 'the runtime settings changed since they were read', code: 'stale_revision' },
			'Someone changed these settings after you opened them. Reload them to see the latest version.',
		],
		[
			{ error: 'this install runs without runtime settings', code: 'runtime_settings_unavailable' },
			'Could not save the settings, because runtime settings are not available on this engine. Reload the page to see what changed.',
		],
		[
			{ error: 'this install runs without that scaling primitive', code: 'scaling_primitive_missing' },
			'Could not save the settings, because this engine has no database pool to resize. Leave the pool unchanged and save again.',
		],
		[
			{ error: 'this setting is pinned by the deployment: GOGC sets it', code: 'setting_pinned', variable: 'GOGC', source: 'environment' },
			'Could not save the settings, because the environment variable GOGC sets one of them. Change GOGC where the engine is deployed, then restart the engine.',
		],
		[
			{ error: 'this setting is pinned by the deployment: runtime.gc_percent sets it', code: 'setting_pinned', variable: 'runtime.gc_percent', source: 'file' },
			'Could not save the settings, because the configuration file key runtime.gc_percent sets one of them. Change it in the configuration file, then restart the engine.',
		],
		[{ error: 'a conflict this console has not met', code: 'something_new' }, 'Could not save the settings. Reload the page and try again.'],
	])('words a 409 from its code, never from its English (%o)', async (body, sentence) => {
		const { event } = put(() => json(body, 409));
		const result = await actions.runtime(event);
		expect(result).toMatchObject({ status: 409, data: { form: 'runtime', error: sentence } });
		expect(JSON.stringify(result)).not.toContain(body.error);
	});

	it.each([
		[
			422,
			{ error: 'database_max_connections must be between 5 and 10000', code: 'setting_out_of_bounds', field: 'database_max_connections', min: 5, max: 10000 },
			'Enter between 5 and 10,000 connections per replica.',
		],
		[
			422,
			{ error: 'the collector can be off only while a memory limit below the container\'s or the machine\'s memory is in force', code: 'gc_off_needs_memory_limit', gc_percent: -1 },
			"A GC target of -1 turns garbage collection off, which needs a soft memory limit below the container's or the machine's memory. Set a lower soft memory limit, or enter a GC target of 0 or more.",
		],
		[422, { error: 'a refusal this console has not met', code: 'something_new' }, 'Could not save the settings with these values. Check them and try again.'],
		[
			400,
			{ error: 'this route does not take the field threads', code: 'unknown_field', field: 'threads' },
			'Could not save the settings, because this console and the engine are on different versions. Reload the page. If this happens again, update the console to match the engine.',
		],
	])('words a %i from its code, never from its English', async (status, body, sentence) => {
		const { event } = put(() => json(body, status));
		const result = await actions.runtime(event);
		expect(result).toMatchObject({ status, data: { form: 'runtime', error: sentence } });
		expect(JSON.stringify(result)).not.toContain(body.error);
	});

	it('keeps transport failures to the console sentence', async () => {
		const down = put(() => json({ error: 'pq: connection refused' }, 503));
		expect(await actions.runtime(down.event)).toMatchObject({ status: 400, data: { form: 'runtime', error: 'Check whether your change was saved, then try again.' } });
	});

	it('puts a value the form refuses on its own field before the round trip', async () => {
		const { event, calls } = put(() => json(RUNTIME), { revision: '4', database_max_connections: '3' });
		expect(await actions.runtime(event)).toMatchObject({
			status: 422,
			data: { form: 'runtime', fields: { database_max_connections: 'Enter between 5 and 10,000 connections.' } },
		});
		expect(calls.some((c) => c.init?.method === 'PUT')).toBe(false);
	});

	it('refuses a form that changes nothing before the round trip', async () => {
		const { event, calls } = put(() => json(RUNTIME), { revision: '4' });
		expect(await actions.runtime(event)).toMatchObject({ status: 422, data: { form: 'runtime', error: 'Change a setting first.' } });
		expect(calls.some((c) => c.init?.method === 'PUT')).toBe(false);
	});

	it('refuses an admin who is not super admin before the round trip', async () => {
		const { event, calls } = put(() => json(RUNTIME), undefined, ['admin']);
		await expect(actions.runtime(event)).rejects.toMatchObject({ status: 403 });
		expect(calls.some((c) => c.init?.method === 'PUT')).toBe(false);
	});
});
