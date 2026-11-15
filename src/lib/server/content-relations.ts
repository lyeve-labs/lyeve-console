import type { RequestEvent } from '@sveltejs/kit';
import { ApiError, type HttpClient, type Schema, type SchemaField } from '@lyeve-labs/client';
import { getSchema } from '@lyeve-labs/client-rest';
import type { InverseEntries } from '$lib/components/content/inverse-entries';
import { inverseKey, isInverse } from '$lib/relations';
import { totalOf, type ListEnvelope } from '$lib/api/list';
import { entryLabel } from '$lib/utils/entry-identity';
import { DEFAULT_LIMIT, apiQuery, listPath, readView, viewQuery } from '$lib/utils/entry-view';
import { authedHeaders } from '$lib/server/authz';
import { couldNotLoad } from '$lib/outage';
import { plural } from '$lib/format';

/**
 * The most links of one field a read takes. The editor's read and the save's
 * read ask for the same rows, so a link past them is neither shown nor removed.
 */
const LINK_LIMIT = 500;

function linksPath(entryID: string, fieldName: string): string {
	return `/api/admin/content/${encodeURIComponent(entryID)}/relationships?field=${encodeURIComponent(fieldName)}&limit=${LINK_LIMIT}&offset=0`;
}

/**
 * The target ids of each many_to_many field of an entry, read from the rows a
 * save reconciles. The body holds no link, so a picker seeded from the body
 * alone opens empty, and the save that follows deletes every link. A field
 * whose rows could not be read is listed in `failed`, and the editor leaves it
 * out of the save so its links stay as they are.
 */
export async function readEntryLinks(
	client: HttpClient,
	entryID: string,
	fields: readonly SchemaField[],
): Promise<{ links: Record<string, string[]>; failed: string[] }> {
	const linked = fields.filter(
		(f) => !f.system && f.field_type === 'relation' && f.relation_type === 'many_to_many',
	);
	const read = await Promise.all(
		linked.map(async (f) => {
			try {
				const body = await client.get<unknown>(linksPath(entryID, f.name));
				const rows = Array.isArray(body) ? body : (body as { data?: unknown } | null)?.data;
				if (!Array.isArray(rows)) return { name: f.name, ids: null };
				const ids = rows.map((row) => String((row as { target_id?: unknown }).target_id ?? '')).filter(Boolean);
				return { name: f.name, ids };
			} catch {
				return { name: f.name, ids: null };
			}
		}),
	);
	const links: Record<string, string[]> = {};
	const failed: string[] = [];
	for (const { name, ids } of read) {
		if (ids) links[name] = ids;
		else failed.push(name);
	}
	return { links, failed };
}

/**
 * A many_to_many field whose links did not all reach the plugin. The entry
 * itself was written, so the action says that and names the field instead
 * of reporting the whole save as failed or as done.
 */
export class RelationWriteError extends Error {
	constructor(
		readonly field: string,
		message: string,
	) {
		super(message);
		this.name = 'RelationWriteError';
	}
}

/**
 * The many_to_many side of a content entry, written through the admin store.
 *
 * It lives here rather than in the editor because the create page needs the
 * same reconciliation: an entry and its pivot rows have to land in one store.
 * Writing the entry through the admin API and its relations through /api/v1
 * would hand the v1 store an id it has never seen.
 */
/**
 * Reconcile one many_to_many field to the given set of target ids.
 *
 * There is no endpoint that replaces a field's set. `/relationships/{id}`
 * updates a single relationship named by its own id, so it cannot take a
 * field's whole set.
 *
 * The set is reconciled instead: rows whose target is no longer selected are
 * deleted, newly selected targets are created, and rows that are already right
 * are left alone so their sort order survives.
 */
export async function setRelations(
	event: RequestEvent,
	entryID: string,
	fieldName: string,
	ids: string[],
) {
	// Through authedHeaders, not a bag built here: the DELETE and POST below are
	// writes, and event.fetch forwards the session cookie, so the engine applies
	// the double-submit CSRF check and refuses a call carrying Bearer alone.
	const headers = authedHeaders(event);
	const fetch = event.fetch;
	const base = `/api/admin/content/${encodeURIComponent(entryID)}/relationships`;

	const res = await fetch(linksPath(entryID, fieldName), { headers });
	if (!res.ok) {
		throw new RelationWriteError(fieldName, couldNotLoad(`the links in ${fieldName}`, { reload: true }));
	}
	const body = await res.json();
	const current = (Array.isArray(body) ? body : (body?.data ?? [])) as {
		id: string;
		target_id: string;
	}[];

	const wanted = new Set(ids);
	const held = new Set(current.map((r) => r.target_id));

	// Every response is read. The plugin refuses a link for a role, a missing
	// target or an outage, and a refusal left unread is a save reported as done
	// while the field still holds what it held.
	const removed = await Promise.all(
		current
			.filter((r) => !wanted.has(r.target_id))
			.map((r) =>
				fetch(`${base}/${encodeURIComponent(r.id)}`, { method: 'DELETE', headers }),
			),
	);

	const added = await Promise.all(
		ids
			.filter((id) => !held.has(id))
			.map((id, i) =>
				fetch(base, {
					method: 'POST',
					headers: { ...headers, 'Content-Type': 'application/json' },
					body: JSON.stringify({
						target_id: id,
						field_name: fieldName,
						rel_type: 'many_to_many',
						sort_order: i,
					}),
				}),
			),
	);

	const notRemoved = removed.filter((r) => !r.ok).length;
	const notAdded = added.filter((r) => !r.ok).length;
	if (notRemoved + notAdded > 0) {
		const parts = [
			notAdded > 0 ? `add ${notAdded} ${plural(notAdded, 'link')}` : '',
			notRemoved > 0 ? `remove ${notRemoved} ${plural(notRemoved, 'link')}` : '',
		].filter(Boolean);
		throw new RelationWriteError(fieldName, `Could not ${parts.join(' or ')} in ${fieldName}.`);
	}
}

/**
 * Reconcile every many_to_many field a form sent, one field at a time so a
 * refusal in one does not stop the rest. Answers null when every link landed,
 * and otherwise one sentence per field that did not.
 */
export async function setEntryRelations(
	event: RequestEvent,
	entryID: string,
	byField: Record<string, string[]>,
): Promise<string | null> {
	const fields = Object.keys(byField);
	const settled = await Promise.allSettled(
		fields.map((field) => setRelations(event, entryID, field, byField[field])),
	);
	const failures = settled.flatMap((result, i) => {
		if (result.status === 'fulfilled') return [];
		return result.reason instanceof RelationWriteError
			? [result.reason.message]
			: [`Could not save the links in ${fields[i]}. Try again.`];
	});
	return failures.length > 0 ? failures.join(' ') : null;
}

/** The most entries a has_one or has_many panel lists before it links to the rest. */
export const INVERSE_PAGE = 20;

type ListedRow = { id: string; title?: string; body?: Record<string, unknown> };

/**
 * The entries each has_one and has_many field of an entry resolves to, by
 * field name. The key lives on the other content type, so each field reads
 * that type's list filtered on the belongs_to the rule finds, the same request
 * the list page makes for that filter. Each other content type is read once,
 * however many fields point at it.
 */
export async function readInverseEntries(
	client: HttpClient,
	source: string,
	entryID: string,
	fields: readonly SchemaField[],
): Promise<Record<string, InverseEntries>> {
	const inverse = fields.filter((f) => !f.system && isInverse(f));
	const targets = [...new Set(inverse.map((f) => f.relation_to).filter((t): t is string => !!t))];
	// null when the content type is not there, undefined when it could not be read.
	const defs = new Map<string, Schema | null | undefined>(
		await Promise.all(
			targets.map(async (name) => {
				const def = await getSchema(name, client).then(
					(d): Schema | null | undefined => d,
					(err: unknown) => (err instanceof ApiError && err.status === 404 ? null : undefined),
				);
				return [name, def] as const;
			}),
		),
	);
	const read = await Promise.all(
		inverse.map(async (f): Promise<[string, InverseEntries]> => {
			const def = f.relation_to ? defs.get(f.relation_to) : null;
			if (def === undefined) return [f.name, { state: 'failed' }];
			const key = inverseKey(source, f, def ?? undefined);
			if (!key.ok || !def) return [f.name, { state: 'unresolved' }];
			const filter = new URLSearchParams({ [`filters[${key.field.name}][eq]`]: entryID });
			// The list drops a filter its field cannot take, and an unfiltered
			// read would show entries that do not point here.
			const view = readView(filter, def, INVERSE_PAGE);
			if (view.filters.length !== 1) return [f.name, { state: 'unresolved' }];
			try {
				const body = await client.get<ListEnvelope<ListedRow>>(`/api/admin/content?${apiQuery(def.name, view, '', 0)}`);
				const rows = body.data ?? [];
				const items = rows.map((row) => ({
					id: row.id,
					label: entryLabel({
						id: row.id,
						data: { ...(row.body ?? {}), ...(row.title !== undefined ? { title: row.title } : {}) },
					}),
					href: `${listPath(def.name)}/${encodeURIComponent(row.id)}`,
				}));
				const total = Math.max(totalOf(body), items.length);
				const listHref =
					total > items.length ? `${listPath(def.name)}${viewQuery({ ...view, limit: DEFAULT_LIMIT }, def)}` : null;
				return [f.name, { state: 'read', items, total, listHref }];
			} catch {
				return [f.name, { state: 'failed' }];
			}
		}),
	);
	return Object.fromEntries(read);
}
