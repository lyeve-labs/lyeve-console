import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { section } from '$lib/api/gate';
import { latencyTop } from '$lib/api/observability';
import { readGoroutineEngine } from '$lib/api/goroutine-engine';
import { authedClient } from '$lib/server/authz';
import { goroutineCount } from '$lib/server/goroutines';
import { couldNotLoad } from '$lib/outage';
import { rolesInWords } from '$lib/roles';

/**
 * What the engine answers at /api/admin/pool/health: one flat snapshot of the
 * pool, measured when the request arrives.
 *
 * The counts are optional because an engine with no pool health provider wired
 * answers `healthy: true` and a message, with no engine name and no counts.
 * Declared as always present, they would render a Healthy badge over tiles
 * measuring nothing.
 */
interface PoolHealth {
	engine?: string;
	healthy: boolean;
	latency_ms?: number;
	open_connections?: number;
	in_use?: number;
	idle?: number;
	max_open_connections?: number;
	wait_count?: number;
	wait_duration_ms?: number;
	errors?: string[];
	utilization?: number;
	utilization_warning?: boolean;
	message?: string;
}

interface LatencyStats {
	method: string;
	path: string;
	count: number;
	min_us: number;
	max_us: number;
	avg_us: number;
	p50_us: number;
	p95_us: number;
	p99_us: number;
	samples: number;
}

interface LatencyResponse {
	tracker?: Record<string, unknown>;
	slowest: LatencyStats[];
	total: number;
}

// A read that failed carries no statistics, so it is kept as the reason it
// failed. A zeroed snapshot would read on screen as a pool with no connections
// open, and an empty ranking as an engine that has timed nothing.
const FAILED = {
	pool: couldNotLoad('pool health'),
	latency: couldNotLoad('latency rankings'),
} as const;

const READERS = ['admin', 'super_admin'];

export const load: PageServerLoad = async (event) => {
	const { url, parent } = event;
	const { user } = await parent();
	if (!user.roles.some((r) => READERS.includes(r))) {
		error(403, `Only ${rolesInWords(READERS)} can open this page.`);
	}

	const client = authedClient(event);

	// The row count is a query parameter, so the ranking a person is looking at
	// is a link, and refreshing the page keeps the depth they chose.
	const top = latencyTop(url.searchParams.get('top'));

	const [poolHealth, latency, views] = await Promise.all([
		section(client.get<PoolHealth>('/api/admin/pool/health'), FAILED.pool),
		section(client.get<LatencyResponse>(`/api/admin/debug/latency?top=${top}`), FAILED.latency),
		readGoroutineEngine(client),
	]);

	// The pool row's goroutine figure is the runtime's count from the
	// goroutine engine's snapshot. Its tuning panel is a tab of its own.
	return { poolHealth, latency, top, goroutines: goroutineCount(views.snapshot) };
};
