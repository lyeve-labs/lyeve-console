import type { PageServerLoad, Actions } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { type HttpClient, type Schema, type SchemaField } from '@lyeve-labs/client';
import { getSchemas, getSchema } from '@lyeve-labs/client-rest';
import { authedClient, exactParse, requireUser, withExactIntegers } from '$lib/server/authz';
import { actionFailure } from '$lib/server/action-error';
import { couldNotLoad } from '$lib/outage';
import { readError } from '$lib/server/read-error';
import { section, type Section } from '$lib/api/gate';
import { pageWindow, pastEndOffset, totalOf, withOffset, type ListEnvelope } from '$lib/api/list';
import { fieldKey } from '$lib/utils/content-form';
import { asked } from '$lib/server/asked';

/** One row of the admin content listing, before it is reshaped for the table. */
type EntryRow = {
	id: string;
	title?: string;
	body?: Record<string, unknown>;
	status?: string;
	created_at: string;
	updated_at: string;
};

const DEFAULT_LIMIT = 100;

/**
 * The engine's own ceiling on a page size. It clamps anything larger instead of
 * refusing it, so a bigger request comes back silently truncated and the caller
 * cannot tell a full page from a short one. A limit+1 has-more probe above the
 * ceiling is served short and reads as the end of the collection while rows
 * remain. So the count comes off the envelope, and no request asks for more
 * than the server will give.
 */
const MAX_LIMIT = 500;

/** The statuses the listing route filters on. Anything else lists every entry. */
const ENTRY_STATUSES = ['draft', 'published', 'archived'] as const;
type EntryStatus = (typeof ENTRY_STATUSES)[number];

function statusFrom(url: URL): EntryStatus | null {
	const asked = url.searchParams.get('status');
	return (ENTRY_STATUSES as readonly string[]).includes(asked ?? '') ? (asked as EntryStatus) : null;
}

const ENTRIES_FAILED = couldNotLoad('entries');
const SCHEMAS_FAILED = couldNotLoad('the other content types');

/**
 * Entries are listed through the admin API, which holds every entry with its
 * status and history, those written in the console and those written through
 * the Content API alike. The load normalizes the admin rows into the shape the
 * page table expects (data.<field> plus data._status).
 */
export const load: PageServerLoad = async (event) => {
	const { params, url } = event;
	const client = authedClient(event);

	const { limit, offset } = pageWindow(url, DEFAULT_LIMIT, MAX_LIMIT);
	const status = statusFrom(url);
	const query = new URLSearchParams({ schema: params.schema, limit: String(limit), offset: String(offset) });
	if (status) query.set('status', status);

	const [schemas, schemaDef, listed] = await Promise.all([
		section<Schema[]>(getSchemas(client), SCHEMAS_FAILED),
		getSchema(params.schema, client).catch((err: unknown) => readError(err, `Content type "${params.schema}" not found`)),
		section(client.get<ListEnvelope<EntryRow>>(`/api/admin/content?${query}`), ENTRIES_FAILED),
	]);

	const base = { schemas, schemaDef, activeSchema: params.schema, status, limit, offset };
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
				? withExactIntegers(schemaDef.fields ?? [], e.body as Record<string, unknown>, exactRows[i]?.body)
				: {}),
			...(e.title !== undefined ? { title: e.title } : {}),
			_status: e.status ?? 'published',
		} as Record<string, unknown>,
	}));

	// total_count counts the collection, while rows.length counts this page alone.
	// totalOf falls back to the page length when a response carries no count,
	// and that fallback is smaller than the rows already paged past, which
	// would leave the pager claiming fewer entries than the table shows.
	const total = Math.max(totalOf(listed.value), offset + entries.length);
	const back = pastEndOffset(entries.length, limit, offset, totalOf(listed.value));
	if (back !== null) redirect(307, withOffset(url, back));

	await nameRelatedEntries(client, schemaDef.fields ?? [], entries);

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
