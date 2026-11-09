import { describe, expect, it, vi } from 'vitest';
import type { Cookies } from '@sveltejs/kit';
import { actions, load, type TelemetryExportPage } from './+page.server';

type Loaded = TelemetryExportPage;

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
			url: new URL('http://localhost/admin/observability/telemetry/export'),
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
		event: { fetch, cookies: mockCookies(), request: new Request('http://localhost/admin/observability/telemetry/export', { method: 'POST', body }) } as never,
		calls,
	};
}

describe('telemetry export load', () => {
	// The exporters are the instance's export configuration. The page asks
	// for them only when the caller may read them, so a tenant admin's load
	// never even sends that request.
	it('never asks for the exporters for a tenant admin', async () => {
		const { event, calls } = loadEvent({ '/telemetry/destination': () => json({ destination: null, licensed: true }) }, ['admin']);
		const result = (await load(event)) as Loaded;
		expect(result.superAdmin).toBe(false);
		expect(result.exporters).toBeNull();
		expect(calls.some((c) => c.url.includes('/telemetry/exporters'))).toBe(false);
	});

	it('reads the exporters for a super admin', async () => {
		const { event } = loadEvent({ '/telemetry/exporters': () => json(EXPORTERS) }, ['super_admin']);
		const result = (await load(event)) as Loaded;
		expect(result.superAdmin).toBe(true);
		expect(result.exporters).toEqual({ ok: true, value: EXPORTERS.data });
	});

	it('reports a destination the database could not read as an outage', async () => {
		const { event } = loadEvent(
			{
				'/telemetry/metrics': () => text(TENANT_VIEW),
				'/telemetry/destination': () => refused(503, 'failed to read the destination', 'service_unavailable'),
			},
			['admin'],
		);
		const result = (await load(event)) as Loaded;
		expect(result.destination).toEqual({ ok: false, gate: { state: 'unavailable' } });
	});

	it('reports a build without the plugin as absent', async () => {
		const { event } = loadEvent({}, ['super_admin']);
		const result = (await load(event)) as Loaded;
		expect(result.exporters).toEqual({ ok: false, gate: { state: 'absent' } });
		expect(result.destination).toEqual({ ok: false, gate: { state: 'absent' } });
	});

	it('keeps the destination when only the exporter list failed', async () => {
		const { event } = loadEvent(
			{
				'/telemetry/destination': () => json({ destination: null, licensed: true }),
				'/telemetry/exporters': () => refused(500, 'internal error', 'internal_error'),
			},
			['super_admin'],
		);
		const result = (await load(event)) as Loaded;
		expect(result.destination).toEqual({ ok: true, value: { destination: null, licensed: true } });
		expect(result.exporters).toEqual({
			ok: false,
			gate: { state: 'error', message: 'Could not load exporters.' },
		});
	});

	it('refuses a role below admin', async () => {
		const { event } = loadEvent({}, ['editor']);
		await expect(load(event)).rejects.toMatchObject({
			status: 403,
			body: { message: 'Only an admin or a super admin can open this page.' },
		});
	});
});

describe('the export action', () => {
	it('posts a manual export for the named exporter as a super admin', async () => {
		const { event, calls } = actionEvent(
			{ name: 'pushgateway' },
			{ '/telemetry/exporters/pushgateway/export': () => json({ status: 'ok', message: 'Export started for pushgateway.' }) },
			['super_admin'],
		);
		const result = await actions.export(event);
		expect(result).toMatchObject({ name: 'pushgateway', exported: true, message: 'Export started for pushgateway.' });
		const post = calls.find((c) => c.url.includes('/exporters/pushgateway/export'));
		expect(post?.init?.method).toBe('POST');
	});

	it('says the cooldown on a 429 rather than a failure', async () => {
		const { event } = actionEvent(
			{ name: 'otlp' },
			{ '/telemetry/exporters/otlp/export': () => refused(429, 'export cooldown active; minimum 5 seconds between manual exports', 'rate_limited') },
			['super_admin'],
		);
		const result = await actions.export(event);
		expect(result).toMatchObject({ status: 429, data: { name: 'otlp' } });
		expect((result as { data: { error: string } }).data.error).toContain('Wait five seconds');
	});

	it('refuses a tenant admin before the round trip', async () => {
		const { event, calls } = actionEvent({ name: 'pushgateway' }, {}, ['admin']);
		await expect(actions.export(event)).rejects.toMatchObject({ status: 403 });
		expect(calls.some((c) => c.init?.method === 'POST')).toBe(false);
	});

	it('refuses an empty name before the round trip', async () => {
		const { event, calls } = actionEvent({ name: ' ' }, {}, ['super_admin']);
		const result = await actions.export(event);
		expect(result).toMatchObject({ status: 400 });
		expect(calls.some((c) => c.init?.method === 'POST')).toBe(false);
	});
});

describe('the tenant destination', () => {
	const STORED = {
		destination: { kind: 'otlp', url: 'https://otlp.example.com/v1/metrics', header_names: ['Authorization'], health: null },
		licensed: true,
	};

	function bodyOf(calls: { url: string; init?: RequestInit }[]) {
		const put = calls.find((c) => c.url.includes('/telemetry/destination') && c.init?.method === 'PUT');
		return put ? JSON.parse(String(put.init?.body)) : null;
	}

	it('reads the destination for a tenant admin', async () => {
		const { event } = loadEvent(
			{ '/telemetry/metrics': () => text(TENANT_VIEW), '/telemetry/destination': () => json(STORED) },
			['admin'],
		);
		const result = (await load(event)) as Loaded;
		expect(result.destination).toEqual({ ok: true, value: STORED });
	});

	it('reports an unread destination as a failed read rather than as none set', async () => {
		const { event } = loadEvent(
			{
				'/telemetry/metrics': () => text(TENANT_VIEW),
				'/telemetry/destination': () => refused(500, 'failed to read the destination', 'internal_error'),
			},
			['admin'],
		);
		const result = (await load(event)) as Loaded;
		expect(result.destination).toEqual({
			ok: false,
			gate: { state: 'error', message: 'Could not load the destination.' },
		});
	});

	// Header values are write-only: keeping the stored ones means leaving the
	// field out, so the console never has to hold them.
	it('leaves the headers out when the stored ones are kept', async () => {
		const { event, calls } = actionEvent(
			{ kind: 'otlp', url: 'https://otlp.example.com/v2', headers_mode: 'keep' },
			{ '/telemetry/destination': () => json(STORED) },
			['admin'],
		);
		expect(await actions.saveDestination(event)).toEqual({ savedDestination: true });
		expect(bodyOf(calls)).toEqual({ kind: 'otlp', url: 'https://otlp.example.com/v2' });
	});

	it('sends the headers entered when they are replaced', async () => {
		const body = new FormData();
		for (const [k, v] of [
			['kind', 'pushgateway'],
			['url', 'https://push.example.com'],
			['headers_mode', 'replace'],
			['header_name', 'Authorization'],
			['header_value', 'Bearer abc'],
			['header_name', ''],
			['header_value', 'ignored'],
		]) body.append(k, v);
		const { fetch, calls } = fetchFor({ '/telemetry/destination': () => json(STORED) }, ['admin']);
		const event = {
			fetch,
			cookies: mockCookies(),
			request: new Request('http://localhost/admin/observability/telemetry', { method: 'POST', body }),
		} as never;
		await actions.saveDestination(event);
		expect(bodyOf(calls)).toEqual({
			kind: 'pushgateway',
			url: 'https://push.example.com',
			headers: { Authorization: 'Bearer abc' },
		});
	});

	it('refuses a header the exporter sets itself', async () => {
		const { event, calls } = actionEvent(
			{ kind: 'otlp', url: 'https://x.example.com', headers_mode: 'replace', header_name: 'Content-Type', header_value: 'x' },
			{},
			['admin'],
		);
		const result = (await actions.saveDestination(event)) as { status: number; data: { destinationAction: string } };
		expect(result.status).toBe(400);
		expect(result.data.destinationAction).toBe('save');
		expect(bodyOf(calls)).toBeNull();
	});

	it('marks the refusal to carry stored headers to another host', async () => {
		const { event } = actionEvent(
			{ kind: 'otlp', url: 'https://elsewhere.example.net', headers_mode: 'keep' },
			{
				'/telemetry/destination': () =>
					json({ error: 'the destination moved to another host, send its headers again', code: 'telemetry.headers_required' }, 422),
			},
			['admin'],
		);
		const result = (await actions.saveDestination(event)) as { status: number; data: { hostMoved: boolean } };
		expect(result.status).toBe(422);
		expect(result.data.hostMoved).toBe(true);
	});

	it('relays any other 422 without asking for the headers', async () => {
		const { event } = actionEvent(
			{ kind: 'otlp', url: 'https://elsewhere.example.net', headers_mode: 'keep' },
			{
				'/telemetry/destination': () =>
					refused(422, 'the destination is on a network this instance does not send to', 'http_422'),
			},
			['admin'],
		);
		const result = (await actions.saveDestination(event)) as {
			status: number;
			data: { hostMoved?: boolean; destinationError: string };
		};
		expect(result.data.hostMoved).toBeUndefined();
		expect(result.data.destinationError).toBe('the destination is on a network this instance does not send to');
	});

	it('returns the license refusal under its own keys', async () => {
		const { event } = actionEvent(
			{ kind: 'otlp', url: 'https://x.example.com', headers_mode: 'replace' },
			{
				'/telemetry/destination': () =>
					json({ error: 'payment_required', plugin: 'telemetry', feature: 'feature:example_feature', upgrade_url: '' }, 402),
			},
			['admin'],
		);
		const result = (await actions.saveDestination(event)) as {
			status: number;
			data: { refused: { kind: string }; error?: string };
		};
		expect(result.status).toBe(402);
		expect(result.data.refused.kind).toBe('feature');
		expect(result.data.error).toBeUndefined();
	});

	// The save and the delete share one form result on the page, so each
	// failure says which write it came from.
	it('tags a failed delete as the delete', async () => {
		const { event } = actionEvent(
			{},
			{ '/telemetry/destination': () => refused(503, 'tenant destinations are unavailable', 'service_unavailable') },
			['admin'],
		);
		const result = (await actions.removeDestination(event)) as {
			status: number;
			data: { destinationAction: string; destinationError: string };
		};
		expect(result.data.destinationAction).toBe('remove');
		expect(result.data.destinationError).toBeTruthy();
	});

	it('tags a failed save as the save', async () => {
		const { event } = actionEvent(
			{ kind: 'otlp', url: 'https://otlp.example.com/v1/metrics', headers_mode: 'replace' },
			{ '/telemetry/destination': () => refused(503, 'tenant destinations are unavailable', 'service_unavailable') },
			['admin'],
		);
		const result = (await actions.saveDestination(event)) as { data: { destinationAction: string } };
		expect(result.data.destinationAction).toBe('save');
	});
});
