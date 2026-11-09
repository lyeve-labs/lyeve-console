import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@lyeve-labs/client';

const engine = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
const authz = vi.hoisted(() => ({ roles: ['admin'] as string[] }));
vi.mock('$lib/server/authz', async (importOriginal) => ({
	...((await importOriginal()) as object),
	authedClient: vi.fn(() => engine),
	requireRole: vi.fn(async (_event: unknown, allowed: string[]) => {
		if (!allowed.some((r) => authz.roles.includes(r))) throw new Error('403');
		return { id: 'u1', roles: authz.roles };
	}),
}));

import { actions, load } from './+page.server';

type Loaded = Exclude<Awaited<ReturnType<typeof load>>, void>;
type Failure = { status: number; data: Record<string, unknown> };

const PROBE = { id: 'p1', name: 'Homepage', type: 'health_check', enabled: true, config: {}, interval_seconds: 300, timeout_seconds: 10, alert_threshold: 3 };

function loadEvent(query = '') {
	return {
		url: new URL(`http://localhost/admin/observability/synthetic${query}`),
		parent: async () => ({ plugins: { state: 'named', running: ['synthetic-monitoring'], withheld: [] } }),
	} as never;
}

function actionEvent(fields: Record<string, string>) {
	const data = new FormData();
	data.set('confirmed', 'yes');
	for (const [k, v] of Object.entries(fields)) data.set(k, v);
	return { request: { formData: async () => data, clone: () => ({ formData: async () => data }) } } as never;
}

/** An event whose request can be read twice, as the update action reads it. */
function requestEvent(fields: Record<string, string>) {
	const body = new FormData();
	for (const [k, v] of Object.entries(fields)) body.set(k, v);
	return { request: new Request('http://localhost/admin/observability/synthetic', { method: 'POST', body }) } as never;
}

function route(channels: unknown) {
	engine.get.mockImplementation(async (url: string) => {
		if (url.includes('/alert-channels')) {
			if (channels instanceof Error) throw channels;
			return channels;
		}
		if (url.includes('/probes')) return { data: [PROBE], total_count: 1 };
		if (url.includes('/alerts')) return [];
		throw new ApiError(404, 'not found', {});
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	authz.roles = ['admin'];
});

describe('the notice channels load', () => {
	it('reads no channels until the address names a probe', async () => {
		route({ channels: {}, licensed: true });
		const out = (await load(loadEvent())) as Loaded;
		expect(out.channelsFor).toBeNull();
		expect(engine.get.mock.calls.some(([u]) => String(u).includes('/alert-channels'))).toBe(false);
	});

	it('reads the named probe channels and whether a paid one would be taken', async () => {
		route({ channels: { email: ['ops@example.com'], slack_url: 'https://hooks.slack.com/...1a2b' }, licensed: false });
		const out = (await load(loadEvent('?channels=p1'))) as Loaded;
		expect(engine.get).toHaveBeenCalledWith('/api/admin/synthetic-monitoring/probes/p1/alert-channels');
		expect(out.channelsFor?.read).toEqual({
			channels: { email: ['ops@example.com'], slack_url: 'https://hooks.slack.com/...1a2b' },
			licensed: false,
		});
	});

	it('keeps the probes when the channels read fails, and says so in the drawer', async () => {
		route(new ApiError(500, 'internal error', {}));
		const out = (await load(loadEvent('?channels=p1'))) as Loaded;
		expect(out.probes).toHaveLength(1);
		expect(out.channelsFor).toMatchObject({ read: null, gate: { state: 'error' } });
	});
});

describe('saving notice channels', () => {
	it('puts the channels, a masked value as it was read', async () => {
		engine.put.mockResolvedValue({ channels: {}, licensed: true });
		await actions.channels(actionEvent({ id: 'p1', channel_email: 'ops@example.com', channel_pagerduty_routing_key: '...cdef' }));
		expect(engine.put).toHaveBeenCalledWith('/api/admin/synthetic-monitoring/probes/p1/alert-channels', {
			email: ['ops@example.com'],
			pagerduty_routing_key: '...cdef',
		});
	});

	it('clears every channel with null when the form names none', async () => {
		engine.put.mockResolvedValue({ channels: {}, licensed: true });
		await actions.channels(actionEvent({ id: 'p1', channel_email: '' }));
		expect(engine.put.mock.calls[0][1]).toBeNull();
	});

	it('keeps a refusal in the drawer that asked', async () => {
		engine.put.mockRejectedValue(
			new ApiError(402, 'payment_required', { error: 'payment_required', plugin: 'synthetic-monitoring', feature: 'feature:example_feature' }),
		);
		const out = (await actions.channels(actionEvent({ id: 'p1', channel_slack_url: 'https://hooks.slack.com/services/x' }))) as Failure;
		expect(out.status).toBe(402);
		expect(out.data).toMatchObject({ channels: true, refused: { kind: 'feature', feature: 'example-feature' } });
	});

	it('answers the signing secret a new webhook URL got', async () => {
		engine.put.mockResolvedValue({ channels: { webhook_url: 'https://ops.example.com/...abcd' }, licensed: true, webhook_signing_secret: 'k'.repeat(64) });
		const out = await actions.channels(actionEvent({ id: 'p1', channel_webhook_url: 'https://ops.example.com/probe' }));
		expect(out).toEqual({ channelsSaved: 'p1', signingSecret: 'k'.repeat(64) });
	});
});

describe('running a probe now', () => {
	it('reports a run that failed in one of its regions as failed', async () => {
		engine.post.mockResolvedValue([
			{ id: 'r1', probe_id: 'p1', status: 'pass', response_time_ms: 90, region: 'us-east', created_at: '' },
			{ id: 'r2', probe_id: 'p1', status: 'fail', response_time_ms: 3000, region: 'eu-west', created_at: '' },
		]);
		const out = await actions.run(actionEvent({ id: 'p1' }));
		expect(engine.post).toHaveBeenCalledWith('/api/admin/synthetic-monitoring/probes/p1/run', {}, {
			signal: expect.any(AbortSignal),
		});
		expect(out).toEqual({ ran: 'p1', status: 'fail', ms: 3000, failed: 1, regions: 2 });
	});

	// The run goes on after the wait ends, so no answer is not a failure.
	it('reports a run that outlasted the wait as still going', async () => {
		engine.post.mockRejectedValue(new DOMException('The operation timed out.', 'TimeoutError'));
		expect(await actions.run(actionEvent({ id: 'p1' }))).toEqual({ running: 'p1', already: false });
	});

	it('reports a dropped connection as a run still going', async () => {
		engine.post.mockRejectedValue(new TypeError('fetch failed'));
		expect(await actions.run(actionEvent({ id: 'p1' }))).toEqual({ running: 'p1', already: false });
	});

	it('reports a conflict as a run of the probe already going', async () => {
		engine.post.mockRejectedValue(new ApiError(409, 'probe run already in progress for this probe', {}));
		expect(await actions.run(actionEvent({ id: 'p1' }))).toEqual({ running: 'p1', already: true });
	});

	it('keeps an engine failure a failure in the console\'s own words', async () => {
		engine.post.mockRejectedValue(new ApiError(503, 'down', {}));
		const out = (await actions.run(actionEvent({ id: 'p1' }))) as unknown as Failure;
		expect(out.status).toBe(400);
		expect(out.data.error).toBe('Could not run the probe. Try again.');
	});
});

describe('the probe limits load', () => {
	it('hands the form the floor the plugin answers', async () => {
		route({ channels: {}, licensed: true });
		const probesOnly = engine.get.getMockImplementation()!;
		engine.get.mockImplementation(async (url: string) =>
			url.endsWith('/limits') ? { probes: { limit: 0, current: 1 }, min_interval_seconds: 15 } : probesOnly(url),
		);
		const out = (await load(loadEvent())) as Loaded;
		expect(out.limits).toEqual({ probes: { limit: 0, current: 1 }, minIntervalSeconds: 15 });
	});

	it('keeps the page when the limits cannot be read', async () => {
		route({ channels: {}, licensed: true });
		const out = (await load(loadEvent())) as Loaded;
		expect(out.probes).toHaveLength(1);
		expect(out.limits).toBeNull();
	});
});

describe('saving a probe', () => {
	// The plugin holds the floor for the install's license and refuses with
	// the reason, so the console no longer refuses an interval of its own.
	it('sends a short interval for the plugin to accept or refuse', async () => {
		engine.post.mockResolvedValue(PROBE);
		await actions.create(
			actionEvent({ name: 'Homepage', type: 'health_check', url: 'https://example.com', interval_seconds: '15', timeout_seconds: '10' }),
		);
		expect(engine.post).toHaveBeenCalledWith(
			'/api/admin/synthetic-monitoring/probes',
			expect.objectContaining({ interval_seconds: 15 }),
		);
	});
});

describe('the probe list load', () => {
	// The plugin answers the open alerts as a bare array.
	it('reads an open alert out of the bare array the plugin answers', async () => {
		const open = { id: 'a1', probe_id: 'p1', probe_name: 'Homepage', probe_type: 'health_check', consecutive_failures: 3, last_failure_at: '2026-10-01T00:00:00Z', message: 'down', acknowledged: false, created_at: '2026-10-01T00:00:00Z' };
		engine.get.mockImplementation(async (url: string) => {
			if (url.includes('/probes')) return { data: [PROBE], total_count: 1 };
			if (url.includes('/alerts')) return [open];
			throw new ApiError(404, 'not found', {});
		});
		const out = (await load(loadEvent())) as Loaded;
		expect(out.alerts).toEqual({ ok: true, value: [open] });
	});

	it('keeps a failed alert read as a gate rather than no alerts', async () => {
		engine.get.mockImplementation(async (url: string) => {
			if (url.includes('/probes')) return { data: [PROBE], total_count: 1 };
			if (url.includes('/alerts')) throw new ApiError(503, 'down', {});
			throw new ApiError(404, 'not found', {});
		});
		const out = (await load(loadEvent())) as Loaded;
		expect(out.alerts).toEqual({ ok: false, gate: { state: 'unavailable' } });
		expect(out.probes).toHaveLength(1);
	});

	it('sends an offset past the end back to the last page', async () => {
		engine.get.mockImplementation(async (url: string) => {
			if (url.includes('/probes')) return { data: [], total_count: 30 };
			if (url.includes('/alerts')) return [];
			throw new ApiError(404, 'not found', {});
		});
		await expect(load(loadEvent('?limit=25&offset=200'))).rejects.toMatchObject({
			status: 307,
			location: expect.stringContaining('offset=25'),
		});
	});
});

describe('a plugin that answers every probe', () => {
	// The plugin ignores the window and answers a bare array of every probe.
	// Read as one page, page two repeated page one.
	const many = Array.from({ length: 30 }, (_, i) => ({ ...PROBE, id: `p${i}`, name: `probe ${i}`, enabled: i % 10 !== 0 }));

	it('cuts the page from every probe and counts them all', async () => {
		engine.get.mockImplementation(async (url: string) => {
			if (url.includes('/probes')) return many;
			if (url.includes('/alerts')) return [];
			throw new ApiError(404, 'not found', {});
		});
		const out = (await load(loadEvent('?limit=25&offset=25'))) as Loaded;
		expect(out.probes.map((p: { id: string }) => p.id)).toEqual(['p25', 'p26', 'p27', 'p28', 'p29']);
		expect(out.total).toBe(30);
		expect(out.hasMore).toBe(false);
		expect(out.counts?.paused).toBe(3);
	});

	it('sends an offset past every probe back to the last page', async () => {
		engine.get.mockImplementation(async (url: string) => {
			if (url.includes('/probes')) return many;
			if (url.includes('/alerts')) return [];
			throw new ApiError(404, 'not found', {});
		});
		await expect(load(loadEvent('?limit=25&offset=100'))).rejects.toMatchObject({
			status: 307,
			location: expect.stringContaining('offset=25'),
		});
	});
});

describe('which surface a failure belongs to', () => {
	it('tags a failed probe save for the probe drawer', async () => {
		const out = (await actions.create(actionEvent({ name: '' }))) as { data: Record<string, unknown> };
		expect(out.data.drawer).toBe('probe');
	});
});

describe('editing a probe', () => {
	const LOGIN = {
		id: 'p2',
		name: 'Sign in',
		type: 'login_flow',
		config: {
			login_url: 'https://example.com/login',
			username: 'probe',
			password: '***',
			headers: { 'X-Probe': 'yes', Authorization: '***' },
			payload: { a: 1 },
		},
		regions: ['us-east', 'eu-west'],
	};
	const fields = (over: Record<string, string> = {}) => ({
		id: 'p2',
		name: 'Sign in',
		type: 'login_flow',
		login_url: 'https://example.com/login',
		username: 'probe',
		expected_redirect: '/home',
		interval_seconds: '300',
		timeout_seconds: '10',
		enabled: 'true',
		kept: JSON.stringify({ config: LOGIN.config, regions: LOGIN.regions }),
		secret: 'hunter2',
		...over,
	});

	// The plugin replaces the stored config and regions whole, so what the
	// form does not show travels back from the read.
	it('sends back the regions and every config key the form does not show', async () => {
		engine.put.mockResolvedValue(LOGIN);
		expect(await actions.update(requestEvent(fields()))).toEqual({ saved: 'Sign in' });
		const [url, body] = engine.put.mock.calls[0];
		expect(url).toBe('/api/admin/synthetic-monitoring/probes/p2');
		expect(body.regions).toEqual(['us-east', 'eu-west']);
		expect(body.config).toMatchObject({ payload: { a: 1 }, headers: { 'X-Probe': 'yes' }, expected_redirect: '/home' });
		// Sending the mask back would store the mask as the secret.
		expect(body.config.headers.Authorization).toBeUndefined();
	});

	// The read masks the stored secret and the plugin replaces the config
	// whole, so a save without the secret would erase it.
	it('refuses a save that would erase the stored password', async () => {
		const out = (await actions.update(requestEvent(fields({ secret: '' })))) as Failure;
		expect(out.status).toBe(400);
		expect(out.data).toMatchObject({ drawer: 'probe' });
		expect(String(out.data.error)).toContain('Enter the password again');
		expect(engine.put).not.toHaveBeenCalled();
	});

	it("refuses a save that would erase a canary's stored auth token", async () => {
		const kept = JSON.stringify({ config: { endpoint_base: 'https://example.com', auth_token: '***' }, regions: [] });
		const out = (await actions.update(
			requestEvent(fields({ type: 'api_canary', endpoint_base: 'https://example.com', kept, secret: '' })),
		)) as Failure;
		expect(out.status).toBe(400);
		expect(String(out.data.error)).toContain('stored auth token');
		expect(engine.put).not.toHaveBeenCalled();
	});

	it('sends the password typed in the form', async () => {
		engine.put.mockResolvedValue(LOGIN);
		await actions.update(requestEvent(fields({ secret: 'hunter2' })));
		expect(engine.put.mock.calls[0][1].config.password).toBe('hunter2');
	});

	it('refuses a save that names no probe', async () => {
		const out = (await actions.update(requestEvent(fields({ id: '' })))) as Failure;
		expect(out.status).toBe(400);
		expect(engine.put).not.toHaveBeenCalled();
	});

	it('refuses a role the plugin does not admit', async () => {
		authz.roles = ['editor'];
		await expect(actions.update(requestEvent(fields()))).rejects.toThrow('403');
	});

	it("relays the plugin's refusal into the drawer", async () => {
		engine.put.mockRejectedValue(new ApiError(400, 'probe target is not allowed', { error: 'probe target is not allowed', code: 'bad_request' }));
		const out = (await actions.update(requestEvent(fields()))) as Failure;
		expect(out.data).toMatchObject({ error: 'probe target is not allowed', drawer: 'probe' });
	});

	it('says an outage failed the save', async () => {
		engine.put.mockRejectedValue(new ApiError(503, 'down', {}));
		const out = (await actions.update(requestEvent(fields()))) as Failure;
		expect(out.data).toMatchObject({ error: 'Could not save the probe. Try again.', drawer: 'probe' });
	});
});

describe('deleting a probe', () => {
	it('deletes the probe it names', async () => {
		engine.delete.mockResolvedValue(undefined);
		expect(await actions.delete(actionEvent({ id: 'p1' }))).toEqual({ removed: 'p1' });
		expect(engine.delete).toHaveBeenCalledWith('/api/admin/synthetic-monitoring/probes/p1');
	});

	it('refuses a role the plugin does not admit', async () => {
		authz.roles = ['editor'];
		await expect(actions.delete(actionEvent({ id: 'p1' }))).rejects.toThrow('403');
		expect(engine.delete).not.toHaveBeenCalled();
	});

	it("relays the plugin's refusal", async () => {
		engine.delete.mockRejectedValue(new ApiError(404, 'probe not found', { error: 'probe not found', code: 'not_found' }));
		const out = (await actions.delete(actionEvent({ id: 'p1' }))) as Failure;
		expect(out.data.error).toBe('probe not found');
	});

	it('says an outage failed the delete', async () => {
		engine.delete.mockRejectedValue(new ApiError(503, 'down', {}));
		const out = (await actions.delete(actionEvent({ id: 'p1' }))) as Failure;
		expect(out.data.error).toBe('Could not delete the probe. Try again.');
	});
});

describe('acknowledging an alert', () => {
	it('acknowledges the alert it names', async () => {
		engine.post.mockResolvedValue({});
		expect(await actions.acknowledge(actionEvent({ id: 'a1' }))).toEqual({ acknowledged: 'a1' });
		expect(engine.post.mock.calls[0][0]).toBe('/api/admin/synthetic-monitoring/alerts/a1/acknowledge');
	});

	it('refuses a role the plugin does not admit', async () => {
		authz.roles = ['editor'];
		await expect(actions.acknowledge(actionEvent({ id: 'a1' }))).rejects.toThrow('403');
	});

	it("relays the plugin's refusal", async () => {
		engine.post.mockRejectedValue(new ApiError(404, 'alert not found', { error: 'alert not found', code: 'not_found' }));
		const out = (await actions.acknowledge(actionEvent({ id: 'a1' }))) as Failure;
		expect(out.data.error).toBe('alert not found');
	});

	it('says an outage failed the acknowledgment', async () => {
		engine.post.mockRejectedValue(new TypeError('fetch failed'));
		const out = (await actions.acknowledge(actionEvent({ id: 'a1' }))) as Failure;
		expect(out.data.error).toBe('Could not acknowledge the alert. Try again.');
	});
});
