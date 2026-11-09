import type { HttpClient, SchemaField } from '@lyeve-labs/client';
import { record } from './narrow';

/** Where a translation is in its life. */
export type TranslationStatus = 'draft' | 'translated' | 'outdated';

/**
 * One locale's translation of a content entry, as the localization plugin
 * stores it. The shape follows the entry itself: `title` is its own column
 * and every other translated field lives under `body`, keyed by field name.
 */
export interface Translation {
	id?: string;
	entry_id?: string;
	locale: string;
	title: string;
	body: Record<string, unknown>;
	meta?: Record<string, unknown>;
	translation_status: TranslationStatus;
	updated_at?: string;
}

/** What the plugin sends and accepts for a translation's content. */
export interface TranslationInput {
	title?: string;
	body?: Record<string, unknown>;
	translation_status?: TranslationStatus;
}

/**
 * The tenant's locale configuration. `default_locale` is the language the
 * source fields are written in, `enabled_locales` the ones a translation may
 * be kept in, and `fallback_chain` the order a missing translation is
 * resolved through before the source is served.
 */
export interface LocalePreferences {
	default_locale: string;
	enabled_locales: string[];
	fallback_chain: string[];
}

function asStrings(v: unknown): string[] {
	return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/** Normalize a row the plugin answers with, whatever it left out. */
export function toTranslation(raw: Record<string, unknown>): Translation {
	const status = raw.translation_status;
	return {
		id: typeof raw.id === 'string' ? raw.id : undefined,
		entry_id: typeof raw.entry_id === 'string' ? raw.entry_id : undefined,
		locale: String(raw.locale ?? ''),
		title: typeof raw.title === 'string' ? raw.title : '',
		body: record(raw.body),
		meta: raw.meta === undefined ? undefined : record(raw.meta),
		translation_status:
			status === 'translated' || status === 'outdated' ? status : 'draft',
		updated_at: typeof raw.updated_at === 'string' ? raw.updated_at : undefined,
	};
}

/** Normalize the locale preferences. A plugin that sends no chain reads as an empty one. */
export function toLocalePreferences(raw: Record<string, unknown>): LocalePreferences {
	return {
		default_locale: typeof raw.default_locale === 'string' ? raw.default_locale : '',
		enabled_locales: asStrings(raw.enabled_locales),
		fallback_chain: asStrings(raw.fallback_chain),
	};
}

export function getLocales(client: HttpClient): Promise<LocalePreferences> {
	return client
		.get<Record<string, unknown>>('/api/admin/localization/locales')
		.then(toLocalePreferences);
}

export function putLocales(client: HttpClient, prefs: LocalePreferences): Promise<LocalePreferences> {
	return client
		.put<Record<string, unknown>>('/api/admin/localization/locales', prefs)
		.then((res) => toLocalePreferences({ ...prefs, ...res }));
}

/**
 * Every translation the entry holds. The route answers the paginated
 * envelope every admin list uses. One entry has at most a handful of locales,
 * so the first page is the whole list.
 */
export async function listTranslations(client: HttpClient, entryId: string): Promise<Translation[]> {
	const res = await client.get<unknown>(
		`/api/admin/content/${encodeURIComponent(entryId)}/translations?limit=100&offset=0`,
	);
	const rows = Array.isArray(res) ? res : (record(res).data ?? []);
	return (Array.isArray(rows) ? rows : []).map((r) => toTranslation(record(r)));
}

export function createTranslation(
	client: HttpClient,
	entryId: string,
	locale: string,
	input: TranslationInput,
): Promise<Translation> {
	return client
		.post<Record<string, unknown>>(`/api/admin/content/${encodeURIComponent(entryId)}/translations`, {
			locale,
			...input,
		})
		.then(toTranslation);
}

export function updateTranslation(
	client: HttpClient,
	entryId: string,
	locale: string,
	input: TranslationInput,
): Promise<Translation> {
	return client
		.put<Record<string, unknown>>(
			`/api/admin/content/${encodeURIComponent(entryId)}/translations/${encodeURIComponent(locale)}`,
			input,
		)
		.then(toTranslation);
}

/**
 * The fields a translation can carry.
 *
 * A field says so with `localized` in the schema. A schema with no field
 * marked falls back to a guess from the type, which offers every text field,
 * so an editor never sees an empty panel that reads as translation switched
 * off. A schema gets the precise answer the moment one field is marked.
 */
export function translatableFields(fields: SchemaField[]): SchemaField[] {
	const marked = fields.filter((f) => !f.system && f.localized === true);
	if (marked.length > 0) return marked;
	return fields.filter(
		(f) => !f.system && (f.field_type === 'text' || f.field_type === 'rich_text'),
	);
}

/** True when the schema has been marked, so the panel can say which it is doing. */
export function usesMarkedFields(fields: SchemaField[]): boolean {
	return fields.some((f) => !f.system && f.localized === true);
}

/** How much of one locale is written, against the fields that are translated. */
export interface Completeness {
	done: number;
	total: number;
	percent: number;
	missing: string[];
}

/**
 * Measure one locale.
 *
 * Whitespace is not a translation: a field holding a space is what a
 * half-finished paste leaves behind, and counting it reports a locale complete
 * that nobody has translated. A schema with nothing to translate is complete
 * rather than zero, because there is nothing outstanding and 0% sends somebody
 * looking for work that does not exist.
 *
 * This is the same rule the plugin applies server-side. It is computed here
 * too so the bar moves while an editor types, rather than only after a save.
 */
export function completenessOf(
	values: Record<string, string>,
	fields: SchemaField[],
): Completeness {
	const names = fields.map((f) => f.name);
	const missing = names.filter((n) => (values[n] ?? '').trim() === '');
	const total = names.length;
	const done = total - missing.length;
	return { done, total, percent: total === 0 ? 100 : Math.round((done / total) * 100), missing };
}

/**
 * Flatten a translation into the editor's field map, the way the entry
 * itself is flattened: body first, then the title column over it.
 */
export function translationValues(t: Translation | undefined, fields: SchemaField[]): Record<string, string> {
	const out: Record<string, string> = {};
	for (const f of fields) {
		const v = f.name === 'title' ? (t?.title ?? t?.body?.title) : t?.body?.[f.name];
		out[f.name] = typeof v === 'string' ? v : '';
	}
	return out;
}

/**
 * Split the editor's field map back into the plugin's shape. `title` goes to
 * its column and to the body both, for the same reason the entry save does:
 * the column is what reads back, the body is what the fields are validated
 * against.
 */
export function translationInput(values: Record<string, unknown>): TranslationInput {
	const body: Record<string, unknown> = {};
	// An empty field is left out rather than sent empty. The plugin lays every
	// body key over the source, so an empty string would reach the reader as an
	// empty field instead of the source's value.
	for (const [k, v] of Object.entries(values)) {
		if (typeof v === 'string' && v.trim() !== '') body[k] = v;
	}
	const title = body.title;
	return { ...(typeof title === 'string' ? { title } : {}), body };
}
