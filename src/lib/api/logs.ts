import type { HttpClient } from '@lyeve-labs/client';
import type { LogSearchResponse } from '@lyeve-labs/client-rest';
import { query as queryString } from './list';

/** Page sizes the logs page offers. The engine caps a search at 1000. */
export const LOG_PAGE_SIZES = [50, 100, 200, 500] as const;

export const LOG_DEFAULT_LIMIT = 100;

/**
 * Below the engine's ceiling. A thousand log lines in one table is a page
 * nobody reads, and the select on the page stops at the largest size here.
 */
export const LOG_MAX_LIMIT = 500;

const LOG_SEARCH_URL = '/api/admin/logs/search';

/**
 * The engine's bound on an inbound request id. A longer term cannot be one, so
 * it is not looked up as one.
 */
const MAX_ID_LENGTH = 128;

/** What the logs page asks for. */
export interface LogQuery {
	q: string;
	level: string;
	limit: number;
	offset: number;
}

/**
 * Whether a search term could be a request or trace id.
 *
 * The engine adopts a caller's X-Request-ID when it is printable ASCII up to
 * 128 characters, so an id has no fixed shape. One word with no spaces is the
 * most that can be said.
 */
export function couldBeId(term: string): boolean {
	return term.length > 0 && term.length <= MAX_ID_LENGTH && /^[\x21-\x7e]+$/.test(term);
}

/**
 * One page of log entries for the search box.
 *
 * The engine's free text search reads the message only. Request and trace ids
 * live in columns of their own and match only through their own filters, so
 * a pasted id finds nothing as text. A one-word term is therefore also looked
 * up as a request id and as a trace id. The first lookup with a match answers,
 * in that order, and the message search answers otherwise. The order is fixed,
 * so every page of one search reads the same list.
 *
 * The id lookups are guesses at what the term is, so one that fails counts as
 * no match. The plain search is the answer itself, so its failure is thrown
 * and never passed off as a search that found nothing.
 */
export async function searchLogEntries(client: HttpClient, query: LogQuery): Promise<LogSearchResponse> {
	// Built here rather than through the client's searchLogs(), which sends no offset.
	const base = { limit: query.limit, offset: query.offset, level: query.level };
	const run = (key?: string, value?: string) =>
		client.get<LogSearchResponse>(`${LOG_SEARCH_URL}${queryString(key ? { ...base, [key]: value } : base)}`);
	const guess = (key: string, value: string) => run(key, value).catch(() => null);

	const term = query.q.trim();
	if (!term) return run();
	if (!couldBeId(term)) return run('query', term);

	const [byRequest, byTrace, byText] = await Promise.all([
		guess('request_id', term),
		guess('trace_id', term),
		run('query', term),
	]);
	return [byRequest, byTrace].find((res): res is LogSearchResponse => (res?.total ?? 0) > 0) ?? byText;
}
