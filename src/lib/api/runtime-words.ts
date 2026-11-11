import { formatBytes, formatCount } from '$lib/format';

/**
 * Every sentence the runtime and scaling panel shows for a code the runtime
 * routes send. The routes also send English for a reader of the API, and the
 * panel never shows it: each code is worded here from its params, and a code
 * this file does not know reads as the plain fallback for its kind. A code
 * whose params are missing reads as that fallback too, rather than as a
 * sentence with a hole in it.
 */

export type Params = Record<string, unknown>;

/** What a 409 from the settings PUT carries. */
export interface ConflictBody {
	code?: unknown;
	variable?: unknown;
	source?: unknown;
}

/** One caution on the recommendations. */
export interface RecommendationWarning {
	code: string;
	params?: Params;
}

const num = (p: Params | undefined, key: string): number | null => {
	const v = p?.[key];
	return typeof v === 'number' && Number.isFinite(v) ? v : null;
};

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

const count = (n: number) => formatCount(n);

/** A CPU limit, which can be a fraction. */
const cores = (n: number) => (Number.isInteger(n) ? count(n) : String(Math.round(n * 100) / 100));

export const FALLBACK = {
	fact: 'Could not read this value.',
	recommendation: 'This value fits the machine and the database this engine uses.',
	warning: 'Review these recommendations before you save them.',
	conflict: 'Could not save the settings. Reload the page and try again.',
	invalid: 'Could not save the settings with these values. Check them and try again.',
} as const;

const FACTS: Record<string, (f: { grant?: unknown }) => string | null> = {
	no_cgroup: () => 'The container sets no limit, or its limit cannot be read.',
	no_proc: () => 'This system does not report this value.',
	no_database: () => 'This engine runs without a database.',
	missing_grant: (f) => {
		const grant = str(f.grant);
		return grant
			? `Grant ${grant} to the database account to show this value.`
			: 'Give the database account permission to read server statistics to show this value.';
	},
	unreadable: () => 'Could not read this from the database. Reload the page to try again.',
	not_over_sql: () => 'This database does not report this value.',
	no_fixed_limit: () => 'The database has no fixed limit and accepts connections as they are needed.',
	no_roster: () => 'This shows only while a transport that tracks the replicas is running.',
	not_chosen_yet: () => 'The cache type is not set yet. Reload the page in a moment to see it.',
	no_runtime_settings: () => 'Runtime settings are not available on this engine.',
};

/** Why a fact is not available, from its reason code. */
export function factText(f: { reason_code?: unknown; grant?: unknown } | undefined): string {
	const word = FACTS[str(f?.reason_code)];
	return (f && word?.(f)) || FALLBACK.fact;
}

/** ", shared by 3 replicas", or nothing for one. */
const sharedBy = (replicas: number | null) => (replicas !== null && replicas > 1 ? `, shared by ${count(replicas)} replicas` : '');

const RECOMMENDATIONS: Record<string, (p: Params) => string | null> = {
	cpu_automatic: () => 'Automatic matches the threads to the CPUs available to the engine and follows them as they change.',
	cpu_automatic_one_thread: (p) => {
		const limit = num(p, 'cpu_limit');
		const threads = num(p, 'threads');
		if (limit === null || threads === null) return null;
		return `With a CPU limit of ${cores(limit)}, Automatic runs ${count(threads)} thread${threads === 1 ? '' : 's'} and adds more if the limit grows.`;
	},
	memory_no_limit: () => 'No memory limit was found for the container or the machine. Automatic follows a limit if one is set later.',
	memory_share: (p) => {
		const share = num(p, 'share_percent');
		const headroom = num(p, 'headroom_percent');
		const limit = num(p, 'limit_bytes');
		if (share === null || headroom === null || limit === null) return null;
		const size = formatBytes(limit);
		const of =
			p.limit_source === 'container'
				? `the container's ${size} memory limit`
				: p.limit_source === 'machine'
					? `the machine's ${size} of memory`
					: `the ${size} memory limit`;
		return `Using ${share}% of ${of} leaves ${headroom}% for memory the garbage collector does not count.`;
	},
	gc_one_server_with_limit: (p) => {
		const gc = num(p, 'gc_percent');
		const def = num(p, 'default_percent');
		if (gc === null || def === null) return null;
		return `On one server with a soft memory limit, ${gc}% collects less often than the default of ${def}%, and the limit still caps memory use.`;
	},
	gc_default: (p) => {
		const gc = num(p, 'gc_percent');
		if (gc === null) return null;
		return `${gc}% is the default target, which suits several replicas or a server with no memory limit.`;
	},
	pool_connection_limit_unread: (p) => {
		const c = num(p, 'database_cores');
		if (c === null) return null;
		return `Could not read the database's connection limit, so the pool is sized from its ${count(c)} cores${sharedBy(num(p, 'replicas'))}.`;
	},
	pool_no_fixed_limit: (p) => {
		const c = num(p, 'database_cores');
		if (c === null) return null;
		return `The database has no fixed connection limit, so the pool is sized from its ${count(c)} cores${sharedBy(num(p, 'replicas'))}.`;
	},
	pool_engine_default: (p) => {
		const pool = num(p, 'pool');
		if (pool === null) return null;
		return `The database's connection limit and cores are both unknown, so the pool keeps its default of ${count(pool)}. Enter the database cores to refine it.`;
	},
	pool_share: (p) => {
		const share = num(p, 'server_share_percent');
		const limit = num(p, 'connection_limit');
		const replicas = num(p, 'replicas');
		const reserved = num(p, 'reserved_sessions');
		if (share === null || limit === null || replicas === null || reserved === null) return null;
		const who = replicas > 1 ? `Each of the ${count(replicas)} replicas gets an equal share of` : 'The engine gets';
		return `${who} ${share}% of the database's ${count(limit)} connections, minus ${count(reserved)} for the engine's own sessions.`;
	},
	pool_cores_cap: (p) => {
		const pool = num(p, 'pool');
		const share = num(p, 'share');
		const c = num(p, 'database_cores');
		const replicas = num(p, 'replicas');
		if (pool === null || share === null || c === null || replicas === null) return null;
		if (replicas > 1) {
			return `The database's ${count(c)} cores can serve fewer connections than the ${count(share)} its connection limit leaves each of the ${count(replicas)} replicas, so each replica's pool is ${count(pool)}.`;
		}
		return `The database's ${count(c)} cores can serve fewer connections than the ${count(share)} its connection limit leaves the engine, so the pool is ${count(pool)}.`;
	},
	pool_default_cap: (p) => {
		const pool = num(p, 'pool');
		const share = num(p, 'share');
		const replicas = num(p, 'replicas');
		if (pool === null || share === null || replicas === null) return null;
		const leaves = replicas > 1 ? `each of the ${count(replicas)} replicas` : 'the engine';
		return `The database's connection limit leaves ${leaves} ${count(share)} connections, but its cores are unknown, so the pool keeps its default of ${count(pool)}. Enter the database cores to refine it.`;
	},
};

/** Why a value is recommended, from its reason code and params. */
export function recommendationText(r: { reason_code?: unknown; params?: unknown } | undefined): string {
	const word = RECOMMENDATIONS[str(r?.reason_code)];
	const params = r?.params && typeof r.params === 'object' ? (r.params as Params) : {};
	return word?.(params) || FALLBACK.recommendation;
}

const WARNINGS: Record<string, (p: Params) => string | null> = {
	pool_share_below_floor: (p) => {
		const share = num(p, 'share');
		const floor = num(p, 'floor');
		const limit = num(p, 'connection_limit');
		const replicas = num(p, 'replicas');
		if (share === null || floor === null || limit === null || replicas === null) return null;
		const left = count(Math.max(0, share));
		if (replicas <= 1) {
			return `The database's ${count(limit)} connections leave ${left} for the engine, below the minimum of ${count(floor)}. Raise the database's connection limit.`;
		}
		return `The database's ${count(limit)} connections leave ${left} for each of the ${count(replicas)} replicas, below the minimum of ${count(floor)}. Raise the database's connection limit or run fewer replicas.`;
	},
	pool_crowds_database: (p) => {
		const pool = num(p, 'pool');
		const limit = num(p, 'connection_limit');
		if (pool === null || limit === null) return null;
		return `A pool of ${count(pool)} uses more than a third of the database's ${count(limit)} connections. Lower it if other applications need to connect.`;
	},
	replicas_without_transport: (p) => {
		const replicas = num(p, 'replicas');
		const poll = num(p, 'poll_seconds');
		if (replicas === null || poll === null) return null;
		return `Your ${count(replicas)} replicas share no transport, so a change reaches the others within ${count(poll)} seconds, and their caches update as entries expire.`;
	},
	cache_per_replica: (p) => {
		const replicas = num(p, 'replicas');
		if (replicas === null) return null;
		return `Your ${count(replicas)} replicas each have their own cache, so sign-in lockouts and rate limits count separately on each one.`;
	},
};

/** A caution on the recommendations, from its code and params. */
export function warningText(w: RecommendationWarning | undefined): string {
	const word = WARNINGS[str(w?.code)];
	const params = w?.params && typeof w.params === 'object' ? w.params : {};
	return word?.(params) || FALLBACK.warning;
}

/** Why a save met a 409, from its code. A pinned value names its variable and where to change it. */
export function conflictText(body: unknown): string {
	const b = (body && typeof body === 'object' ? body : {}) as ConflictBody;
	switch (str(b.code)) {
		case 'stale_revision':
			return 'Someone changed these settings after you opened them. Reload them to see the latest version.';
		case 'runtime_settings_unavailable':
			return 'Could not save the settings, because runtime settings are not available on this engine. Reload the page to see what changed.';
		case 'scaling_primitive_missing':
			return 'Could not save the settings, because this engine has no database pool to resize. Leave the pool unchanged and save again.';
		case 'setting_pinned': {
			const variable = str(b.variable);
			if (b.source === 'file') {
				return variable
					? `Could not save the settings, because the configuration file key ${variable} sets one of them. Change it in the configuration file, then restart the engine.`
					: 'Could not save the settings, because the configuration file sets one of them. Change it there, then restart the engine.';
			}
			return variable
				? `Could not save the settings, because the environment variable ${variable} sets one of them. Change ${variable} where the engine is deployed, then restart the engine.`
				: 'Could not save the settings, because the deployment sets one of them. Change it where the engine is deployed, then restart the engine.';
		}
		default:
			return FALLBACK.conflict;
	}
}

/** The names a reader sees for the settings the PUT body names. */
const SETTING_LABELS: Record<string, string> = {
	cpu: 'CPU threads',
	memory: 'soft memory limit',
	gc_percent: 'GC target',
	database_max_connections: 'database pool',
};

const MIB = 1024 * 1024;

/** The console and the engine disagree about what a save may carry. */
const VERSION_MISMATCH =
	'Could not save the settings, because this console and the engine are on different versions. Reload the page. If this happens again, update the console to match the engine.';

const outOfBounds = (b: Record<string, unknown>): string | null => {
	const min = num(b, 'min');
	const max = num(b, 'max');
	if (min === null) return null;
	switch (str(b.field)) {
		case 'database_max_connections':
			return max === null ? null : `Enter between ${count(min)} and ${count(max)} connections per replica.`;
		case 'gc_percent':
			return `Enter a GC target of ${min} or more.`;
		case 'cpu':
			return `Enter ${count(min)} or more CPU threads.`;
		case 'memory':
			if (b.mode === 'ratio' && max !== null) return `Enter a share of the memory limit between ${Math.round(min * 100)} and ${Math.round(max * 100)}%.`;
			if (b.mode === 'bytes') return `Enter a soft memory limit of at least ${count(Math.ceil(min / MIB))} MB.`;
			return null;
		default:
			return null;
	}
};

const INVALID: Record<string, (b: Record<string, unknown>) => string | null> = {
	revision_required: () => 'Could not save the settings. Reload the page and try again.',
	nothing_to_change: () => 'Change a setting first.',
	setting_shape_invalid: () => VERSION_MISMATCH,
	setting_mode_unknown: () => VERSION_MISMATCH,
	setting_out_of_bounds: outOfBounds,
	cpu_threads_above_cores: (b) => {
		const c = num(b, 'cores');
		return c === null ? null : `Enter at most ${count(c)} CPU threads, the number of CPUs available to the engine.`;
	},
	gc_off_needs_memory_limit: () =>
		"A GC target of -1 turns garbage collection off, which needs a soft memory limit below the container's or the machine's memory. Set a lower soft memory limit, or enter a GC target of 0 or more.",
	gc_above_max_needs_memory_limit: (b) => {
		const max = num(b, 'max_gc_percent');
		if (max === null) return null;
		return `A GC target above ${max}% needs a soft memory limit below the container's or the machine's memory. Set a lower soft memory limit, or enter a GC target of ${max}% or less.`;
	},
	setting_refused: (b) => {
		const label = SETTING_LABELS[str(b.field)];
		return label ? `Could not save the ${label} with this value. Enter a different value and try again.` : null;
	},
};

/**
 * Why a save met a 422, or a 400 naming a field the engine does not take,
 * from its code and the params beside it. Null for a 400 of any other kind,
 * which the caller words itself. A 422 code this file does not know reads as
 * the fallback.
 */
export function invalidText(status: number, body: unknown): string | null {
	const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
	const code = str(b.code);
	if (status === 400) return code === 'unknown_field' ? VERSION_MISMATCH : null;
	if (status !== 422) return null;
	return INVALID[code]?.(b) || FALLBACK.invalid;
}
