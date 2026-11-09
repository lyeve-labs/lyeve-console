import { describe, expect, it, vi } from 'vitest';
import type { Cookies } from '@sveltejs/kit';
import { load, type TelemetryPage } from './+page.server';

type Loaded = TelemetryPage;

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function text(body: string, status = 200): Response {
	return new Response(body, { status, headers: { 'content-type': 'text/plain; version=0.0.4' } });
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

const TENANT_VIEW = `# HELP lyeve_requests_total Requests served.
# TYPE lyeve_requests_total counter
lyeve_requests_total{code="2xx",method="GET",plugin="core",tenant="acme"} 12
`;

const WHOLE_VIEW = `# TYPE lyeve_db_pool_max_connections gauge
lyeve_db_pool_max_connections 25
${TENANT_VIEW}lyeve_requests_total{code="2xx",method="GET",plugin="core",tenant="globex"} 3
`;

// The plugin's exporter page. Its times are Go time values, which JSON
// writes as the zero time rather than leaving them out.
const EXPORTERS = {
	data: [
		{
			name: 'pushgateway',
			healthy: true,
			last_export: '2026-10-14T09:00:00Z',
			last_failure: '0001-01-01T00:00:00Z',
			exports: 2,
			failures: 0,
		},
	],
	limit: 50,
	offset: 0,
	total_count: 1,
};

/** An engine error as the plugin writes one. */
function refused(status: number, error: string, code: string): Response {
	return json({ error, code }, status);
}

function loadEvent(routes: Record<string, Route>, roles: string[]) {
	const { fetch, calls } = fetchFor(routes, roles);
	return {
		event: {
			fetch,
			cookies: mockCookies(),
			url: new URL('http://localhost/admin/observability/telemetry'),
			parent: async () => ({ user: { id: 'u1', roles }, entitlements: { plan: '', state: '', features: [], tenant_quota: 1 } }),
		} as never,
		calls,
	};
}

describe('telemetry load', () => {
	// The engine narrows the scrape to the caller's tenant. The exporters are
	// the export tab's, so this load never sends that request.
	it('reads the metrics only for a tenant admin and never asks for the exporters', async () => {
		const { event, calls } = loadEvent({ '/telemetry/metrics': () => text(TENANT_VIEW) }, ['admin']);
		const result = (await load(event)) as Loaded;
		expect(result.superAdmin).toBe(false);
		expect(result.families.ok && result.families.value.map((f) => f.name)).toEqual(['lyeve_requests_total']);
		expect(result.families.ok && result.families.value[0].samples).toHaveLength(1);
		expect(result).not.toHaveProperty('exporters');
		expect(calls.some((c) => c.url.includes('/telemetry/exporters'))).toBe(false);
	});

	// The scrape is built outside the JSON client, so it has to carry the
	// same session every other read carries, the CSRF token included.
	it('sends the scrape with the session headers', async () => {
		const { event, calls } = loadEvent({ '/telemetry/metrics': () => text(TENANT_VIEW) }, ['admin']);
		await load(event);
		const scrape = calls.find((c) => c.url.includes('/telemetry/metrics'));
		expect(scrape?.init?.headers).toMatchObject({ Authorization: 'Bearer tok', 'X-CSRF-Token': 'tok', Accept: 'text/plain' });
	});

	it('reads the whole registry for a super admin, and leaves the exporters to the export tab', async () => {
		const { event } = loadEvent(
			{ '/telemetry/metrics': () => text(WHOLE_VIEW), '/telemetry/exporters': () => json(EXPORTERS) },
			['super_admin'],
		);
		const result = (await load(event)) as Loaded;
		expect(result.superAdmin).toBe(true);
		expect(result.families.ok && result.families.value.map((f) => f.name)).toEqual([
			'lyeve_db_pool_max_connections',
			'lyeve_requests_total',
		]);
		expect(result.families.ok && result.families.value[1].samples).toHaveLength(2);
		expect(result).not.toHaveProperty('exporters');
	});

	// A proxy in front of the engine answers 503 when it has no engine to
	// send the scrape to, with a body of its own rather than the engine's.
	it('reports a scrape a proxy could not deliver as an outage, not as an empty registry', async () => {
		const { event } = loadEvent(
			{
				'/telemetry/metrics': () =>
					new Response('<html><body>503 Service Unavailable</body></html>', {
						status: 503,
						headers: { 'content-type': 'text/html' },
					}),
			},
			['admin'],
		);
		const result = (await load(event)) as Loaded;
		expect(result.families).toEqual({ ok: false, gate: { state: 'unavailable' } });
	});

	it('reports a scrape that ran out of time as an outage', async () => {
		const { event } = loadEvent(
			{
				'/telemetry/metrics': () => {
					throw new DOMException('t', 'TimeoutError');
				},
			},
			['admin'],
		);
		const result = (await load(event)) as Loaded;
		expect(result.families).toEqual({ ok: false, gate: { state: 'unavailable' } });
	});

	it('reports a scrape refused for the role as forbidden', async () => {
		const { event } = loadEvent(
			{ '/telemetry/metrics': () => refused(403, 'instance-wide metrics need super_admin', 'forbidden') },
			['admin'],
		);
		const result = (await load(event)) as Loaded;
		expect(result.families).toEqual({ ok: false, gate: { state: 'forbidden' } });
	});

	it('reports a build without the plugin as absent', async () => {
		const { event } = loadEvent({}, ['super_admin']);
		const result = (await load(event)) as Loaded;
		expect(result.families).toEqual({ ok: false, gate: { state: 'absent' } });
	});

	it('refuses a role below admin', async () => {
		const { event } = loadEvent({}, ['editor']);
		await expect(load(event)).rejects.toMatchObject({ status: 403 });
	});
});
