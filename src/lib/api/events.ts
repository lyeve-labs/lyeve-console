/**
 * The events plugin's admin routes.
 *
 * The log is durable and the replay runs against it. A replay is the reason
 * the log is kept: something downstream missed a window, and the events that
 * fell in it are published again to everything that listens.
 *
 * A run's handler is a name, not a destination. A later run under the same
 * name skips the events that name already replayed.
 *
 * Every replay is asked for with a dry run first because the plugin offers
 * one, and because a replay that fans out cannot be taken back.
 */
import type { HttpClient } from '@lyeve-labs/client';

const EVENTS_URL = '/api/admin/events';
const REPLAY_URL = '/api/admin/events/replay';

/** One published event as GET /api/admin/events lists it. */
export interface EventRow {
	id: string;
	source: string;
	topic: string;
	schema_name: string;
	event_type: string;
	payload?: Record<string, unknown> | null;
	published_at: string;
	error?: string | null;
	tenant_id: string;
}

export type ReplayStatus = 'pending' | 'running' | 'completed' | 'failed';

/** One replay run as the plugin reports it. */
export interface ReplayRun {
	run_id: string;
	status: ReplayStatus;
	handler: string;
	since: string;
	dry_run: boolean;
	tenant_id: string;
	total_events: number;
	replayed: number;
	skipped: number;
	failed: number;
	started_at: string;
	completed_at?: string | null;
	error?: string | null;
}

interface Page<T> {
	data?: T[] | null;
	total_count?: number;
}

export async function listEvents(
	client: HttpClient,
	limit: number,
	offset: number,
): Promise<Page<EventRow>> {
	return client.get<Page<EventRow>>(`${EVENTS_URL}?limit=${limit}&offset=${offset}`);
}

export async function listReplays(
	client: HttpClient,
	limit: number,
	offset: number,
): Promise<Page<ReplayRun>> {
	return client.get<Page<ReplayRun>>(`${REPLAY_URL}?limit=${limit}&offset=${offset}`);
}

export interface ReplayRequest {
	since: string;
	handler?: string;
	dry_run: boolean;
	limit?: number;
	tenant_id?: string;
}

export async function startReplay(
	client: HttpClient,
	body: ReplayRequest,
): Promise<ReplayRun> {
	return client.post<ReplayRun>(REPLAY_URL, body);
}

/**
 * How far a run got, as a fraction.
 *
 * A run reports its total before it starts, so a progress bar drawn from
 * replayed alone sits at zero for the whole of a long run.
 */
export function progressOf(run: ReplayRun): number {
	const done = run.replayed + run.skipped + run.failed;
	if (run.total_events <= 0) return run.status === 'completed' ? 1 : 0;
	return Math.min(1, done / run.total_events);
}

/**
 * Whether a run changed anything.
 *
 * A dry run reports the same counters as a real one, so a listing that does
 * not say which it was reads as though every rehearsal had fired.
 */
export function didFire(run: ReplayRun): boolean {
	return !run.dry_run && run.replayed > 0;
}

/** An event that carries an error is the reason someone is replaying. */
export function failedOnly(rows: EventRow[]): EventRow[] {
	return rows.filter((r) => !!r.error);
}
