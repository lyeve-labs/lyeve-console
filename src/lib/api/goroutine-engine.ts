import type { HttpClient } from '@lyeve-labs/client';
import { checked } from '$lib/checkbox';
import { inSentence } from './gate';

/**
 * The engine's scaling primitives as it reports them under
 * /api/admin/debug/goroutines: the worker pool, the parallel engine and the
 * async hook executor, each a view the same PUT answers with after a change.
 * Durations travel as Go duration strings ("30s", "1m30s"), which is how the
 * engine parses them back.
 */
export interface PoolView {
	size: number;
	active: number;
	waiting: number;
	completed: number;
	failed: number;
	dropped: number;
	avg_latency: string;
	task_timeout: string;
}

export interface ParallelView {
	max_concurrent: number;
	timeout: string;
}

export interface AsyncHooksView {
	enabled: boolean;
	workers: number;
	queue_size: number;
	timeout: string;
	queued: number;
	running: number;
	overflow: number;
	dropped: number;
}

export interface OwnerCount {
	total: number;
	oldest: string;
}

/**
 * The tracker snapshot. The runtime count alone arrives when no tracker is
 * wired. With one, every tracked goroutine is counted under the plugin or
 * engine subsystem that started it, so a leak has a name.
 */
export interface GoroutineSnapshot {
	total: number;
	runtime_total?: number;
	by_source?: Record<string, number>;
	by_owner?: Record<string, OwnerCount>;
	max_goroutines?: number;
	leak_threshold?: string;
}

export interface OwnerRow {
	owner: string;
	total: number;
	oldest: string;
}

export interface GoroutineEngineViews {
	snapshot: GoroutineSnapshot | null;
	pool: PoolView | null;
	parallel: ParallelView | null;
	asyncHooks: AsyncHooksView | null;
	/**
	 * Whether the instance's license lets the three tuning writes through.
	 * The plugin answers this as a plain flag, so the admin never has to know
	 * which license grants it.
	 */
	licensed: boolean;
}

/** What the plugin answers at /api/admin/debug/goroutines/tuning. */
export interface TuningAnswer {
	licensed?: unknown;
}

/** The bounds the engine enforces, so a form can refuse before the round trip. */
export const POOL_SIZE = { min: 1, max: 4096 } as const;
export const PARALLEL_MAX_CONCURRENT = { min: 1, max: 1024 } as const;
export const PARALLEL_TIMEOUT_MAX = '1h';
export const ASYNC_WORKERS = { min: 1, max: 1024 } as const;
export const ASYNC_QUEUE_SIZE = { min: 1, max: 65536 } as const;
export const ASYNC_TIMEOUT_MAX = '10m';

const ROOT = '/api/admin/debug/goroutines';

/** Owners ranked by how many goroutines they hold, the largest first. */
export function byOwnerRows(snapshot: GoroutineSnapshot | null | undefined): OwnerRow[] {
	const owners = snapshot?.by_owner;
	if (!owners || typeof owners !== 'object') return [];
	return Object.entries(owners)
		.map(([owner, c]) => ({
			owner,
			total: typeof c?.total === 'number' && Number.isFinite(c.total) ? c.total : 0,
			oldest: typeof c?.oldest === 'string' ? c.oldest : '',
		}))
		.sort((a, b) => b.total - a.total || a.owner.localeCompare(b.owner));
}

const UNIT_MS: Record<string, number> = { ns: 1e-6, us: 1e-3, µs: 1e-3, ms: 1, s: 1000, m: 60_000, h: 3_600_000 };
const DURATION = /^(\d+(?:\.\d+)?)(ns|us|µs|ms|s|m|h)/;

/**
 * A Go duration string in milliseconds, or null when it is not one. The
 * engine parses the same grammar, so what passes here is what it accepts.
 * A bare number is refused because the unit is what the operator means.
 */
export function durationMs(raw: string): number | null {
	let rest = raw.trim();
	if (!rest) return null;
	let ms = 0;
	while (rest.length > 0) {
		const m = DURATION.exec(rest);
		if (!m) return null;
		ms += Number(m[1]) * UNIT_MS[m[2]];
		rest = rest.slice(m[0].length);
	}
	return ms;
}

const text = (data: FormData, key: string): string => String(data.get(key) ?? '').trim();

function integer(data: FormData, key: string, label: string, bounds: { min: number; max: number }): { n: number } | { error: string } {
	const raw = text(data, key);
	const n = Number(raw);
	if (!raw || !Number.isInteger(n)) return { error: `Enter a whole number for ${inSentence(label)}.` };
	if (n < bounds.min || n > bounds.max) return { error: `Enter a value from ${bounds.min} to ${bounds.max} for ${inSentence(label)}.` };
	return { n };
}

function duration(data: FormData, key: string, label: string, max: string): { d: string } | { error: string } {
	const raw = text(data, key);
	const ms = durationMs(raw);
	if (ms === null) return { error: `Enter a duration such as 30s or 1m for ${inSentence(label)}.` };
	if (ms <= 0) return { error: `Enter a duration longer than zero for ${inSentence(label)}.` };
	if (ms > (durationMs(max) as number)) return { error: `Enter at most ${max} for ${inSentence(label)}.` };
	return { d: raw };
}

export interface PoolBody {
	size: number;
}

export interface ParallelBody {
	max_concurrent: number;
	timeout: string;
}

export interface AsyncHooksBody {
	workers: number;
	queue_size: number;
	timeout: string;
	enabled: boolean;
}

/**
 * What each form sends, checked against the engine's bounds before the
 * request. The forms show the live values and send them all back, so a field
 * the operator did not touch is saved as it was.
 */
export function parsePoolForm(data: FormData): { body: PoolBody } | { error: string } {
	const size = integer(data, 'size', 'Pool size', POOL_SIZE);
	if ('error' in size) return size;
	return { body: { size: size.n } };
}

export function parseParallelForm(data: FormData): { body: ParallelBody } | { error: string } {
	const max = integer(data, 'max_concurrent', 'Max concurrent', PARALLEL_MAX_CONCURRENT);
	if ('error' in max) return max;
	const timeout = duration(data, 'timeout', 'Timeout', PARALLEL_TIMEOUT_MAX);
	if ('error' in timeout) return timeout;
	return { body: { max_concurrent: max.n, timeout: timeout.d } };
}

export function parseAsyncHooksForm(data: FormData): { body: AsyncHooksBody } | { error: string } {
	const workers = integer(data, 'workers', 'Workers', ASYNC_WORKERS);
	if ('error' in workers) return workers;
	const queue = integer(data, 'queue_size', 'Queue size', ASYNC_QUEUE_SIZE);
	if ('error' in queue) return queue;
	const timeout = duration(data, 'timeout', 'Timeout', ASYNC_TIMEOUT_MAX);
	if ('error' in timeout) return timeout;
	return { body: { workers: workers.n, queue_size: queue.n, timeout: timeout.d, enabled: checked(data, 'enabled') } };
}

/**
 * Whether the tuning writes are licensed on this instance. Only an explicit
 * false closes the forms. A failed read, a 404 from a plugin that predates
 * the route, or a body without the flag all read as licensed, so an older
 * server keeps the forms it always had and a refused write still reports
 * itself through its 402.
 */
export async function readTuningLicensed(client: HttpClient): Promise<boolean> {
	try {
		const answer = await client.get<TuningAnswer>(`${ROOT}/tuning`);
		return answer?.licensed !== false;
	} catch {
		return true;
	}
}

/** The four views, each null where the engine did not answer, and the tuning flag. */
export async function readGoroutineEngine(client: HttpClient): Promise<GoroutineEngineViews> {
	const [snapshot, pool, parallel, asyncHooks, licensed] = await Promise.all([
		client.get<GoroutineSnapshot>(ROOT).catch(() => null),
		client.get<PoolView>(`${ROOT}/pool`).catch(() => null),
		client.get<ParallelView>(`${ROOT}/parallel`).catch(() => null),
		client.get<AsyncHooksView>(`${ROOT}/async-hooks`).catch(() => null),
		readTuningLicensed(client),
	]);
	return { snapshot, pool, parallel, asyncHooks, licensed };
}

export function putPoolSize(client: HttpClient, body: PoolBody): Promise<PoolView> {
	return client.put<PoolView>(`${ROOT}/pool`, body);
}

export function putParallel(client: HttpClient, body: ParallelBody): Promise<ParallelView> {
	return client.put<ParallelView>(`${ROOT}/parallel`, body);
}

export function putAsyncHooks(client: HttpClient, body: AsyncHooksBody): Promise<AsyncHooksView> {
	return client.put<AsyncHooksView>(`${ROOT}/async-hooks`, body);
}
