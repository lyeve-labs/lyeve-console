import type { RequestEvent } from '@sveltejs/kit';
import { authedHeaders } from '$lib/server/authz';
import { couldNotLoad } from '$lib/outage';
import { plural } from '$lib/format';

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

	const res = await fetch(`${base}?field=${encodeURIComponent(fieldName)}&limit=500&offset=0`, {
		headers,
	});
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
