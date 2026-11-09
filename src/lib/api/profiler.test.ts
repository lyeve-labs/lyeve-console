import { describe, expect, it, vi } from 'vitest';
import type { HttpClient } from '@lyeve-labs/client';
import {
	PROFILER_ROOT,
	captureFlamegraph,
	clampSeconds,
	formatNs,
	isProfileType,
	latencyTone,
	listEndpoints,
	listPlugins,
	listSlowest,
	readEndpoint,
	readMemoryTrend,
	resetProfiler,
} from './profiler';

function client(answer: unknown): HttpClient {
	return { get: vi.fn(async () => answer), post: vi.fn(async () => answer) } as unknown as HttpClient;
}

const STATS = {
	endpoint: '/api/v1/content',
	method: 'GET',
	count: 4,
	avg_duration_ns: 1_500_000,
	p50_duration_ns: 1_000_000,
	p95_duration_ns: 2_000_000,
	p99_duration_ns: 3_000_000,
	max_duration_ns: 4_000_000,
	avg_alloc_bytes: 2048,
	total_alloc_bytes: 8192,
	last_seen: '2026-09-21T10:00:00Z',
};

describe('the profiler reads', () => {
	// The routes sit under the debug subtree.
	it('read the views under /api/admin/debug/profiler', async () => {
		expect(PROFILER_ROOT).toBe('/api/admin/debug/profiler');

		const c = client({ endpoints: [STATS], count: 1, slowest: [STATS], plugins: [{ plugin: 'core', count: 4 }] });
		expect(await listEndpoints(c)).toEqual([STATS]);
		expect(c.get).toHaveBeenLastCalledWith('/api/admin/debug/profiler/endpoints');
		expect(await listSlowest(c)).toEqual([STATS]);
		expect(c.get).toHaveBeenLastCalledWith('/api/admin/debug/profiler/slowest');
		expect(await listPlugins(c)).toEqual([{ plugin: 'core', count: 4 }]);
		expect(c.get).toHaveBeenLastCalledWith('/api/admin/debug/profiler/plugins');
	});

	it('answer an empty or null view as an empty list rather than a fault', async () => {
		expect(await listEndpoints(client(null))).toEqual([]);
		expect(await listSlowest(client({ slowest: null }))).toEqual([]);
		expect(await listPlugins(client({}))).toEqual([]);
		expect(await readMemoryTrend(client(null))).toBeNull();
	});

	it('read the memory trend with its snapshots as a list', async () => {
		const trend = await readMemoryTrend(client({ snapshots: null, slope_bytes_per_sec: 12, leak_likely: false }));
		expect(trend).toEqual({ snapshots: [], slope_bytes_per_sec: 12, leak_likely: false });
	});

	// An endpoint is a path. It rides as the wildcard tail the engine mounts,
	// segment by segment, so a slash stays a slash and the route resolves.
	it('name the endpoint as the wildcard tail with its leading slash dropped', async () => {
		const c = client({ endpoint: '/api/v1/content', methods: [], total_count: 0, limit: 100, offset: 0 });
		await readEndpoint(c, '/api/v1/content');
		expect(c.get).toHaveBeenCalledWith('/api/admin/debug/profiler/endpoint/api/v1/content?limit=100');
		await readEndpoint(c, 'api/v1/content?x', 5);
		expect(c.get).toHaveBeenLastCalledWith('/api/admin/debug/profiler/endpoint/api/v1/content%3Fx?limit=5');
	});
});

describe('the profiler writes', () => {
	it('reset posts with no body', async () => {
		const c = client({ status: 'reset' });
		await resetProfiler(c);
		expect(c.post).toHaveBeenCalledWith('/api/admin/debug/profiler/reset', undefined);
	});

	it('the flamegraph posts the endpoint tail and the window, and waits past the window', async () => {
		const c = client({ endpoint: '/api/v1/content', duration_sec: 3, svg: '<svg/>', profile_type: 'cpu', captured_at: 'now' });
		const graph = await captureFlamegraph(c, '/api/v1/content', 3);
		expect(graph.svg).toBe('<svg/>');
		const [url, body, init] = (c.post as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
		expect(url).toBe('/api/admin/debug/profiler/flamegraph/api/v1/content?duration_sec=3');
		expect(body).toBeUndefined();
		expect((init as { signal: AbortSignal }).signal).toBeInstanceOf(AbortSignal);
	});
});

describe('the bounds and the formats', () => {
	it('clamps a capture window to the engine bound and defaults an absent one', () => {
		expect(clampSeconds('5')).toBe(5);
		expect(clampSeconds('0')).toBe(1);
		expect(clampSeconds('99')).toBe(25);
		expect(clampSeconds('7.9')).toBe(7);
		expect(clampSeconds(null)).toBe(5);
		expect(clampSeconds('')).toBe(5);
		expect(clampSeconds('abc')).toBe(5);
	});

	it('knows the four profile types and nothing else', () => {
		expect(['cpu', 'goroutine', 'heap', 'allocs'].every(isProfileType)).toBe(true);
		expect(isProfileType('threadcreate')).toBe(false);
		expect(isProfileType('')).toBe(false);
	});

	it('formats nanoseconds at the unit that reads', () => {
		expect(formatNs(2_500_000_000)).toBe('2.50 s');
		expect(formatNs(1_500_000)).toBe('1.5 ms');
		expect(formatNs(1_500)).toBe('2 µs');
		expect(formatNs(400)).toBe('400 ns');
		expect(formatNs(Number.NaN)).toBe('');
	});

	it('tones a p95 by the second, the tenth and the hundredth', () => {
		expect(latencyTone(1e9)).toBe('danger');
		expect(latencyTone(2e8)).toBe('warn');
		expect(latencyTone(5e7)).toBe('neutral');
		expect(latencyTone(1e6)).toBe('success');
	});
});
