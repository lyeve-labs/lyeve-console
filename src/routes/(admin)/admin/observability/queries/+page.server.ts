import type { PageServerLoad } from './$types';
import { error, redirect } from '@sveltejs/kit';
import { ApiError } from '@lyeve-labs/client';
import { authedClient } from '$lib/server/authz';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import {
	ANALYZABLE,
	analyzeQueries,
	listQueryLog,
	type AnalysisRead,
	type Dialect,
	type QueryLogEntry,
} from '$lib/api/query-monitor';
import { GATE_OK, gateOf, type Gate } from '$lib/api/gate';
import { pageWindow, pastEndOffset, withOffset } from '$lib/api/list';
import { couldNotLoad } from '$lib/outage';

/**
 * Why the capture log was not read. Beside every shared state, the plugin can
 * answer that its own capture table did not answer, which a pending migration
 * can leave absent. That is its own state, named apart from the shared
 * `unavailable`, which means the engine itself did not answer.
 */
export type CaptureGate = Gate | { state: 'capture_store' };

/** The sentence the plugin sends when its capture table did not answer. */
const CAPTURE_STORE_REFUSAL = 'failed to load query log';

/**
 * What a refused capture log read means. Only the plugin's own refusal is the
 * capture store. A 503 with any other sentence, a 502, a 504 or a read that
 * never reached the engine is an outage, and reads as one.
 */
function captureGate(err: unknown): CaptureGate {
	if (err instanceof ApiError && err.status === 503) {
		const said = (err.body as { error?: unknown } | undefined)?.error;
		if (said === CAPTURE_STORE_REFUSAL) return { state: 'capture_store' };
	}
	return gateOf(err, couldNotLoad('the query log'));
}

/** The page size when a request names none. */
const DEFAULT_LIMIT = 50;

/** One below the engine's list ceiling, so a probe row is not clamped away. */
const MAX_LIMIT = 199;

/** How many statements the analyzer is asked to explain at once. */
const ANALYZE_LIMIT = 20;

function dialectOf(value: string | null): Dialect | null {
	return ANALYZABLE.includes(value as Dialect) ? (value as Dialect) : null;
}

export const load: PageServerLoad = async (event) => {
	const { user, plugins } = await event.parent();
	// Captured SQL carries the text of a query written against one tenant's
	// data, so the whole page is the super admin's.
	if (!user.roles.includes('super_admin')) error(403, 'Only a super admin can open this page.');

	const { limit, offset } = pageWindow(event.url, DEFAULT_LIMIT, MAX_LIMIT);
	const dialect = dialectOf(event.url.searchParams.get('dialect'));

	// The shell says why the page is unavailable while its plugin does not run.
	if (notRunning(plugins, PLUGIN.queryMonitor)) {
		return {
			entries: [] as QueryLogEntry[],
			total: 0,
			limit,
			offset,
			gate: { state: 'absent' } as CaptureGate,
			dialect,
			analysis: null as AnalysisRead | null,
			analyzeFailed: false,
		};
	}

	const client = authedClient(event);
	let entries: QueryLogEntry[] = [];
	let total = 0;
	let gate: CaptureGate = GATE_OK;
	let stated: number | null = null;
	try {
		const page = await listQueryLog(client, limit, offset);
		entries = page.data ?? [];
		stated = page.total_count ?? null;
		// The envelope carries the collection count. Keeping what has been read
		// as the floor answers the case where it omits one.
		total = Math.max(page.total_count ?? 0, offset + entries.length);
	} catch (err) {
		gate = captureGate(err);
	}
	if (gate.state === 'ok') {
		const back = pastEndOffset(entries.length, limit, offset, stated);
		if (back !== null) redirect(307, withOffset(event.url, back));
	}

	// Analysis runs only when a dialect is asked for. It is EXPLAIN against a
	// live database, which is not something to do on every page view.
	let analysis: AnalysisRead | null = null;
	let analyzeFailed = false;
	if (dialect && gate.state === 'ok') {
		try {
			analysis = await analyzeQueries(client, dialect, ANALYZE_LIMIT);
		} catch {
			// A swallowed failure reads as "nothing to suggest", which is the
			// opposite of what a refusal means on an instance of another dialect.
			analyzeFailed = true;
		}
	}

	return { entries, total, limit, offset, gate, dialect, analysis, analyzeFailed };
};
