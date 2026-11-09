/**
 * The query-monitor plugin's admin routes.
 *
 * Every route is super admin: a captured statement carries its text, and the
 * text of a query written against one tenant's data is that tenant's. The
 * plugin samples after the fact rather than intercepting, so the log is what
 * was slow recently and not a live trace.
 *
 * Analysis is a separate call per dialect because EXPLAIN is a separate
 * grammar per dialect, and an instance runs one. The page asks for the one
 * the engine reports and never guesses.
 */
import type { StatusTone } from '@lyeve-labs/ui-kit';
import type { HttpClient } from '@lyeve-labs/client';

const QUERY_LOG_URL = '/api/admin/query-log';

/** The dialects the plugin can explain, each with its own analyze route. */
export const ANALYZABLE = ['postgres', 'mysql', 'mssql'] as const;
export type Dialect = (typeof ANALYZABLE)[number];

const ANALYZE_PATH: Record<Dialect, string> = {
	postgres: '/api/admin/query-log/analyze-pg',
	mysql: '/api/admin/query-log/analyze-mysql',
	mssql: '/api/admin/query-log/analyze-mssql',
};

/** One index the analyzer thinks would help, with the DDL to create it. */
export interface IndexSuggestion {
	table: string;
	columns: string[];
	reason: string;
	estimated_benefit?: string;
	ddl?: string;
}

/** What the analyzer read out of the plan. */
export interface QueryAnalysis {
	has_seq_scan?: boolean;
	has_hash_join?: boolean;
	has_nested_loop?: boolean;
	rows_estimated?: number;
	actual_rows?: number;
	planning_time_ms?: number;
	execution_time_ms?: number;
	index_suggestions?: IndexSuggestion[];
}

/** One captured statement as GET /api/admin/query-log lists it. */
export interface QueryLogEntry {
	id: string;
	tenant_id?: string;
	query_hash: string;
	query_text: string;
	plan_text?: string;
	duration_ms: number;
	rows_returned?: number;
	caller_file?: string;
	caller_line?: number;
	engine: string;
	captured_at: string;
	analysis?: QueryAnalysis | null;
}

interface Page<T> {
	data?: T[] | null;
	total_count?: number;
	limit?: number;
	offset?: number;
}

export async function listQueryLog(
	client: HttpClient,
	limit: number,
	offset: number,
): Promise<Page<QueryLogEntry>> {
	return client.get<Page<QueryLogEntry>>(`${QUERY_LOG_URL}?limit=${limit}&offset=${offset}`);
}

/** Why an analysis read no plan, as the plugin names it. */
export type NoPlansReason =
	| 'other_dialect'
	| 'capture_disabled'
	| 'source_missing'
	| 'source_unreadable'
	| 'none_captured';

/**
 * What one analysis read.
 *
 * Suggestions come out of plans, so an empty suggestion list means nothing
 * until it is known whether any plan was read. PostgreSQL and MySQL answer
 * the captured entries with a count of the ones that carry a plan and, when
 * that count is 0, the reason. SQL Server answers its own missing-index
 * views instead, which hold no captured statement.
 */
export interface AnalysisRead {
	entries: QueryLogEntry[];
	/** SQL Server's missing-index suggestions. Empty on the other two. */
	missingIndexes: IndexSuggestion[];
	/** How many entries carry a plan. Null for SQL Server, which reads none. */
	plansRead: number | null;
	noPlansReason: NoPlansReason | null;
}

const NO_PLANS_REASONS: readonly NoPlansReason[] = [
	'other_dialect',
	'capture_disabled',
	'source_missing',
	'source_unreadable',
	'none_captured',
];

/**
 * Reads an analyze answer of either shape.
 *
 * An answer that does not count its plans, from a plugin older than the
 * count, is counted here from the entries it carries.
 */
export function readAnalysis(dialect: Dialect, raw: unknown): AnalysisRead {
	const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
	if (dialect === 'mssql') {
		const missing = Array.isArray(r.missing_indexes) ? (r.missing_indexes as IndexSuggestion[]) : [];
		return { entries: [], missingIndexes: missing, plansRead: null, noPlansReason: null };
	}
	const entries = Array.isArray(r.entries) ? (r.entries as QueryLogEntry[]) : [];
	const counted = entries.filter((e) => e.engine === dialect && !!e.plan_text).length;
	const plansRead = typeof r.plans_read === 'number' ? r.plans_read : counted;
	const reason = NO_PLANS_REASONS.find((why) => why === r.no_plans_reason) ?? null;
	return { entries, missingIndexes: [], plansRead, noPlansReason: plansRead === 0 ? reason : null };
}

/**
 * Analyzes the slowest statements as one dialect.
 *
 * An instance that is not on this dialect answers PostgreSQL and MySQL with
 * no plan and the reason, and SQL Server with empty lists. A refusal is
 * thrown, so the caller keeps it rather than drawing "nothing was slow".
 */
export async function analyzeQueries(
	client: HttpClient,
	dialect: Dialect,
	limit: number,
): Promise<AnalysisRead> {
	const param = dialect === 'mssql' ? 'top_n' : 'limit';
	const res = await client.get<unknown>(`${ANALYZE_PATH[dialect]}?${param}=${limit}`);
	return readAnalysis(dialect, res);
}

/** Where each dialect's plans come from, as an operator would name it. */
const PLAN_SOURCE: Record<Exclude<Dialect, 'mssql'>, string> = {
	postgres: 'pg_stat_statements',
	mysql: 'performance_schema',
};

const DIALECT_NAME: Record<Dialect, string> = {
	postgres: 'PostgreSQL',
	mysql: 'MySQL',
	mssql: 'SQL Server',
};

/**
 * Why there is no suggestion, in a sentence.
 *
 * Saying "the plans already use an index" over an analysis that read no plan
 * sends an operator away from a database that was never examined.
 */
export function noSuggestionText(dialect: Dialect, read: AnalysisRead): string {
	if (dialect === 'mssql') {
		return 'SQL Server suggested no index.';
	}
	const name = DIALECT_NAME[dialect];
	const source = PLAN_SOURCE[dialect];
	const plans = read.plansRead ?? 0;
	if (plans > 0) {
		return `No suggestions from the ${plans === 1 ? 'plan' : `${plans} plans`} analyzed.`;
	}
	switch (read.noPlansReason) {
		case 'other_dialect':
			return `No plans were read, because the database is not ${name}.`;
		case 'capture_disabled':
			return `No plans were read. Reading ${source} is turned off by QUERY_MONITOR_DISABLE_PG_STAT_CAPTURE.`;
		case 'source_missing':
			return dialect === 'postgres'
				? `No plans were read. Plans come from ${source}, and the extension is not installed in this database.`
				: `No plans were read. Plans come from ${source}, and the database does not expose its statement digests.`;
		case 'source_unreadable':
			return `No plans were read. Could not check whether ${source} is available.`;
		case 'none_captured':
			return `No plans were read yet. ${source} is available, but none of the recent slow requests captured a plan.`;
		default:
			return 'No plans were read.';
	}
}

/** A duration worth coloring. The engine samples what is already slow. */
export function durationTone(ms: number): StatusTone {
	if (ms >= 1000) return 'danger';
	if (ms >= 250) return 'warn';
	return 'neutral';
}

/**
 * The statement on one line, for a table cell.
 *
 * Captured SQL arrives with the newlines and runs of spaces the caller wrote,
 * which in a table cell reads as a blank row followed by a wrapped one.
 */
export function oneLine(sql: string, max = 160): string {
	const flat = sql.replace(/\s+/g, ' ').trim();
	// max is the width of the result, ellipsis included, so a caller sizing a
	// column gets the width it asked for rather than three characters more.
	return flat.length > max ? `${flat.slice(0, Math.max(0, max - 3))}...` : flat;
}

/** Where the statement was issued, when the sampler caught a caller. */
export function callerOf(entry: QueryLogEntry): string | null {
	if (!entry.caller_file) return null;
	return entry.caller_line ? `${entry.caller_file}:${entry.caller_line}` : entry.caller_file;
}
