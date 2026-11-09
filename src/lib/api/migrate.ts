/**
 * The engine's DDL migration endpoints.
 *
 * Saving a schema writes DDL to sys_ddl_log and leaves it unapplied, so the
 * instance can be in step with its schemas or behind them. Two endpoints
 * answer for that: one counts what is waiting, one applies it.
 *
 * These take the client rather than `fetch` because the authenticated client is
 * where the session bearer token and the double-submit CSRF header are joined
 * (`$lib/server/authz`). A wrapper that rebuilt the client from `fetch` would
 * have to restate that, and a write that restates it slightly differently is
 * refused with 403 "csrf token required" rather than failing visibly.
 */
import type { HttpClient } from '@lyeve-labs/client';
import { count } from './narrow';

/**
 * The name the shell's load reads the count under. A write that queues or runs
 * DDL invalidates it, because SvelteKit keeps the shell's data across a
 * client-side navigation and would otherwise show the count from before.
 */
export const MIGRATIONS_DEPENDENCY = 'app:migrations';

/** One statement waiting in the DDL log, as GET /api/admin/migrate lists it. */
export interface PendingStatement {
	schema_name: string;
	description: string;
}

/** What GET /api/admin/migrate answers with. */
interface PendingResponse {
	pending?: number | null;
	items?: unknown;
}

/** The queue: how many statements wait, and which. */
export interface PendingMigrations {
	pending: number | null;
	items: PendingStatement[];
}

/** What POST /api/admin/migrate/apply answers with. */
interface AppliedResponse {
	applied?: number | null;
}

function isStatement(value: unknown): value is PendingStatement {
	const item = value as PendingStatement | null;
	return typeof item?.schema_name === 'string' && typeof item?.description === 'string';
}

/**
 * Migrations written to the DDL log and not yet applied, with the statements
 * themselves so an apply can name what it runs. Throws if the engine refuses.
 */
export async function pendingMigrations(client: HttpClient): Promise<PendingMigrations> {
	const res = await client.get<PendingResponse | null>('/api/admin/migrate');
	const items = Array.isArray(res?.items) ? res.items.filter(isStatement) : [];
	return { pending: count(res?.pending), items };
}

/**
 * Applies every pending migration and answers with how many ran.
 *
 * The endpoint takes no body. `JSON.stringify(undefined)` is undefined, so
 * passing it sends none rather than an empty object the engine has to parse.
 */
export async function applyMigrations(client: HttpClient): Promise<number | null> {
	const res = await client.post<AppliedResponse | null>('/api/admin/migrate/apply', undefined);
	return count(res?.applied);
}
