/**
 * The realtime plugin's admin routes.
 *
 * Two transports and two views. The SSE manager and the WebSocket manager
 * each keep their own counters, so the page reads both rather than adding
 * them: a install that pushes over one and not the other should read as
 * quiet on the other, not as half of a total.
 *
 * The tenant view and the platform view are separate routes on purpose. A
 * tenant admin asking for metrics gets its own tenant's. The per-tenant
 * roster across the instance is a super admin route so the engine's own
 * middleware gates it, rather than a role branch inside one handler.
 */
import type { HttpClient } from '@lyeve-labs/client';

const SSE_METRICS_URL = '/api/admin/realtime/metrics';
const SSE_PLATFORM_URL = '/api/admin/realtime/metrics/platform';
const WS_METRICS_URL = '/api/admin/ws/metrics';

/**
 * Counters the SSE connection manager keeps.
 *
 * `total_connections` is cumulative and never decreases: it counts every
 * connection accepted since the manager was created. `active_connections`
 * and `connections_by_tenant` are gauges describing what is open now. Reading
 * the first as "currently connected" is the mistake this comment exists to
 * prevent.
 */
export interface StreamMetrics {
	total_connections: number;
	active_connections: number;
	connections_by_tenant?: Record<string, number> | null;
	events_dispatched: number;
	reconnections: number;
	heartbeats_sent?: number;
	connections_rejected?: number;
	since: string;
}

/** The WebSocket manager keeps the same counters plus its own. */
export interface SocketMetrics extends StreamMetrics {
	idle_connections?: number;
	connections_by_state?: Record<string, number> | null;
	broadcasts_sent?: number;
	pings_sent?: number;
	pongs_received?: number;
}

export async function getStreamMetrics(client: HttpClient): Promise<StreamMetrics> {
	return client.get<StreamMetrics>(SSE_METRICS_URL);
}

export async function getSocketMetrics(client: HttpClient): Promise<SocketMetrics> {
	return client.get<SocketMetrics>(WS_METRICS_URL);
}

/** Every tenant's open connections. Super admin only. */
export async function getPlatformMetrics(client: HttpClient): Promise<StreamMetrics> {
	return client.get<StreamMetrics>(SSE_PLATFORM_URL);
}

/** One tenant's share of what is open, for the platform table. */
export interface TenantLoad {
	tenant: string;
	connections: number;
	share: number;
}

/**
 * The per-tenant breakdown, busiest first.
 *
 * The map arrives unordered and a tenant with nothing open is simply absent,
 * so a table drawn straight from it reorders itself between reads.
 */
export function tenantLoad(byTenant: Record<string, number> | null | undefined): TenantLoad[] {
	const entries = Object.entries(byTenant ?? {}).filter(([, n]) => n > 0);
	const total = entries.reduce((sum, [, n]) => sum + n, 0);
	return entries
		.map(([tenant, connections]) => ({
			tenant,
			connections,
			share: total > 0 ? connections / total : 0,
		}))
		.sort((a, b) => b.connections - a.connections || a.tenant.localeCompare(b.tenant));
}

/**
 * How long the counters have been running, in words.
 *
 * Every cumulative number on the page is meaningless without it: ten thousand
 * events is a busy minute or a quiet month.
 */
export function uptimeSince(since: string, now = new Date()): string {
	const start = Date.parse(since);
	if (Number.isNaN(start)) return 'an unknown time';
	const secs = Math.max(0, Math.floor((now.getTime() - start) / 1000));
	if (secs < 60) return `${secs}s`;
	if (secs < 3600) return `${Math.floor(secs / 60)}m`;
	if (secs < 86400) return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
	return `${Math.floor(secs / 86400)}d ${Math.floor((secs % 86400) / 3600)}h`;
}

/**
 * Whether a transport looks used at all.
 *
 * An instance that pushes over SSE and never opens a socket should read as
 * "not in use" rather than as a wall of zeros that looks like a fault. Only
 * the accepted connections are the tenant's own. The plugin counts pushed
 * events across the whole instance, so another tenant's traffic says nothing
 * about this one.
 */
export function inUse(m: StreamMetrics | null | undefined): boolean {
	return !!m && m.total_connections > 0;
}
