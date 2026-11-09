import { ApiError } from '@lyeve-labs/client';

/** What a form action returns when the content plugin refused the values. */
export interface FieldRefusal {
	/** The banner sentence, with any message that names no field on the form. */
	error: string;
	/** The plugin's message for each field the form shows, by field name. */
	fieldErrors: Record<string, string>;
	/** The key inside a json field that a message is about, by field name. */
	errorKeys?: Record<string, string>;
}

/** One entry of the plugin's 422 body. */
interface ValidationEntry {
	field?: unknown;
	message?: unknown;
}

const CHECK_FIELDS = 'Check the highlighted fields.';

/**
 * The per-field messages of a 422 from the content plugin, or null for any
 * other failure.
 *
 * The plugin answers a value the schema refuses with an `errors` array and no
 * `error` key, so the client's message is the raw body text. Relayed as is,
 * the banner shows JSON and no field is marked. A message for a field the
 * form does not show stays in the banner, because a count of fields that
 * need attention would otherwise point at nothing on the screen.
 *
 * A field may be named as a path, `data.email`, for a key inside a json
 * field, either on an entry or as the answer's own `field` beside the list.
 * The message then belongs to `data`, and the key is returned so the editor
 * can mark its row.
 */
export function fieldRefusalOf(err: unknown, shown: string[]): FieldRefusal | null {
	if (!(err instanceof ApiError) || err.status !== 422) return null;
	const entries = (err.body as { errors?: unknown } | undefined)?.errors;
	if (!Array.isArray(entries) || entries.length === 0) return null;

	const onForm = new Set(shown);
	const fieldErrors: Record<string, string> = {};
	const errorKeys: Record<string, string> = {};
	const elsewhere: string[] = [];
	const path = (err.body as { field?: unknown }).field;
	for (const entry of entries as ValidationEntry[]) {
		const named = typeof entry?.field === 'string' ? entry.field : '';
		const message = typeof entry?.message === 'string' ? entry.message.trim() : '';
		if (!message) continue;
		const [field, key] = onForm.has(named) ? [named, keyUnder(named, path)] : splitPath(named);
		if (field && onForm.has(field)) {
			fieldErrors[field] ??= message;
			if (key) errorKeys[field] ??= key;
		} else {
			elsewhere.push(named ? `${named}: ${message}` : message);
		}
	}
	if (Object.keys(fieldErrors).length === 0 && elsewhere.length === 0) return null;

	const lead = Object.keys(fieldErrors).length > 0 ? CHECK_FIELDS : 'The entry was not saved.';
	const error = [lead, ...elsewhere.map((m) => (/[.!?]$/.test(m) ? m : `${m}.`))].join(' ');
	return Object.keys(errorKeys).length > 0 ? { error, fieldErrors, errorKeys } : { error, fieldErrors };
}

/** `data.email` as the field and the key below it. A name with no dot is the field alone. */
function splitPath(name: string): [string, string] {
	const dot = name.indexOf('.');
	return dot > 0 ? [name.slice(0, dot), name.slice(dot + 1)] : [name, ''];
}

/** The key the answer's own path names below field, or none. */
function keyUnder(field: string, path: unknown): string {
	if (typeof path !== 'string') return '';
	const [head, key] = splitPath(path);
	return head === field ? key : '';
}
