import { describe, it, expect, vi } from 'vitest';
import type { Cookies } from '@sveltejs/kit';

import { actions, load } from './+page.server';
import { attentionOf, hoursOf } from '$lib/server/dashboard';

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' },
	});
}

function mockCookies(token: string | undefined = 'tok'): Cookies {
	return {
		get: vi.fn((name: string) => (name === '__Host-sys_session' ? token : undefined)),
		set: vi.fn(),
		delete: vi.fn(),
		getAll: vi.fn(() => []),
		serialize: vi.fn(() => ''),
	} as unknown as Cookies;
}

const admin = {
	id: 'u1',
	email: 'a@b.co',
	roles: ['admin'],
	tenant_id: 't',
	disabled: false,
	created_at: '',
};

const superAdmin = { ...admin, roles: ['super_admin'] };

/** The queue the engine lists and the dialog showed. */
const QUEUED = ['drop column _posts.title'];

/**
 * One apply attempt.
 *
 * `apply` is what the engine answers the write with, so a case can make the
 * migration succeed or be refused with the sentence the engine would send.
 */
function applyEvent(
	fields: Record<string, string>,
	{
		apply = json({ applied: 2 }),
		user = superAdmin,
		queued = QUEUED,
	}: { apply?: Response; user?: unknown; queued?: string[] } = {}
) {
	const seen: { url: string; method: string | undefined }[] = [];
	const fetch = vi.fn(async (url: string, init?: RequestInit) => {
		seen.push({ url: String(url), method: init?.method });
		if (String(url).includes('/api/admin/auth/me')) return json(user);
		if (String(url).includes('/api/admin/migrate/apply')) return apply.clone();
		if (String(url).includes('/api/admin/migrate')) {
			return json({ pending: queued.length, items: queued.map((description) => ({ schema_name: 'posts', description })) });
		}
		return json({});
	}) as unknown as typeof globalThis.fetch;

	// The form carries the queue the dialog listed, which matches the engine's unless a case says otherwise.
	const form = new FormData();
	form.set('expected', JSON.stringify(QUEUED));
	for (const [k, v] of Object.entries(fields)) form.set(k, v);

	return {
		seen,
		event: {
			fetch,
			cookies: mockCookies(),
			request: { formData: async () => form },
			url: new URL('http://localhost/admin'),
		} as never,
	};
}

/** Catch the Redirect the action throws on success. */
function catchRedirect(fn: () => unknown): Promise<{ status: number; location: string }> {
	return Promise.resolve(fn()).then(
		() => {
			throw new Error('expected a redirect');
		},
		(e: unknown) => {
			const err = e as { status?: number; location?: string };
			if (err.status && err.location) return { status: err.status, location: err.location };
			throw e;
		}
	);
}

/*
 * The write behind the shell header's status chip lives here, on the one page
 * every signed-in operator can reach, so it works with no JavaScript and a
 * refusal has a page to be read on.
 */
describe('admin dashboard applyMigrations action', () => {
	it('applies through the engine endpoint', async () => {
		const { seen, event } = applyEvent({ redirectTo: '/admin/media' });

		await catchRedirect(() => actions.applyMigrations(event));

		const write = seen.find((r) => r.url.includes('/api/admin/migrate/apply'));
		expect(write?.method).toBe('POST');
	});

	/*
	 * The engine applies whatever is queued when the post arrives. A drop that
	 * another tenant's save queued after the dialog was drawn was never shown,
	 * so it must not run.
	 */
	it('applies nothing when the queue changed since it was listed', async () => {
		const { seen, event } = applyEvent(
			{ redirectTo: '/admin' },
			{ queued: ['drop column _posts.title', 'drop column _pages.body'] }
		);

		const result = (await actions.applyMigrations(event)) as { status: number; data: { error: string } };

		expect(result.status).toBe(409);
		expect(result.data.error).toBe('Someone changed the migration queue after you opened it. Review it again.');
		expect(seen.some((r) => r.url.includes('/api/admin/migrate/apply'))).toBe(false);
	});

	it('applies nothing when the form names no queue', async () => {
		const { seen, event } = applyEvent({ redirectTo: '/admin', expected: '' });

		const result = (await actions.applyMigrations(event)) as { status: number };

		expect(result.status).toBe(409);
		expect(seen.some((r) => r.url.includes('/api/admin/migrate/apply'))).toBe(false);
	});

	it('returns the reader to the screen they submitted from', async () => {
		const { event } = applyEvent({ redirectTo: '/admin/media?limit=25' });

		const r = await catchRedirect(() => actions.applyMigrations(event));

		expect(r.status).toBe(303);
		expect(r.location).toBe('/admin/media?limit=25');
	});

	// The target is a form field, so it is whatever was posted.
	it('refuses a redirect target that leaves the engine', async () => {
		const { event } = applyEvent({ redirectTo: 'https://evil.example/' });

		const r = await catchRedirect(() => actions.applyMigrations(event));

		expect(r.location).toBe('/admin');
	});

	it('lands on this page when the form named nowhere', async () => {
		const { event } = applyEvent({});

		const r = await catchRedirect(() => actions.applyMigrations(event));

		expect(r.location).toBe('/admin');
	});

	/*
	 * The engine names the statement that failed. That sentence is the whole
	 * value of the message, so the page relays it.
	 */
	it('relays the engine refusal', async () => {
		const { event } = applyEvent(
			{ redirectTo: '/admin' },
			{ apply: json({ error: 'migration 059 failed', code: 'bad_request' }, 400) }
		);

		const result = (await actions.applyMigrations(event)) as {
			status: number;
			data: { error: string };
		};

		expect(result.status).toBe(400);
		expect(result.data.error).toBe('migration 059 failed');
	});

	// A 5xx body can carry driver text, so it collapses to a static message.
	it('does not relay a server-side failure verbatim', async () => {
		const { event } = applyEvent(
			{ redirectTo: '/admin' },
			{ apply: json({ error: 'pq: relation sys_ddl_log does not exist' }, 500) }
		);

		const result = (await actions.applyMigrations(event)) as { data: { error: string } };

		expect(result.data.error).toBe('Could not apply the migrations. Try again.');
	});

	it('refuses a session that may not apply migrations', async () => {
		const { seen, event } = applyEvent(
			{ redirectTo: '/admin' },
			{ user: { ...admin, roles: ['editor'] } }
		);

		await expect(actions.applyMigrations(event)).rejects.toMatchObject({ status: 403 });
		expect(seen.some((r) => r.url.includes('/api/admin/migrate/apply'))).toBe(false);
	});

	// The engine serves the apply to a super admin only, so an admin's post
	// is a role refusal rather than a migration that failed.
	it('refuses an admin before the engine is asked', async () => {
		const { seen, event } = applyEvent({ redirectTo: '/admin' }, { user: admin });

		await expect(actions.applyMigrations(event)).rejects.toMatchObject({ status: 403 });
		expect(seen.some((r) => r.url.includes('/api/admin/migrate/apply'))).toBe(false);
	});
});

/**
 * One dashboard load, with a fetch that answers by path.
 *
 * `answer` maps a path fragment to what the engine sends. Anything unmapped
 * is a 404, which is what an inactive plugin's route looks like.
 */
function loadEvent(answer: Record<string, unknown>, user = admin, href = 'http://localhost/admin', extra: Record<string, unknown> = {}) {
	const seen: string[] = [];
	const queries: Record<string, URLSearchParams> = {};
	const fetch = vi.fn(async (url: string) => {
		const u = new URL(String(url), 'http://x');
		const path = u.pathname;
		seen.push(path);
		queries[path] = u.searchParams;
		for (const [fragment, body] of Object.entries(answer)) {
			if (path.includes(fragment)) return json(body);
		}
		return json({ error: 'not found' }, 404);
	}) as unknown as typeof globalThis.fetch;
	const event = {
		fetch,
		cookies: mockCookies(),
		url: new URL(href),
		parent: async () => ({
			user,
			entitlements: { plan: 'example', state: 'active', features: [], tenant_quota: 0, license_module: true },
			...extra,
		}),
	} as never;
	return { seen, queries, event };
}

type Loaded = Exclude<Awaited<ReturnType<typeof load>>, void>;

const schemaList = [{ name: 'post', display_name: 'Post', fields: [] }];

/*
 * The dashboard reads nine endpoints and any of them can be off: a plugin not
 * active, a license that does not cover it. One refusal must not take the
 * page down, and a tile whose read failed has to be told apart from a tile
 * that read zero.
 */
describe('admin dashboard load', () => {
	it('asks no plugin anything on an engine that runs none, and still reads its own security report', async () => {
		const { event, seen } = loadEvent({}, superAdmin, 'http://localhost/admin', {
			plugins: { state: 'named', running: [], withheld: [] },
		});

		const d = (await load(event)) as Loaded;

		expect(seen).toEqual(['/api/admin/security/controls']);
		expect(d.offers).toEqual({
			schema: false,
			content: false,
			analytics: false,
			jobs: false,
			logs: false,
			webhooks: false,
			audit: false,
		});
		expect(d.schemas).toBeNull();
	});

	it('reads what each running plugin answers, and nothing else', async () => {
		const { event, seen } = loadEvent({ '/api/admin/schemas': schemaList }, superAdmin, 'http://localhost/admin', {
			plugins: { state: 'named', running: ['schema', 'cron'], withheld: [] },
		});

		const d = (await load(event)) as Loaded;

		expect(d.offers.schema).toBe(true);
		expect(d.offers.jobs).toBe(true);
		expect(seen.some((p) => p.startsWith('/api/admin/jobs'))).toBe(true);
		for (const other of ['/api/admin/content', '/api/admin/audit-log', '/api/admin/logs', '/api/admin/logging', '/api/admin/apianalytics', '/api/admin/webhook']) {
			expect(seen.some((p) => p.startsWith(other)), other).toBe(false);
		}
	});

	const customized = {
		customization: {
			entitled: true,
			settings: { brand: { name: '', logo_url: '', accent: '', welcome: 'Hi' }, menu: { hidden: [], pinned: [], links: [] }, home_page: '' },
			pages: [],
		},
	};

	it('draws a composed dashboard instead of the stock panels, and skips their reads', async () => {
		const { event, seen } = loadEvent(
			{
				'/api/admin/customization/dashboard': {
					entitled: true,
					custom: true,
					widgets: [
						{ id: 'status', type: 'status_breakdown' },
						{ id: 'note', type: 'text', body: 'For editors', roles: ['editor'] },
					],
					updated_at: '2026-09-26T10:00:00Z',
				},
				'/api/admin/schemas': schemaList,
				'/api/admin/content': { data: [], total_count: 7 },
			},
			admin,
			'http://localhost/admin',
			customized,
		);

		const d = (await load(event)) as Loaded;

		expect(d.composed?.map((w: { id: string }) => w.id)).toEqual(['status']);
		expect(d.composed?.[0].statuses).toEqual({ published: 7, draft: 7, archived: 7 });
		expect(d.welcome).toBe('Hi');
		expect(seen.some((p) => p.includes('/api/admin/jobs'))).toBe(false);
		expect(seen.some((p) => p.includes('/apianalytics/'))).toBe(false);
	});

	// The tenant chose a page to lead the dashboard. A read of it that failed
	// was dropped, so the dashboard showed without it and said nothing.
	it('keeps a failed read of the chosen home page as its gate', async () => {
		const chose = { customization: { ...customized.customization, settings: { ...customized.customization.settings, home_page: 'welcome' } } };
		const { event, seen } = loadEvent(
			{ '/api/admin/customization/dashboard': { entitled: true, custom: false, widgets: [], updated_at: null }, '/api/admin/schemas': schemaList },
			admin,
			'http://localhost/admin',
			chose,
		);
		const d = (await load(event)) as Loaded;
		expect(seen).toContain('/api/admin/customization/pages/welcome');
		expect(d.homePage).toBeNull();
		expect(d.home).toEqual({ slug: 'welcome', gate: { state: 'absent' } });
	});

	it('reports no home page failure when the tenant chose none', async () => {
		const { event } = loadEvent({ '/api/admin/schemas': schemaList }, admin, 'http://localhost/admin', customized);
		const d = (await load(event)) as Loaded;
		expect(d.home).toBeNull();
	});

	// A composed dashboard that could not be read fell back to the stock one
	// in silence, so its readers could not tell the two apart.
	it('says when the composed dashboard could not be read', async () => {
		const { event } = loadEvent({ '/api/admin/schemas': schemaList }, admin, 'http://localhost/admin', customized);
		const failing = event as unknown as { fetch: typeof globalThis.fetch };
		const inner = failing.fetch;
		failing.fetch = (async (url: string, init?: RequestInit) =>
			String(url).includes('/api/admin/customization/dashboard') ? json({ error: 'unavailable' }, 503) : inner(url, init)) as typeof globalThis.fetch;
		const d = (await load(event)) as Loaded;
		expect(d.composed).toBeNull();
		expect(d.layoutUnread).toBe(true);
	});

	it('reports a readable layout as read', async () => {
		const { event } = loadEvent(
			{ '/api/admin/customization/dashboard': { entitled: true, custom: false, widgets: [], updated_at: null }, '/api/admin/schemas': schemaList },
			admin,
			'http://localhost/admin',
			customized,
		);
		expect(((await load(event)) as Loaded).layoutUnread).toBe(false);
	});

	it('keeps the stock dashboard when the tenant composed none', async () => {
		const { event, seen } = loadEvent(
			{
				'/api/admin/customization/dashboard': { entitled: true, custom: false, widgets: [], updated_at: null },
				'/api/admin/schemas': schemaList,
			},
			superAdmin,
			'http://localhost/admin',
			customized,
		);
		const d = (await load(event)) as Loaded;
		expect(d.composed).toBeNull();
		expect(seen.some((p) => p.includes('/api/admin/jobs'))).toBe(true);
	});

	it('reads every tile and list for a super admin', async () => {
		const { event } = loadEvent({
			'/api/admin/schemas': schemaList,
			'/api/admin/content': { data: [{ id: 'e1', schema: 'post', title: 'Hello', slug: 'hello', status: 'draft', updated_at: '' }], total_count: 42 },
			'/api/admin/apianalytics/metrics/summary': { total_requests: 1200, error_rate: 0.02, avg_latency_p95_ms: 0 },
			'/api/admin/jobs': [
				{ id: 'j1', name: 'nightly', enabled: true, last_status: 'error' },
				{ id: 'j2', name: 'hourly', enabled: true, last_status: 'ok' },
				{ id: 'j3', name: 'off', enabled: false, last_status: 'error' },
			],
			'/api/admin/logging/volume': { total: 9, by_level: { ERROR: 3 } },
			'/api/admin/logs/search': { results: [{ timestamp: 't', level: 'ERROR', message: 'boom' }], total: 3 },
			'/api/admin/webhooks/health': { total_webhooks: 4, unhealthy_webhooks: 1, pending_dlq: 2 },
			'/api/admin/webhook-dead-letters': { data: [{ id: 'd1', webhook_name: 'inventory', event_type: 'content.created', total_attempts: 5 }], total_count: 1 },
			'/api/admin/audit-log': { data: [{ id: 'a1', action: 'schema.update', resource_type: 'schema', resource_id: 'post', created_at: '' }], total: 1 },
		}, superAdmin);

		const d = (await load(event)) as Loaded;

		expect(d.schemas).toEqual({ ok: true, value: schemaList });
		expect(d.entryTotal).toBe(42);
		expect(d.entries.map((e: { id: string }) => e.id)).toEqual(['e1']);
		expect(d.requests).toEqual({ total: 1200, errorRate: 0.02, p95: 0 });
		expect(d.jobs).toEqual({ enabled: 2, failed: [{ id: 'j1', name: 'nightly' }] });
		expect(d.errorsLogged).toBe(3);
		expect(d.webhooks).toEqual({ total: 4, unhealthy: 1, pendingDlq: 2 });
		expect(d.deadLetters.map((l: { id: string }) => l.id)).toEqual(['d1']);
		expect(d.audit.map((a: { id: string }) => a.id)).toEqual(['a1']);
		expect(d.errors.map((e: { message: string }) => e.message)).toEqual(['boom']);
		expect(d.license).toEqual({ plan: 'example', state: 'active' });
	});

	it('names the plan in the license module\'s words', async () => {
		const { event } = loadEvent({}, admin, 'http://localhost/admin', {
			entitlements: { plan: 'example', plan_label: 'Example', state: 'grace', features: [], tenant_quota: 0, license_module: true },
		});

		const d = (await load(event)) as Loaded;

		expect(d.license).toEqual({ plan: 'Example', state: 'grace' });
		expect(d.attention.map((a: { href: string }) => a.href)).toContain('/admin/settings/license');
	});

	it('has no license tile and no license notice on a build without a license module', async () => {
		for (const entitlements of [
			{ plan: 'free', state: 'free', features: [], tenant_quota: 0, license_module: false },
			{ plan: 'example', state: 'expired', features: [], tenant_quota: 0 },
			{ plan: '', state: '', features: [], tenant_quota: 0 },
		]) {
			const { event } = loadEvent({}, admin, 'http://localhost/admin', { entitlements });

			const d = (await load(event)) as Loaded;

			expect(d.license, JSON.stringify(entitlements)).toBeNull();
			expect(d.attention.some((a: { href: string }) => a.href === '/admin/settings/license')).toBe(false);
		}
	});

	it('marks a tile unknown when its read fails, and keeps the rest', async () => {
		const { event } = loadEvent({
			'/api/admin/schemas': schemaList,
			'/api/admin/content': { data: [], total_count: 0 },
			'/api/admin/jobs': [],
		}, superAdmin);

		const d = (await load(event)) as Loaded;

		expect(d.entryTotal).toBe(0);
		expect(d.entries).toEqual([]);
		expect(d.jobs).toEqual({ enabled: 0, failed: [] });
		expect(d.requests).toBeNull();
		expect(d.errorsLogged).toBeNull();
		expect(d.traffic).toBeNull();
		expect(d.endpoints).toBeNull();
		expect(d.entriesByStatus).toEqual({ published: 0, drafts: 0 });
		expect(d.webhooks).toBeNull();
		expect(d.deadLetters).toBeNull();
		expect(d.audit).toBeNull();
		expect(d.errors).toBeNull();
	});

	it('keeps a failed schemas read apart from an engine with no schemas', async () => {
		const { event } = loadEvent({});
		const inner = (event as { fetch: typeof globalThis.fetch }).fetch;
		(event as { fetch: typeof globalThis.fetch }).fetch = (async (url: string, init?: RequestInit) => {
			if (new URL(String(url), 'http://x').pathname === '/api/admin/schemas') return json({ error: 'down' }, 503);
			return inner(url, init);
		}) as typeof globalThis.fetch;

		const d = (await load(event)) as Loaded;

		expect(d.schemas).toEqual({ ok: false, gate: { state: 'unavailable' } });
	});

	it('keeps a failed content read apart from an empty one', async () => {
		const { event } = loadEvent({ '/api/admin/schemas': schemaList });

		const d = (await load(event)) as Loaded;

		expect(d.entries).toBeNull();
		expect(d.entryTotal).toBeNull();
		expect(d.entriesByStatus).toBeNull();
	});

	// The content list and every tile but the schemas are admin routes, so an
	// editor is asked for none of them rather than shown their refusal as zero.
	it('reads only the schemas for an editor', async () => {
		const { seen, event } = loadEvent(
			{ '/api/admin/schemas': schemaList },
			{ ...admin, roles: ['editor'] }
		);

		const d = (await load(event)) as Loaded;

		expect(d.isAdmin).toBe(false);
		expect(seen).toEqual(['/api/admin/schemas']);
		expect(d.entryTotal).toBeNull();
		expect(d.entries).toBeNull();
		expect(d.requests).toBeNull();
	});

	// The security report is a super admin route, so an admin's visit does not
	// cost a refused read.
	it('does not ask an admin for the security report', async () => {
		const { seen, event } = loadEvent({ '/api/admin/schemas': schemaList });

		const d = (await load(event)) as Loaded;

		expect(seen).not.toContain('/api/admin/security/controls');
		expect(d.controlFailures).toBeNull();
	});

	// The scheduler lists its jobs to a super admin only.
	it('does not ask the scheduler for an admin', async () => {
		const { seen, event } = loadEvent({ '/api/admin/schemas': schemaList, '/api/admin/jobs': [] });

		const d = (await load(event)) as Loaded;

		expect(d.superAdmin).toBe(false);
		expect(seen.some((p) => p.startsWith('/api/admin/jobs'))).toBe(false);
		expect(d.jobs).toBeNull();
	});

	it('reads a jobs list wrapped in an object as well as a bare array', async () => {
		const { event } = loadEvent({
			'/api/admin/schemas': schemaList,
			'/api/admin/jobs': { jobs: [{ id: 'j1', enabled: true, last_status: 'error' }] },
		}, superAdmin);

		const d = (await load(event)) as Loaded;

		expect(d.jobs).toEqual({ enabled: 1, failed: [{ id: 'j1', name: undefined }] });
		expect(d.entriesByStatus).toBeNull();
	});

	/*
	 * The analytics summary with no `from` sums every retained hour and only
	 * labels the range "24h ago", so a tile that says 24h has to send the
	 * bound itself. Every windowed read gets the same one.
	 */
	it('sends the window to every read that takes one', async () => {
		const before = Date.now();
		const { queries, event } = loadEvent(
			{ '/api/admin/schemas': schemaList },
			admin,
			'http://localhost/admin?window=7d'
		);

		const d = (await load(event)) as Loaded;

		expect(d.window).toBe('7d');
		const from = queries['/api/admin/apianalytics/metrics/summary'].get('from') ?? '';
		const age = before - Date.parse(from);
		expect(age).toBeGreaterThanOrEqual(168 * 3_600_000);
		expect(age).toBeLessThan(169 * 3_600_000);
		expect(queries['/api/admin/apianalytics/metrics/trend'].get('from')).toBe(from);
		expect(queries['/api/admin/apianalytics/metrics/endpoints'].get('from')).toBe(from);
		expect(queries['/api/admin/logs/search'].get('from')).toBe(from);
		expect(queries['/api/admin/logging/volume'].get('window')).toBe('7d');
	});

	it('falls back to a day for a window it does not know', async () => {
		const { queries, event } = loadEvent(
			{ '/api/admin/schemas': schemaList },
			admin,
			'http://localhost/admin?window=1y'
		);

		const d = (await load(event)) as Loaded;

		expect(d.window).toBe('24h');
		expect(queries['/api/admin/logging/volume'].get('window')).toBe('24h');
	});

	it('counts entries by status when both reads answer', async () => {
		const seenStatus: string[] = [];
		const { event } = loadEvent({ '/api/admin/schemas': schemaList });
		const inner = (event as { fetch: typeof globalThis.fetch }).fetch;
		(event as { fetch: typeof globalThis.fetch }).fetch = (async (url: string, init?: RequestInit) => {
			const u = new URL(String(url), 'http://x');
			if (u.pathname === '/api/admin/content' && u.searchParams.get('status')) {
				seenStatus.push(u.searchParams.get('status') ?? '');
				const total = u.searchParams.get('status') === 'published' ? 40 : 2;
				return json({ data: [], total_count: total });
			}
			return inner(url, init);
		}) as typeof globalThis.fetch;

		const d = (await load(event)) as Loaded;

		expect(seenStatus.sort()).toEqual(['draft', 'published']);
		expect(d.entriesByStatus).toEqual({ published: 40, drafts: 2 });
	});

	it('fills the quiet hours of the trend with zero, oldest first', async () => {
		const { event } = loadEvent({
			'/api/admin/schemas': schemaList,
			'/api/admin/apianalytics/metrics/trend': { points: [] },
		});

		const d = (await load(event)) as Loaded;

		expect(d.traffic?.length).toBe(25);
		expect(d.traffic?.every((h: { requests: number }) => h.requests === 0)).toBe(true);
	});
});

describe('hoursOf', () => {
	it('places each answered hour in its bucket and zeroes the rest', () => {
		const since = new Date('2026-09-13T10:00:00Z');
		const until = new Date('2026-09-13T13:30:00Z');
		const points = [
			{ hour: '2026-09-13T12:00:00Z', request_count: 7, error_rate: 0.5, avg_latency_p95_ms: 0, max_latency_p99_ms: 0 },
			{ hour: '2026-09-13T10:00:00Z', request_count: 3, error_rate: 0, avg_latency_p95_ms: 0, max_latency_p99_ms: 0 },
		];

		expect(hoursOf(points, since, until).map((h) => [h.hour.slice(11, 13), h.requests, h.errorRate])).toEqual([
			['10', 3, 0],
			['11', 0, 0],
			['12', 7, 0.5],
			['13', 0, 0],
		]);
	});
});

/*
 * The list names what to act on. A read that failed is not a problem to act
 * on, so it contributes nothing. The tile beside it already says unknown.
 */
describe('attentionOf', () => {
	const quiet = {
		requests: { total: 100, errorRate: 0 },
		jobs: { failed: [] },
		errorsLogged: 0,
		webhooks: { unhealthy: 0, pendingDlq: 0 },
		license: { state: 'active' },
	};

	it('is empty for a quiet instance', () => {
		expect(attentionOf(quiet, '24h')).toEqual([]);
	});

	it('is empty when nothing could be read', () => {
		expect(
			attentionOf({ requests: null, jobs: null, errorsLogged: null, webhooks: null, license: { state: 'active' } }, '24h')
		).toEqual([]);
	});

	it('names each failed job and links to it', () => {
		const items = attentionOf({ ...quiet, jobs: { failed: [{ id: 'j1', name: 'nightly' }, { id: 'j2', name: 'purge' }] } }, '24h');

		expect(items.map((i) => [i.text, i.href])).toEqual([
			['Job nightly failed on its last run.', '/admin/jobs?edit=j1'],
			['Job purge failed on its last run.', '/admin/jobs?edit=j2'],
		]);
	});

	it('puts the license first and grades the failure rate by the analytics bands', () => {
		const items = attentionOf(
			{ ...quiet, license: { state: 'expired' }, requests: { total: 50, errorRate: 0.02 }, errorsLogged: 1, webhooks: { unhealthy: 2, pendingDlq: 1 } },
			'6h'
		);

		expect(items.map((i) => i.tone)).toEqual(['danger', 'warn', 'warn', 'warn', 'warn']);
		expect(items[0].href).toBe('/admin/settings/license');
		expect(items[1].text).toBe('2.0% of requests failed in the last 6h.');
		expect(items[2].text).toBe('2 webhooks are unhealthy.');
		expect(items[3].text).toBe('1 delivery is waiting in the dead letter queue.');
		expect(items[4].text).toBe('1 error logged in the last 6h.');
	});

	it('flags controls that are configured but not enforcing, right after the license', () => {
		const items = attentionOf({ ...quiet, license: { state: 'grace' }, controlFailures: 2, errorsLogged: 3 }, '24h');
		expect(items.map((i) => [i.tone, i.href])).toEqual([
			['warn', '/admin/settings/license'],
			['danger', '/admin/settings/security'],
			['warn', '/admin/logs?level=ERROR'],
		]);
		expect(items[1].text).toBe('2 security controls are configured but not in effect.');
		expect(attentionOf({ ...quiet, controlFailures: 0 }, '24h')).toEqual([]);
		expect(attentionOf({ ...quiet, controlFailures: null }, '24h')).toEqual([]);
	});

	it('does not grade a failure rate over no requests', () => {
		expect(attentionOf({ ...quiet, requests: { total: 0, errorRate: 1 } }, '24h')).toEqual([]);
	});
});
