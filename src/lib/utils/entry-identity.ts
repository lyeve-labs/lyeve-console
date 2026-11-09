import type { SchemaField } from '@lyeve-labs/client';
import { text } from '$lib/api/narrow';

/**
 * Which part of an entry produced the name on screen.
 *
 * The caller needs this, not just the string. A name that came from the entry's
 * own title column is the author's name for the thing. A name lifted out of a
 * field called `subject` is a guess that happens to read well. The two are
 * presented differently, and a row with no name at all has to fall back to its
 * id rather than render an empty link.
 */
export type EntryTitleSource = 'title' | 'slug' | 'field' | 'none';

export interface EntryTitle {
	/** Empty only when the source is 'none'. */
	label: string;
	source: EntryTitleSource;
	/** The schema field the label came from. Set only when the source is 'field'. */
	field?: string;
}

/**
 * An entry as the admin listing and the editor hold it: identity at the top
 * level, author-supplied values under `data`. The admin API answers with title
 * and slug as columns beside the body, and the loads fold the body into `data`,
 * so both places have to be read for the same key.
 */
export interface IdentifiableEntry {
	id: string;
	title?: unknown;
	slug?: unknown;
	data?: Record<string, unknown>;
}

/**
 * Field names an author uses for the thing's name, in the order they are
 * tried. A schema is free to call its name column anything, so this is a
 * convention and not a contract: it decides what to show, never what to store.
 */
const NAME_FIELDS = ['title', 'name', 'label', 'heading', 'subject'] as const;

/** The conventional name fields, for a caller with no schema to consult. */
const ANY_NAME_FIELD: readonly Pick<SchemaField, 'name'>[] = NAME_FIELDS.map((name) => ({ name }));

/**
 * The value at `key`, from the top level first and then from `data`.
 *
 * The interface declares only the keys this module names, so it carries no
 * index signature and a direct cast to a record is not a widening the compiler
 * will accept. Going through `unknown` states that the shape is being read
 * dynamically on purpose, which is the whole point: a schema is free to call
 * its name column anything.
 */
function readKey(entry: IdentifiableEntry, key: string): unknown {
	const top = (entry as unknown as Record<string, unknown>)[key];
	if (top !== undefined && top !== null && top !== '') return top;
	return entry.data?.[key];
}

/**
 * Resolve the name an operator would recognize the entry by.
 *
 * Eight characters of a UUID are neither what the author named the thing nor
 * something a person can scan a page of. The order below is the order an author would expect: the entry's own
 * title, the slug it is published under, then whichever of the conventional
 * name fields the schema actually declares.
 *
 * `fields` is walked in schema order rather than NAME_FIELDS order, so a schema
 * that declares both `heading` and `subject` shows whichever its author put
 * first.
 */
export function entryTitle(
	entry: IdentifiableEntry,
	fields: readonly Pick<SchemaField, 'name'>[] = [],
): EntryTitle {
	const title = text(readKey(entry, 'title'));
	if (title) return { label: title, source: 'title' };

	const slug = text(readKey(entry, 'slug'));
	if (slug) return { label: slug, source: 'slug' };

	for (const field of fields) {
		if (!NAME_FIELDS.includes(field.name as (typeof NAME_FIELDS)[number])) continue;
		const value = text(readKey(entry, field.name));
		if (value) return { label: value, source: 'field', field: field.name };
	}

	return { label: '', source: 'none' };
}

/**
 * The first eight characters of an id, for the line under a resolved name.
 *
 * A truncated id is a locator and never an identity: it is what an operator
 * copies into a query, and it is why the full id stays on the entry page.
 */
export function shortId(id: string): string {
	return id.slice(0, 8);
}

/**
 * Turn a column name into a column header.
 *
 *     published_at  ->  Published At
 *     publishedAt   ->  Published At
 *
 * Splitting on case as well as on separators means a camelCase schema reads
 * the same as a snake_case one.
 */
export function humanizeFieldName(name: string): string {
	return name
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.split(/[\s_-]+/)
		.filter(Boolean)
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
		.join(' ');
}

/**
 * The name to show for an entry whose schema is not to hand, such as an option
 * in a relation picker.
 *
 * Every conventional name field is tried, because there is no schema here to
 * say which of them the collection declares, and the short id stands in when
 * none of them holds anything. A picker option has to read as something, and an
 * option with an empty label is one a user cannot tell from the next.
 */
export function entryLabel(entry: IdentifiableEntry): string {
	return entryTitle(entry, ANY_NAME_FIELD).label || shortId(entry.id);
}
