import type { PageServerLoad, Actions } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { ApiError, type HttpClient, type Schema, type SchemaField } from '@lyeve-labs/client';
import { getSchemas, getSchema } from '@lyeve-labs/client-rest';
import { authedClient, exactParse, requireUser, withExactIntegers } from '$lib/server/authz';
import { actionFailure } from '$lib/server/action-error';
import { couldNotLoad } from '$lib/outage';
import { readError } from '$lib/server/read-error';
import { gateOf, section, type Gate, type Section } from '$lib/api/gate';
import { pageWindow, pastEndOffset, totalOf, withOffset, type ListEnvelope } from '$lib/api/list';
import { fieldKey } from '$lib/utils/content-form';
import { asked } from '$lib/server/asked';
import {
	DEFAULT_LIMIT,
	VIEW_COOKIE,
	apiQuery,
	hasViewParam,
	readView,
	viewQuery,
} from '$lib/utils/entry-view';

/** One row of the admin content listing, before it is reshaped for the table. */
type EntryRow = {
	id: string;
	title?: string;
	body?: Record<string, unknown>;
	status?: string;
	created_at: string;
	updated_at: string;
	/** The ids linked to the entry by each relation that is not belongs_to, by field name. */
	links?: Record<string, unknown>;
};

/**
 * The engine's own ceiling on a page size. It clamps anything larger instead of
 * refusing it, so a bigger request comes back silently truncated and the caller
 * cannot tell a full page from a short one. A limit+1 has-more probe above the
 * ceiling is served short and reads as the end of the collection while rows
 * remain. So the count comes off the envelope, and no request asks for more
 * than the server will give.
 */
const MAX_LIMIT = 500;

const ENTRIES_FAILED = couldNotLoad('entries');
const SCHEMAS_FAILED = couldNotLoad('the other content types');

/**
 * The admin list refuses a filter it cannot apply with a 400. The load drops
 * what the content type does not allow, so a refusal left over is one this
 * console could not foresee, and the reader's way out is the filters.
 */
const FILTERS_REFUSED = 'Could not load entries with these filters. Change or clear the filters.';

function entriesGate(err: unknown): Gate {
	if (err instanceof ApiError && err.status === 400) return { state: 'error', message: FILTERS_REFUSED };
	return gateOf(err, ENTRIES_FAILED);
}

/**
 * Entries are listed through the admin API, which holds every entry with its
 * status and history, those written in the console and those written through
 * the Content API alike. The load normalizes the admin rows into the shape the
 * page table expects (data.<field> plus data._status).
 *
 * The view (filters, order, columns, status and page size) comes from the URL.
 * A URL that names none opens the view this browser last used on this list,
 * by a redirect, so the address shows it and the page never draws the
 * unfiltered list first. The page writes that cookie, never the load: hover
 * preloading runs a load for links nobody opens.
 */
export const load: PageServerLoad = async (event) => {
	const { params, url, cookies } = event;
	const client = authedClient(event);

	const { limit, offset } = pageWindow(url, DEFAULT_LIMIT, MAX_LIMIT);
	const q = (url.searchParams.get('q') ?? '').trim();

	const [schemas, schemaDef] = await Promise.all([
		section<Schema[]>(getSchemas(client), SCHEMAS_FAILED),
		getSchema(params.schema, client).catch((err: unknown) => readError(err, `Content type "${params.schema}" not found`)),
	]);

	if (!hasViewParam(url.searchParams)) {
		const saved = cookies.get(VIEW_COOKIE);
		// Only a page view opens the saved view. A form posted to this page
		// without JavaScript runs its action and then this load, and a
		// redirect there would send the browser to repeat the post at an
		// address with no action.
		if (saved && event.request.method === 'GET') {
			const savedUrl = new URL(url);
			savedUrl.search = saved;
			const view = readView(savedUrl.searchParams, schemaDef, pageWindow(savedUrl, DEFAULT_LIMIT, MAX_LIMIT).limit);
			// A saved view that is the default one, or that no longer applies to
			// this content type, opens the plain list.
			if (viewQuery(view, schemaDef)) {
				const kept = Number(url.searchParams.get('offset')) || 0;
				redirect(307, `${url.pathname}${viewQuery(view, schemaDef, { explicit: true, q, offset: kept })}`);
			}
		}
	}

	const view = readView(url.searchParams, schemaDef, limit);
	const fields = schemaDef.fields ?? [];
	const listed = await section(
		client.get<ListEnvelope<EntryRow>>(`/api/admin/content?${apiQuery(params.schema, view, q, offset)}`),
		entriesGate,
	);

	const base = {
		schemas,
		schemaDef,
		activeSchema: params.schema,
		status: view.status,
		limit,
		offset,
		q,
		view,
	};
	if (!listed.ok) {
		return { ...base, items: listed as Section<ListedEntry[]>, total: 0 };
	}

	const rows = listed.value.data ?? [];
	// The table shows an integer field's stored digits, which the plain read
	// rounds past 2^53.
	const exactRows = ((exactParse(listed.value) as ListEnvelope<EntryRow> | undefined)?.data ?? []) as EntryRow[];
	const entries: ListedEntry[] = rows.map((e, i) => ({
		id: e.id,
		created_at: e.created_at,
		updated_at: e.updated_at,
		data: {
			...(e.body && typeof e.body === 'object'
				? withExactIntegers(fields, e.body as Record<string, unknown>, exactRows[i]?.body)
				: {}),
			...(e.title !== undefined ? { title: e.title } : {}),
			_status: e.status ?? 'published',
		} as Record<string, unknown>,
	}));
	for (const [i, entry] of entries.entries()) withLinks(fields, entry.data, rows[i].links);

	// total_count counts the collection, while rows.length counts this page alone.
	// totalOf falls back to the page length when a response carries no count,
	// and that fallback is smaller than the rows already paged past, which
	// would leave the pager claiming fewer entries than the table shows.
	const total = Math.max(totalOf(listed.value), offset + entries.length);
	const back = pastEndOffset(entries.length, limit, offset, totalOf(listed.value));
	if (back !== null) redirect(307, withOffset(url, back));

	await nameRelatedEntries(client, fields, entries);

	const items: Section<ListedEntry[]> = { ok: true, value: entries };
	return { ...base, items, total };
};

/** One entry as the table reads it. */
type ListedEntry = {
	id: string;
	created_at: string;
	updated_at: string;
	data: Record<string, unknown>;
};

type ListedItem = { data: Record<string, unknown> };

/**
 * A to-many relation made through the relationships endpoint lives beside
 * the entry, never in its body, so the list sends those ids apart from the
 * body. Each field's value becomes the union of the two, so a cell counts
 * every link. A row from an engine that sends no links keeps its body.
 */
function withLinks(fields: SchemaField[], data: Record<string, unknown>, links: Record<string, unknown> | undefined): void {
	if (!links) return;
	const idOf = (v: unknown) => (v !== null && typeof v === 'object' ? (v as { id?: unknown }).id : v);
	for (const f of fields) {
		const linked = links[f.name];
		if (f.field_type !== 'relation' || (f.relation_type ?? 'belongs_to') === 'belongs_to' || !Array.isArray(linked)) {
			continue;
		}
		const held = Array.isArray(data[f.name]) ? (data[f.name] as unknown[]) : [];
		const ids = new Set(held.map(idOf));
		const merged = [...held, ...linked.filter((id) => !ids.has(id))];
		// An entry with no links arrives with an empty list, and a cell draws an
		// empty list as "0 items" where it draws a missing value as "Not set".
		if (merged.length > 0 || Array.isArray(data[f.name])) data[f.name] = merged;
	}
}

/**
 * A link to one entry of another content type is stored as that entry's id,
 * and a column of ids tells the reader nothing. Each linked content type is
 * read once, and every id it holds is replaced by the entry's id and title,
 * the populated shape the table cell already shows by its title. An id the
 * read does not find stays as it is. The link is read under its key column,
 * where the console's form writes it, then under the field name, and is
 * always handed to the table under the field name.
 */
async function nameRelatedEntries(
	client: HttpClient,
	fields: SchemaField[],
	items: ListedItem[],
): Promise<void> {
	const links = fields.filter(
		(f) => f.field_type === 'relation' && f.relation_to && (f.relation_type ?? 'belongs_to') === 'belongs_to',
	);
	// An empty key column is a form left blank, so the field name decides.
	const linkOf = (it: ListedItem, f: SchemaField) => {
		const key = it.data[fieldKey(f)];
		return key === undefined || key === null || key === '' ? it.data[f.name] : key;
	};
	const wanted = new Set<string>();
	for (const f of links) {
		if (items.some((it) => typeof linkOf(it, f) === 'string' && linkOf(it, f) !== '')) {
			wanted.add(f.relation_to as string);
		}
	}
	if (wanted.size === 0) return;

	const titles = new Map<string, string>();
	await Promise.all(
		[...wanted].map(async (schema) => {
			const body = await client
				.get<ListEnvelope<EntryRow> | null>(
					`/api/admin/content?schema=${encodeURIComponent(schema)}&limit=${MAX_LIMIT}&offset=0`,
				)
				.catch(() => null);
			if (!body) return;
			for (const e of body.data ?? []) {
				if (e.id && e.title) titles.set(e.id, e.title);
			}
		}),
	);

	for (const f of links) {
		for (const it of items) {
			const id = linkOf(it, f);
			if (typeof id === 'string' && titles.has(id)) {
				it.data[f.name] = { id, title: titles.get(id) };
			} else if (id !== undefined && (typeof it.data[f.name] !== 'object' || it.data[f.name] === null)) {
				// A linked entry the body already carries stays as it is.
				it.data[f.name] = id;
			}
		}
	}
}

export const actions: Actions = {
	delete: asked(
		{
			question: 'Delete this entry?',
			detail: 'Its revisions and translations are deleted too.',
			label: 'Delete',
		},
		async (event) => {
			await requireUser(event);
			const { request } = event;
			const client = authedClient(event);
			const form = await request.formData();
			const id = form.get('id') as string;
			if (!id) return fail(400, { error: 'This form is missing its entry. Reload the page and try again.' });
			try {
				await client.delete(`/api/admin/content/${encodeURIComponent(id)}`);
				return { ok: true };
			} catch (err) {
				return actionFailure(err, 'Could not delete the entry. Try again.');
			}
		},
	),
};
