/**
 * The profiler plugin's request profiler under /api/admin/debug/profiler.
 *
 * Every route is super_admin: the views describe every tenant's traffic
 * and the heap and allocs exports carry raw process memory. Durations
 * arrive in nanoseconds as the sampler records them. The page formats them
 * and never sends one back.
 */
import type { StatusTone } from '@lyeve-labs/ui-kit';
import type { HttpClient } from '@lyeve-labs/client';
import { formatMillis } from '$lib/format';

export const PROFILER_ROOT = '/api/admin/debug/profiler';

/** The profiler clamps a capture to this many seconds. */
export const PROFILE_SECONDS = { min: 1, max: 25, default: 5 } as const;

export const PROFILE_TYPES = ['cpu', 'goroutine', 'heap', 'allocs'] as const;
export type ProfileType = (typeof PROFILE_TYPES)[number];

export function isProfileType(v: string): v is ProfileType {
	return (PROFILE_TYPES as readonly string[]).includes(v);
}

export interface EndpointStats {
	endpoint: string;
	method: string;
	count: number;
	avg_duration_ns: number;
	p50_duration_ns: number;
	p95_duration_ns: number;
	p99_duration_ns: number;
	max_duration_ns: number;
	avg_alloc_bytes: number;
	total_alloc_bytes: number;
	last_seen: string;
}

export interface ProfileEntry {
	plugin: string;
	endpoint: string;
	method: string;
	duration_ns: number;
	status_code: number;
	alloc_bytes: number;
	total_alloc: number;
	heap_alloc: number;
	heap_objects: number;
	num_gc: number;
	num_goroutine: number;
	captured_at: string;
}

export interface MethodStats {
	method: string;
	count: number;
	stats: EndpointStats;
	recent_entries: ProfileEntry[];
}

export interface EndpointDetail {
	endpoint: string;
	methods: MethodStats[];
	total_count: number;
	limit: number;
	offset: number;
}

export interface PluginBreakdown {
	plugin: string;
	count: number;
	avg_duration_ns: number;
	max_duration_ns: number;
	total_alloc_bytes: number;
}

export interface MemorySnapshot {
	timestamp: string;
	heap_alloc: number;
	heap_objects: number;
	total_alloc: number;
	num_gc: number;
	num_goroutine: number;
}

export interface MemoryTrend {
	snapshots: MemorySnapshot[];
	slope_bytes_per_sec: number;
	leak_likely: boolean;
	leak_reason?: string;
}

export interface Flamegraph {
	endpoint: string;
	duration_sec: number;
	svg: string;
	profile_type: string;
	captured_at: string;
}

export async function listEndpoints(client: HttpClient): Promise<EndpointStats[]> {
	const res = await client.get<{ endpoints?: EndpointStats[] | null } | null>(`${PROFILER_ROOT}/endpoints`);
	return Array.isArray(res?.endpoints) ? res.endpoints : [];
}

export async function listSlowest(client: HttpClient): Promise<EndpointStats[]> {
	const res = await client.get<{ slowest?: EndpointStats[] | null } | null>(`${PROFILER_ROOT}/slowest`);
	return Array.isArray(res?.slowest) ? res.slowest : [];
}

export async function listPlugins(client: HttpClient): Promise<PluginBreakdown[]> {
	const res = await client.get<{ plugins?: PluginBreakdown[] | null } | null>(`${PROFILER_ROOT}/plugins`);
	return Array.isArray(res?.plugins) ? res.plugins : [];
}

export async function readMemoryTrend(client: HttpClient): Promise<MemoryTrend | null> {
	const res = await client.get<MemoryTrend | null>(`${PROFILER_ROOT}/memory`);
	if (!res || typeof res !== 'object') return null;
	return { ...res, snapshots: Array.isArray(res.snapshots) ? res.snapshots : [] };
}

/**
 * One endpoint's per-method statistics and recent entries. The endpoint is
 * a path, so it rides in the URL as the wildcard tail the engine mounts.
 * The leading slash is dropped rather than encoded so the route resolves
 * as written.
 */
export function readEndpoint(client: HttpClient, endpoint: string, limit = 100): Promise<EndpointDetail> {
	const tail = endpoint.replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/');
	return client.get<EndpointDetail>(`${PROFILER_ROOT}/endpoint/${tail}?limit=${limit}`);
}

export function resetProfiler(client: HttpClient): Promise<{ status?: string }> {
	return client.post<{ status?: string }>(`${PROFILER_ROOT}/reset`, undefined);
}

/**
 * A CPU profile over the window rendered as SVG. The endpoint is a label on
 * the result: the profile covers every goroutine in the window.
 */
export function captureFlamegraph(client: HttpClient, endpoint: string, durationSec: number): Promise<Flamegraph> {
	const tail = endpoint.replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/');
	return client.post<Flamegraph>(`${PROFILER_ROOT}/flamegraph/${tail}?duration_sec=${durationSec}`, undefined, {
		signal: AbortSignal.timeout((durationSec + 15) * 1000),
	});
}

/** The profiler's own bound on a capture window, applied before the request. */
export function clampSeconds(raw: unknown): number {
	if (raw === null || raw === undefined || raw === '') return PROFILE_SECONDS.default;
	const n = Number(raw);
	if (!Number.isFinite(n)) return PROFILE_SECONDS.default;
	return Math.min(PROFILE_SECONDS.max, Math.max(PROFILE_SECONDS.min, Math.trunc(n)));
}

/** Nanoseconds, as the engine reports a duration, in the console's one duration format. */
export function formatNs(ns: number): string {
	return formatMillis(ns / 1e6, '');
}

/** The badge a p95 earns: a second is red, a tenth amber, ten milliseconds green. */
export function latencyTone(ns: number): StatusTone {
	if (ns >= 1e9) return 'danger';
	if (ns >= 1e8) return 'warn';
	if (ns <= 1e7) return 'success';
	return 'neutral';
}
