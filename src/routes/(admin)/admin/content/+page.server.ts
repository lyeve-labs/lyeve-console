import type { PageServerLoad } from './$types';
import { error, redirect } from '@sveltejs/kit';
import { getSchemaStats, getSchemas } from '@lyeve-labs/client-rest';
import type { Schema } from '@lyeve-labs/client';
import { pageOf, pageWindow, pastEndOffset, withOffset } from '$lib/api/list';
import { section, type Section } from '$lib/api/gate';
import {
	COLLECTION_FILTERS,
	filterCountsRows,
	filterFromParams,
	sortFromParams,
	type CollectionFilter,
	type CollectionSort,
	type SortDir
} from '$lib/api/collections';
import { authedClient, loadUser } from '$lib/server/authz';
import { couldNotLoad } from '$lib/outage';
import { rolesInWords } from '$lib/roles';

/**
 * Resolve typed text to exactly one collection.
 *
 * The picker on a collection page is a GET form, so an operator with no
 * JavaScript submits whatever is in the box and the answer has to be worked out
 * here. An operator reading a log types the machine name, an operator reading
 * the sidebar types the display name, and the picker's own option label is
 * "Display (machine)", so all three arrive at this function. Anything that
 * still matches more than one collection is a search rather than a
 * destination, and the index renders it.
 */
/** Whether a collection answers to a typed fragment, by either of its names. */
function matches(schema: Schema, needle: string): boolean {
	if (!needle) return true;
	return (
		schema.name.toLowerCase().includes(needle) ||
		(schema.display_name || '').toLowerCase().includes(needle)
	);
}

function resolveSchema(schemas: Schema[], typed: string): Schema | null {
	const raw = typed.trim();
	if (!raw) return null;

	// The picker's option label carries the machine name in brackets so it can
	// be searched. Submitted without JavaScript, that whole label lands here.
	const bracketed = /\(([^)]+)\)\s*$/.exec(raw);
	for (const candidate of bracketed ? [bracketed[1], raw] : [raw]) {
		const needle = candidate.toLowerCase();
		const exact =
			schemas.find((s) => s.name === candidate) ??
			schemas.find((s) => s.name.toLowerCase() === needle) ??
			schemas.find((s) => (s.display_name || '').toLowerCase() === needle);
		if (exact) return exact;
	}

	const needle = raw.toLowerCase();
	const partial = schemas.filter(
		(s) =>
			s.name.toLowerCase().includes(needle) ||
			(s.display_name || '').toLowerCase().includes(needle),
	);
	return partial.length === 1 ? partial[0] : null;
}

/**
 * The content index.
 *
 * It lists the collections a tenant has, so there is always a way back to
 * one. It redirects only for a tenant with a single collection, where the
 * index would be one link and the hop saves a click, and only when nothing
 * was typed: a search is a request to see the results, not to be sent
 * somewhere.
 */
/** The page size when a request names none. */
const DEFAULT_LIMIT = 50;

/**
 * One above the page size is what the request asks for, so the page can say
 * whether another one exists. The ceiling stays below the engine's own so that
 * probe row is never the row the engine clamped away.
 */
const MAX_LIMIT = 199;

/** What the index says when the collections could not be read. */
const LIST_FAILED = couldNotLoad('collections');

/**
 * The roles the content plugin serves. Every one of its routes refuses the
 * rest, so a reader below admin who opens the page by URL is told so instead
 * of being offered collections whose entries no button can open.
 */
const CONTENT_ROLES = ['admin', 'super_admin'];

/** What the stats endpoint says about one collection, as far as the index reads it. */
export interface CollectionStats {
	rows: number;
	/**
	 * When a row last changed, or null for an empty table. Undefined when the
	 * engine does not send it, which the column shows as a dash.
	 */
	last_updated?: string | null;
}

/** Stats by collection name, asked of the endpoint one collection at a time. */
async function statsFor(
	schemas: Schema[],
	client: Parameters<typeof getSchemaStats>[1]
): Promise<Record<string, CollectionStats>> {
	const stats = await Promise.allSettled(
		schemas.map((s) => getSchemaStats(s.name, client) as Promise<CollectionStats>)
	);
	const out: Record<string, CollectionStats> = {};
	stats.forEach((result, i) => {
		if (result.status === 'fulfilled') {
			out[schemas[i].name] = { rows: result.value.rows, last_updated: result.value.last_updated };
		}
	});
	return out;
}

/** Whether a collection belongs to a filter's subset. A collection whose rows could not be read belongs to neither rows subset. */
function passes(schema: Schema, filter: CollectionFilter, stats: Record<string, CollectionStats>): boolean {
	switch (filter) {
		case 'all':
			return true;
		case 'with-rows':
			return (stats[schema.name]?.rows ?? 0) > 0;
		case 'empty':
			return stats[schema.name]?.rows === 0;
		case 'draft-publish':
			return Boolean(schema.with_draft_publish);
		case 'localized':
			return Boolean(schema.with_localization);
		case 'soft-delete':
			return Boolean(schema.with_soft_delete);
	}
}

/**
 * The matching set in the order asked for.
 *
 * A value that could not be read sorts after every value that could, in
 * either direction: an unread count is not a zero, and a table with no
 * timestamp is not the oldest. Putting either among the real values would
 * say something nobody measured. Ties fall back to the name so the order is
 * stable across requests.
 */
function ordered(
	schemas: Schema[],
	sort: CollectionSort,
	dir: SortDir,
	stats: Record<string, CollectionStats>
): Schema[] {
	const sign = dir === 'asc' ? 1 : -1;
	const byName = (a: Schema, b: Schema) => a.name.localeCompare(b.name, undefined, { numeric: true });
	const fields = (s: Schema) => (s.fields ?? []).filter((f) => !f.system).length;
	const measured = (s: Schema): number | undefined => {
		const st = stats[s.name];
		if (!st) return undefined;
		if (sort === 'rows') return st.rows;
		return st.last_updated ? Date.parse(st.last_updated) : undefined;
	};
	return [...schemas].sort((a, b) => {
		if (sort === 'name') return sign * byName(a, b);
		if (sort === 'fields') return sign * (fields(a) - fields(b)) || byName(a, b);
		const va = measured(a);
		const vb = measured(b);
		if (va === undefined || vb === undefined) {
			if (va === undefined && vb === undefined) return byName(a, b);
			return va === undefined ? 1 : -1;
		}
		return sign * (va - vb) || byName(a, b);
	});
}

export const load: PageServerLoad = async (event) => {
	const { url } = event;
	const user = await loadUser(event);
	if (!user.roles.some((r) => CONTENT_ROLES.includes(r))) {
		error(403, `Only ${rolesInWords(CONTENT_ROLES)} can open this page.`);
	}
	const client = authedClient(event);
	const read: Section<Schema[]> = await section(getSchemas(client), LIST_FAILED);
	// The content type picker posts schema, and the index's search posts q.
	// Only a pick opens a content type: the search runs as the reader types,
	// so a half-typed word that matches one name must not open it.
	const picked = (url.searchParams.get('schema') ?? '').trim();
	const typed = (picked || url.searchParams.get('q') || '').trim();
	const { sort, dir } = sortFromParams(url.searchParams);
	const filter = filterFromParams(url.searchParams);
	const { limit, offset } = pageWindow(url, DEFAULT_LIMIT, MAX_LIMIT);

	// Nothing was read, so there is nothing to resolve, count or page. The
	// page draws the gate in place of the list and keeps the controls' state.
	if (!read.ok) {
		return {
			schemas: read as Section<Schema[]>,
			stats: {} as Record<string, CollectionStats>,
			query: typed,
			sort,
			dir,
			filter,
			limit,
			offset,
			total: 0,
			hasMore: false
		};
	}
	const all = read.value;

	/*
	 * Resolution and the single-collection redirect both read the whole set,
	 * because a name typed into the picker can match a collection on any page
	 * and "this tenant has exactly one collection" is a fact about the set and
	 * not about the page on screen. Only the list that renders is bounded.
	 */
	const target = resolveSchema(all, picked);
	if (target) {
		redirect(302, `/admin/content/${encodeURIComponent(target.name)}`);
	}
	if (!typed && all.length === 1) {
		redirect(302, `/admin/content/${encodeURIComponent(all[0].name)}`);
	}

	/*
	 * The search narrows before the page is cut, so the pager counts what the
	 * operator asked for. Narrowing after would page the whole set and then hide
	 * most of the page, leaving a next button that leads to an empty screen.
	 */
	const needle = typed.toLowerCase();
	const searched = needle ? all.filter((s) => matches(s, needle)) : all;

	/*
	 * A row count per collection on this page, not per collection in the
	 * tenant: the schema page asks for all of them at once, and the index has
	 * no reason to. Sorting by rows or by last change, and narrowing to the
	 * empty or the populated ones, are the reasons: an order or a subset has to
	 * be decided before the page is cut, so those read the whole searched set.
	 * A collection that cannot be read is left out, and the row says so rather
	 * than showing zero.
	 */
	const countsTheSet = sort === 'rows' || sort === 'updated' || filterCountsRows(filter);
	const setStats = countsTheSet ? await statsFor(searched, client) : {};
	const matching = searched.filter((s) => passes(s, filter, setStats));
	const sorted = ordered(matching, sort, dir, setStats);

	/*
	 * The schemas endpoint answers with a bare array and no row count, so the
	 * total is not something the response states. It is knowable here anyway,
	 * because the whole array is in hand: the slice is what bounds the page, and
	 * the count is measured rather than invented.
	 */
	const page = pageOf<Schema>(sorted.slice(offset, offset + limit + 1), limit, 0);
	const back = pastEndOffset(page.rows.length, limit, offset, matching.length);
	if (back !== null) redirect(307, withOffset(url, back));

	const stats = countsTheSet ? setStats : await statsFor(page.rows, client);
	const schemas: Section<Schema[]> = { ok: true, value: page.rows };

	return {
		schemas,
		stats,
		query: typed,
		sort,
		dir,
		filter,
		limit,
		offset,
		total: matching.length,
		hasMore: page.hasMore
	};
};
