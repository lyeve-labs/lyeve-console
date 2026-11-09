import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@lyeve-labs/client';
import {
	everyLabel,
	intervalHint,
	listOpenAlerts,
	readProbeLimits,
	runAlreadyGoing,
	runGoingOnText,
	runOutcome,
	runOutlastedTheWait,
	runProbeNow,
	probeHealth,
	probeTarget,
	probeTone,
	probeType,
	type Probe,
	type ProbeResult,
} from './synthetic';

function probe(over: Partial<Probe> = {}): Probe {
	return {
		id: 'p1',
		tenant_id: 'default',
		name: 'Homepage',
		type: 'health_check',
		enabled: true,
		config: { url: 'https://example.com/healthz', expected_status: 200 },
		interval_seconds: 300,
		timeout_seconds: 10,
		regions: null,
		alert_threshold: 3,
		last_run_at: '2026-09-22T10:00:00Z',
		last_status: 'pass',
		created_at: '2026-09-01T00:00:00Z',
		updated_at: '2026-09-01T00:00:00Z',
		...over,
	};
}

describe('what a probe row says about itself', () => {
	it('separates passing from failing', () => {
		expect(probeHealth(probe())).toBe('passing');
		expect(probeHealth(probe({ last_status: 'fail' }))).toBe('failing');
	});

	// A paused probe's last pass is as stale as the pause is long. Reading it
	// as green is how an outage goes unnoticed on a dashboard.
	it('lets paused outrank a stale pass', () => {
		expect(probeHealth(probe({ enabled: false, last_status: 'pass' }))).toBe('paused');
		expect(probeHealth(probe({ enabled: false, last_status: 'fail' }))).toBe('paused');
		expect(probeTone('paused')).toBe('neutral');
	});

	// No result is not a good result.
	it('says never run rather than passing when there is no result', () => {
		expect(probeHealth(probe({ last_run_at: null, last_status: null }))).toBe('unrun');
		expect(probeHealth(probe({ last_run_at: '2026-09-22T10:00:00Z', last_status: null }))).toBe('unrun');
		expect(probeTone('unrun')).toBe('warn');
	});

	it('uses the kit vocabulary for every level', () => {
		expect(probeTone('passing')).toBe('success');
		expect(probeTone('failing')).toBe('danger');
	});
});

describe('what a probe checks', () => {
	// Two health checks against different URLs are different probes. Naming
	// only the type would print the same row twice.
	it('reads the target out of the config, per type', () => {
		expect(probeTarget(probe())).toBe('https://example.com/healthz');
		expect(
			probeTarget(
				probe({ type: 'api_canary', config: { endpoint_base: 'https://a.example.com', resource_path: '/v1/x' } }),
			),
		).toBe('https://a.example.com/v1/x');
		expect(probeTarget(probe({ type: 'login_flow', config: { login_url: 'https://a/login' } }))).toBe(
			'https://a/login',
		);
		expect(probeTarget(probe({ type: 'webhook_delivery', config: { webhook_url: 'https://a/hook' } }))).toBe(
			'https://a/hook',
		);
	});

	it('says what is missing rather than printing an empty cell', () => {
		expect(probeTarget(probe({ config: {} }))).toBe('No URL set');
		expect(probeTarget(probe({ type: 'api_canary', config: {} }))).toBe('No endpoint set');
	});
});

describe('intervals in words', () => {
	// The number on screen is the one somebody compares against an alerting
	// threshold elsewhere, so it is exact or it is in seconds.
	it('rounds nothing', () => {
		expect(everyLabel(60)).toBe('Every 1 minute');
		expect(everyLabel(300)).toBe('Every 5 minutes');
		expect(everyLabel(3600)).toBe('Every 1 hour');
		expect(everyLabel(7200)).toBe('Every 2 hours');
		expect(everyLabel(90)).toBe('Every 90 seconds');
		expect(everyLabel(45)).toBe('Every 45 seconds');
	});

	it('says a probe is not scheduled rather than running every zero seconds', () => {
		expect(everyLabel(0)).toBe('Not scheduled');
		expect(everyLabel(-1)).toBe('Not scheduled');
		expect(everyLabel(Number.NaN)).toBe('Not scheduled');
	});
});

describe('the type the form may send', () => {
	it('accepts the four the engine runs and refuses the rest', () => {
		expect(probeType('health_check')).toBe('health_check');
		expect(probeType('webhook_delivery')).toBe('webhook_delivery');
		expect(probeType('ping')).toBeNull();
		expect(probeType('')).toBeNull();
	});
});

function result(over: Partial<ProbeResult> = {}): ProbeResult {
	return {
		id: 'r1',
		probe_id: 'p1',
		status: 'pass',
		response_time_ms: 120,
		region: 'us-east',
		created_at: '2026-09-22T10:00:00Z',
		...over,
	};
}

function fakeClient(answer: unknown) {
	const calls: string[] = [];
	const respond = async (url: string) => {
		calls.push(url);
		return answer;
	};
	return { calls, client: { get: respond, post: respond } as never };
}

describe('a run now', () => {
	// The plugin answers one result per region. Read as a single result, the
	// array had no status, so a failing run was reported as passing in 0 ms.
	it('reads the array of results the plugin answers', async () => {
		const { client } = fakeClient([result(), result({ id: 'r2', region: 'eu-west', status: 'fail' })]);
		const results = await runProbeNow(client, 'p1');
		expect(results).toHaveLength(2);
	});

	it('fails when any region failed, timed by the slowest region', () => {
		expect(
			runOutcome([
				result({ response_time_ms: 80 }),
				result({ id: 'r2', status: 'fail', response_time_ms: 2400 }),
			]),
		).toEqual({ status: 'fail', ms: 2400, failed: 1, regions: 2 });
		expect(runOutcome([result()])).toEqual({ status: 'pass', ms: 120, failed: 0, regions: 1 });
	});

	it('says nothing passed when no result was recorded', () => {
		expect(runOutcome([]).status).toBeNull();
	});

	// A run that fails in several regions outlasts the client's default wait,
	// so Run now names a wait of its own that ends past the engine's.
	it('waits past the default for a long run', async () => {
		const post = vi.fn(async () => []);
		await runProbeNow({ post } as never, 'p1');
		expect(post).toHaveBeenCalledWith('/api/admin/synthetic-monitoring/probes/p1/run', {}, {
			signal: expect.any(AbortSignal),
		});
	});

	it('reads a request that got no answer as a run still going', () => {
		expect(runOutlastedTheWait(new DOMException('The operation timed out.', 'TimeoutError'))).toBe(true);
		expect(runOutlastedTheWait(new DOMException('This operation was aborted', 'AbortError'))).toBe(true);
		expect(runOutlastedTheWait(new TypeError('fetch failed'))).toBe(true);
		expect(runOutlastedTheWait(new ApiError(503, 'down', {}))).toBe(false);
		expect(runOutlastedTheWait(new ApiError(409, 'busy', {}))).toBe(false);
		expect(runOutlastedTheWait(new SyntaxError('Unexpected token'))).toBe(false);
	});

	it('reads a conflict as a run of the probe already going', () => {
		expect(runAlreadyGoing(new ApiError(409, 'busy', {}))).toBe(true);
		expect(runAlreadyGoing(new ApiError(503, 'down', {}))).toBe(false);
		expect(runAlreadyGoing(new TypeError('fetch failed'))).toBe(false);
	});

	it('says where the results of a run still going appear', () => {
		expect(runGoingOnText('Homepage', false)).toBe(
			'Homepage is still running. Its results appear in the list when it finishes.',
		);
		expect(runGoingOnText('Homepage', true)).toBe(
			'Homepage is already running. Its results appear in the list when it finishes.',
		);
	});
});

describe('the probe limits', () => {
	it('reads the floor and the ceiling the plugin answers', async () => {
		const { client, calls } = fakeClient({ probes: { limit: 3, current: 2 }, min_interval_seconds: 300 });
		expect(await readProbeLimits(client)).toEqual({ probes: { limit: 3, current: 2 }, minIntervalSeconds: 300 });
		expect(calls).toEqual(['/api/admin/synthetic-monitoring/limits']);
	});

	it('reads an answer without a floor as unknown', async () => {
		expect(await readProbeLimits(fakeClient({ probes: { limit: 0, current: 4 } }).client)).toBeNull();
	});

	it('puts the floor in the hint only when it is known', () => {
		expect(intervalHint({ probes: { limit: 0, current: 0 }, minIntervalSeconds: 15 })).toBe(
			'At least 15. Each probe sends a request to this engine.',
		);
		expect(intervalHint(null)).toBe('Each probe sends a request to this engine.');
	});
});

describe('the open alerts', () => {
	// The plugin answers a bare array, which the callers read as a list envelope.
	it('reads a bare array as an envelope', async () => {
		const alert = { id: 'a1', probe_id: 'p1' };
		expect(await listOpenAlerts(fakeClient([alert]).client)).toEqual({ data: [alert], total_count: 1 });
	});
});
