/**
 * Row count of a paginated admin list. The client unwraps the rows with
 * `unwrapList`. This reads the count that sits beside them.
 *
 * Plugins do not agree on the name of the row count: most send `total_count`,
 * the audit log sends `total`. Accept both, because reading the wrong one
 * silently falls back to the page length and the caller then paginates over a
 * total it invented.
 */
export interface ListEnvelope<T> {
	data?: T[] | null;
	limit?: number;
	offset?: number;
	total_count?: number;
	total?: number;
}

/** Row count reported by the envelope, falling back to the array length. */
export function totalOf<T>(res: ListEnvelope<T> | T[] | null | undefined): number {
	if (Array.isArray(res)) return res.length;
	return res?.total_count ?? res?.total ?? res?.data?.length ?? 0;
}

/**
 * The row count the response states, or null when it states none.
 *
 * `totalOf` falls back to the length of the page, which is the right answer for
 * a caller that only wants a number to print. It is the wrong answer for a
 * pager: on page one of ten thousand rows it reports 100, and the pager then
 * believes the collection has ended. A pager has to be able to tell "the
 * endpoint did not say" apart from "the endpoint said this many".
 */
export function statedTotal<T>(res: ListEnvelope<T> | T[] | null | undefined): number | null {
	if (!res || Array.isArray(res)) return null;
	if (typeof res.total_count === 'number') return res.total_count;
	if (typeof res.total === 'number') return res.total;
	return null;
}

/** Rows out of a response that may be an envelope or a bare array. */
export function rowsOf<T>(res: ListEnvelope<T> | T[] | null | undefined): T[] {
	if (Array.isArray(res)) return res;
	return res?.data ?? [];
}

/** One bounded page of a list, and whether another one exists. */
export interface PagedList<T> {
	rows: T[];
	limit: number;
	offset: number;
	/** The collection size when the endpoint states one, null when it does not. */
	total: number | null;
	hasMore: boolean;
}

/**
 * A page of rows out of one list response.
 *
 * The caller asks the endpoint for `limit + 1` rows. The extra row is never
 * rendered: it is the only way to answer "is there another page" against an
 * endpoint that sends a bare array and no count, which is what several of these
 * admin lists send. Where the endpoint does state a count, that count decides
 * instead and the probe row is simply dropped, so one call site serves both
 * shapes and neither ends up inventing a total nobody measured.
 *
 * An endpoint that ignores limit and offset altogether still gets bounded here,
 * because the slice happens on this side.
 */
export function pageOf<T>(
	res: ListEnvelope<T> | T[] | null | undefined,
	limit: number,
	offset: number
): PagedList<T> {
	const all = rowsOf(res);
	const total = statedTotal(res);
	const rows = all.slice(0, limit);
	return {
		rows,
		limit,
		offset,
		total,
		hasMore: total === null ? all.length > limit : offset + rows.length < total,
	};
}

/**
 * The page window a request asked for, clamped and snapped to a page boundary.
 *
 * The engine clamps an oversized limit rather than refusing it, so a request
 * past the ceiling comes back silently truncated and the caller cannot tell a
 * full page from a short one. Clamping here means the number asked for is the
 * number the answer can be read against.
 *
 * The offset is snapped down to a multiple of the limit because it is user
 * input from a URL and the pager under these lists counts in pages. An offset
 * between two boundaries has no page number, so the pager would state the range
 * of the page it rounds to while the rows on screen started somewhere else.
 * Snapping down hides nothing: the page that begins below an arbitrary offset
 * holds every row that offset would have shown, and the rest are one page on.
 */
export function pageWindow(
	url: URL,
	fallback: number,
	max: number
): { limit: number; offset: number } {
	const limit = Math.max(1, Math.min(max, Number(url.searchParams.get('limit')) || fallback));
	const asked = Math.max(0, Number(url.searchParams.get('offset')) || 0);
	return { limit, offset: pageOffset(pageNumber(asked, limit), limit) };
}

/** The 1-based page a window starts on. */
export function pageNumber(offset: number, limit: number): number {
	const size = Math.max(1, Math.floor(limit) || 1);
	return Math.floor(Math.max(0, offset) / size) + 1;
}

/** The offset a page starts at. Anything below page one is page one. */
export function pageOffset(page: number, limit: number): number {
	const size = Math.max(1, Math.floor(limit) || 1);
	return (Math.max(1, Math.floor(page) || 1) - 1) * size;
}

/**
 * Page links for a route that pages by limit and offset.
 *
 * The inverse of `pageWindow`, and it lives beside it so that the two spellings
 * of one window cannot drift apart. The pager these feed is page based and
 * these routes are offset based, so the translation has to happen somewhere,
 * and doing it once here keeps four list pages from each carrying their own
 * arithmetic.
 *
 * Links rather than a callback, because a click that lands before the page
 * hydrates reaches no handler, and an href works from the server-rendered
 * document.
 *
 * `params` is whatever has to survive a page change: a search term, a filter.
 * Dropping it would page a filtered list back into the unfiltered one.
 */
export function pageHref(
	path: string,
	limit: number,
	params: Record<string, string> = {}
): (page: number) => string {
	return (page: number) => {
		const query = new URLSearchParams({
			...params,
			limit: String(limit),
			offset: String(pageOffset(page, limit)),
		});
		return `${path}?${query}`;
	};
}

/**
 * The offset to send a request back to when it asked for a page past the end,
 * or null when the window it asked for is the one to render.
 *
 * An empty page is not an empty collection, and every one of these lists draws
 * the same empty state either way. That state says the library has nothing in
 * it and offers no control to leave with, so an offset past the end would tell
 * an operator their files are gone and leave them on that screen. The offset is URL input and it outlives the rows it was written against:
 * a bookmark, a back button, a deletion that shortened the list.
 *
 * A counted list goes back to the last page that holds rows, an uncounted one
 * to the first, because without a total no last page is knowable here. Null
 * when the target is the window already asked for, so a total that disagrees
 * with the rows corrects once and then renders rather than bouncing.
 */
export function pastEndOffset(
	shown: number,
	limit: number,
	offset: number,
	total: number | null
): number | null {
	if (shown > 0 || offset <= 0) return null;
	const last =
		total !== null && total > 0 ? pageOffset(pageNumber(total - 1, limit), limit) : 0;
	return last === offset ? null : last;
}

/**
 * This URL with a different offset and every other parameter kept.
 *
 * Rebuilding the query from a named list of parameters is how a corrected page
 * loses the search term it was being corrected within.
 */
export function withOffset(url: URL, offset: number): string {
	const next = new URL(url);
	next.searchParams.set('offset', String(offset));
	return `${next.pathname}${next.search}`;
}

/**
 * A query string from named parameters, in the order given, with a leading
 * `?`. An undefined or empty value is left out, and no parameter at all is an
 * empty string, so a caller appends it to a path unconditionally.
 */
export function query(params: Record<string, string | number | undefined>): string {
	const qs = new URLSearchParams();
	for (const [k, v] of Object.entries(params)) {
		if (v !== undefined && v !== '') qs.set(k, String(v));
	}
	const s = qs.toString();
	return s ? `?${s}` : '';
}

/** One page as a walk reads it: its rows, and the count the endpoint states or null. */
export interface ReadPage<T> {
	rows: T[];
	total: number | null;
}

/**
 * Every row of a paged list, a page at a time. The walk ends at a short page,
 * at the stated total, once `enough` holds, or before a page that would start
 * at `cap` rows. An endpoint that never sends a short page or a total needs a
 * finite `cap`, or the walk does not end.
 */
export async function readAll<T>(
	read: (limit: number, offset: number) => Promise<ReadPage<T>>,
	pageSize: number,
	cap = Infinity,
	enough: (rows: readonly T[]) => boolean = () => false
): Promise<ReadPage<T>> {
	const rows: T[] = [];
	let total: number | null = null;
	for (let offset = 0; offset < cap; offset += pageSize) {
		const page = await read(pageSize, offset);
		rows.push(...page.rows);
		total = page.total;
		if (page.rows.length < pageSize || (total !== null && rows.length >= total) || enough(rows)) break;
	}
	return { rows, total };
}
