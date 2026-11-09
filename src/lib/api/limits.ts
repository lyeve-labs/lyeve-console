/**
 * The two things a plugin tells a console beside a refusal's sentence.
 *
 * A refusal that shares its status with another on the same route carries a
 * stable `code`, such as `rate_limit.list_full` beside
 * `rate_limit.duplicate_entry`, both 409. A page branches on the code and
 * relays the sentence, so a reworded message never changes what it does.
 *
 * A read that is held to a ceiling carries `limits`, one entry per thing it
 * counts: `{"entries": {"limit": 500, "current": 12}}`. A null limit is no
 * ceiling. The console reads the numbers rather than holding either.
 */
import { ApiError } from '@lyeve-labs/client';

/** One entry of a limits object: the ceiling, null for none, and the count held against it. */
export interface Limit {
	limit: number | null;
	current: number;
}

/**
 * The string a thrown request error's body carries under `key`, such as the
 * `field` a refused value names, or empty when it carries none.
 */
export function bodyString(err: unknown, key: string): string {
	if (!(err instanceof ApiError) || !err.body || typeof err.body !== 'object') return '';
	const value = (err.body as Record<string, unknown>)[key];
	return typeof value === 'string' ? value : '';
}

/** The machine code a thrown request error carries, or empty when it carries none. */
export function errorCodeOf(err: unknown): string {
	return bodyString(err, 'code');
}

/**
 * The entry a limits object holds under `key`, or null when the read sent
 * none. A limit that is not a number reads as no ceiling.
 */
export function limitOf(limits: unknown, key: string): Limit | null {
	if (!limits || typeof limits !== 'object') return null;
	const entry = (limits as Record<string, unknown>)[key];
	if (!entry || typeof entry !== 'object') return null;
	const { limit, current } = entry as { limit?: unknown; current?: unknown };
	return {
		limit: typeof limit === 'number' && Number.isFinite(limit) ? limit : null,
		current: typeof current === 'number' && Number.isFinite(current) ? current : 0,
	};
}

/** Whether the count has reached a ceiling. No ceiling is never full. */
export function atLimit(l: Limit | null | undefined): boolean {
	return !!l && l.limit !== null && l.current >= l.limit;
}
