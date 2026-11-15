import type { Schema, SchemaField } from '@lyeve-labs/client';
import { humanizeFieldName } from './entry-identity';
import { inverseKey, isInverse } from '../relations';

/**
 * The view of one content type's entry list: its filter conditions, how they
 * combine, the order, the columns on screen, the status and the page size.
 *
 * The URL carries the view, so a link opens the same list. A cookie scoped to
 * the list's own path remembers the last view of each content type, and the
 * load reads it only when the URL names no view. The grammar is the admin
 * list's: `filters[key]=v`, `filters[key][op]=v`, `match`, `q` and `sort`,
 * plus the console's own `limit`, `offset` and `columns`.
 *
 * A filter key may also be a dotted path through relations to a field of the
 * related type, such as `author.name` or `author.company.name`. Which paths
 * exist depends on the related types' definitions, which the load reads.
 */

/** The page size a list opens at. */
export const DEFAULT_LIMIT = 100;

/** Newest change first, the order the admin list uses when asked for none. */
export const DEFAULT_SORT = '-updated_at';

export const ENTRY_STATUSES = ['draft', 'published', 'archived'] as const;
export type EntryStatus = (typeof ENTRY_STATUSES)[number];

export type FilterOp = 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'ncontains' | 'in' | 'nin' | 'empty';

/** Field types that filter the same way. */
export type Family = 'text' | 'number' | 'boolean' | 'date' | 'datetime' | 'relation' | 'presence';

const FAMILY_OF: Record<string, Family> = {
	uid: 'text',
	text: 'text',
	rich_text: 'text',
	email: 'text',
	url: 'text',
	number: 'number',
	integer: 'number',
	decimal: 'number',
	boolean: 'boolean',
	date: 'date',
	datetime: 'datetime',
	relation: 'relation',
	media: 'presence',
	json: 'presence',
};

/** The operators the admin list accepts for each family. Anything else answers 400. */
export const FAMILY_OPS: Record<Family, readonly FilterOp[]> = {
	text: ['contains', 'ncontains', 'eq', 'ne', 'in', 'nin', 'empty'],
	number: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'nin', 'empty'],
	boolean: ['eq', 'ne', 'empty'],
	date: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'empty'],
	datetime: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'empty'],
	relation: ['eq', 'ne', 'in', 'nin', 'empty'],
	presence: ['empty'],
};

/** Field types the admin list can order by. Text orders by its lowercase value. */
const SORTABLE_TYPES = new Set(['uid', 'text', 'email', 'url', 'number', 'integer', 'decimal', 'boolean', 'date', 'datetime']);

/** One condition as the URL states it. `empty` carries `true` or `false`. */
export interface Condition {
	key: string;
	op: FilterOp;
	values: string[];
}

export type Match = 'all' | 'any';

export interface View {
	filters: Condition[];
	match: Match;
	/** `key` reads ascending, `-key` descending. */
	sort: string;
	/** The optional columns on screen, in the table's order. The Entry column always shows. */
	columns: string[];
	status: EntryStatus | null;
	limit: number;
}

/** Something a condition can be written on: a field or one of the entry's own keys. */
export interface FilterKey {
	key: string;
	label: string;
	family: Family;
	field?: SchemaField;
}

/** The definitions of the content types a path can reach, by name. */
export type Definitions = Record<string, Schema>;

/**
 * The most relations a filter key walks, counting a relation it ends on. The
 * admin list refuses a longer path.
 */
export const MAX_PATH_RELATIONS = 2;

export interface ColumnChoice {
	key: string;
	label: string;
}

/** The column key of the entry's own status. A field may be named `status`, so this one cannot be. */
export const STATUS_COLUMN = '_status';

function userFields(schema: Schema): SchemaField[] {
	return (schema.fields ?? []).filter((f) => !f.system);
}

function declares(schema: Schema, name: string): boolean {
	return userFields(schema).some((f) => f.name === name);
}

/**
 * Whether the Status header orders by the entry's status. The admin list reads
 * a declared field before its own keys, so a field named `status` takes the
 * key and the entry's status has no sort of its own.
 */
export function sortsByStatus(schema: Schema): boolean {
	return !!schema.with_draft_publish && !declares(schema, 'status');
}

/** The entry's status column, named apart from a field that is called Status. */
export function statusLabel(schema: Schema): string {
	return declares(schema, 'status') ? 'Entry status' : 'Status';
}

/**
 * The field the Entry cell already names a row by. Printing it again as a
 * column would show every row's headline twice.
 */
export function labelFieldOf(schema: Schema): string | undefined {
	return ['title', 'slug'].find((name) => declares(schema, name));
}

/** The fields that can be columns of the table, in the content type's order. */
export function columnFieldsOf(schema: Schema): SchemaField[] {
	const label = labelFieldOf(schema);
	return userFields(schema).filter((f) => f.name !== label);
}

/** Every column a person can show or hide, in the table's order. */
export function columnChoices(schema: Schema): ColumnChoice[] {
	const out: ColumnChoice[] = columnFieldsOf(schema).map((f) => ({ key: f.name, label: humanizeFieldName(f.name) }));
	if (schema.with_draft_publish) out.push({ key: STATUS_COLUMN, label: statusLabel(schema) });
	out.push({ key: 'created_at', label: 'Created' });
	if (schema.with_updated_at) out.push({ key: 'updated_at', label: 'Updated' });
	return out;
}

/**
 * The type a relation field leads to, when the admin list can follow it: its
 * definition was read, and a has_one or has_many finds the key it reads on
 * the other side.
 */
function stepTarget(source: string, field: SchemaField, defs: Definitions): Schema | undefined {
	if (field.field_type !== 'relation' || !field.relation_to) return undefined;
	const target = defs[field.relation_to];
	if (!target) return undefined;
	if (isInverse(field) && !inverseKey(source, field, { ...target, fields: target.fields ?? [] }).ok) return undefined;
	return target;
}

/**
 * The keys through one relation path: the related type's fields, then the
 * fields one relation further. A relation the path cannot follow is offered
 * neither as a step nor as the field the path ends on.
 */
function pathKeys(source: Schema, path: string[], labels: string[], defs: Definitions, out: FilterKey[]): void {
	const steps: [SchemaField, Schema][] = [];
	for (const field of userFields(source)) {
		const family = FAMILY_OF[field.field_type];
		if (!family) continue;
		if (family === 'relation') {
			// A path that ends on a relation walks it too, so it counts.
			const target = stepTarget(source.name, field, defs);
			if (!target || path.length >= MAX_PATH_RELATIONS) continue;
			steps.push([field, target]);
		}
		out.push({
			key: [...path, field.name].join('.'),
			label: [...labels, humanizeFieldName(field.name)].join(', '),
			family,
			field,
		});
	}
	for (const [field, target] of steps) {
		pathKeys(target, [...path, field.name], [...labels, humanizeFieldName(field.name)], defs, out);
	}
}

/**
 * Every key a condition can name, the Entry first and the timestamps last,
 * then the fields of each related type under the relation's name.
 * Each declared field filters under its own name, as the admin list resolves
 * it, and a declared `title` is the Entry. The entry's own `published_at` is
 * offered only while no field takes the name. Its status is never a
 * condition, because the status parameter narrows by it. A related type
 * whose definition is not in `defs` offers no fields. A has_one or has_many
 * whose key cannot be read on a target in `defs` is not offered.
 */
export function filterKeys(schema: Schema, defs: Definitions = {}): FilterKey[] {
	const keys: FilterKey[] = [];
	const title = userFields(schema).find((f) => f.name === 'title');
	const titleFamily = title ? FAMILY_OF[title.field_type] : 'text';
	if (titleFamily) keys.push({ key: 'title', label: 'Entry', family: titleFamily, field: title });
	for (const field of userFields(schema)) {
		const family = FAMILY_OF[field.field_type];
		if (!family || field.name === 'title') continue;
		// The admin list refuses a has_one or has_many whose key it cannot read.
		// Without the target's definition that cannot be told, so it stays.
		const read = isInverse(field) && !!field.relation_to && field.relation_to in defs;
		if (read && !stepTarget(schema.name, field, defs)) continue;
		keys.push({ key: field.name, label: humanizeFieldName(field.name), family, field });
	}
	keys.push({ key: 'created_at', label: 'Created', family: 'datetime' });
	keys.push({ key: 'updated_at', label: 'Updated', family: 'datetime' });
	if (schema.with_draft_publish && !declares(schema, 'published_at')) {
		keys.push({ key: 'published_at', label: 'Published', family: 'datetime' });
	}
	for (const field of userFields(schema)) {
		const target = stepTarget(schema.name, field, defs);
		if (target) pathKeys(target, [field.name], [humanizeFieldName(field.name)], defs, keys);
	}
	return keys;
}

/**
 * The keys the list can be ordered by, each with the direction it reads first.
 * A name reads A to Z. A number and a date read largest and newest first,
 * because the question behind sorting by them is "which are the biggest" or
 * "which are the latest". A declared field takes its name from the entry's
 * own key, so a field of a type with no order removes that key.
 */
export function sortKeys(schema: Schema): Map<string, 'asc' | 'desc'> {
	const keys = new Map<string, 'asc' | 'desc'>([['title', 'asc']]);
	if (schema.with_draft_publish) {
		keys.set('status', 'asc');
		keys.set('published_at', 'desc');
	}
	for (const field of userFields(schema)) {
		if (!SORTABLE_TYPES.has(field.field_type)) {
			keys.delete(field.name);
			continue;
		}
		const family = FAMILY_OF[field.field_type];
		keys.set(field.name, family === 'text' || family === 'boolean' ? 'asc' : 'desc');
	}
	keys.set('created_at', 'desc');
	keys.set('updated_at', 'desc');
	return keys;
}

const NUMBER = /^-?\d+(\.\d+)?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * Whether the admin list accepts this value for this family and operator.
 * Text is matched as written, spaces included, so it only has to be more than
 * blanks.
 */
export function validValue(family: Family, op: FilterOp, value: string): boolean {
	if (op === 'empty') return value === 'true' || value === 'false';
	if (value.trim() === '') return false;
	switch (family) {
		case 'number':
			return NUMBER.test(value);
		case 'boolean':
			return value === 'true' || value === 'false';
		case 'date':
			return DATE.test(value);
		case 'datetime':
			return DATETIME.test(value);
		default:
			return true;
	}
}

export function isListOp(op: string): op is 'in' | 'nin' {
	return op === 'in' || op === 'nin';
}

const FILTER_PARAM = /^filters\[([^\]]+)\](?:\[([a-z]+)\])?$/;

/** The parameters that make up a view. `q` and `offset` move within one and are not part of it. */
const VIEW_PARAMS = ['match', 'sort', 'columns', 'limit', 'status'];

/** Whether a query names any part of a view. */
export function hasViewParam(params: URLSearchParams): boolean {
	for (const name of params.keys()) {
		if (VIEW_PARAMS.includes(name) || name.startsWith('filters[')) return true;
	}
	return false;
}

/**
 * The view a query asks for, checked against the content type. A condition
 * naming a field the content type no longer has, an operator its type does
 * not take or a value of the wrong shape is dropped, so an old link opens the
 * list rather than a refusal. A second condition with the same key and
 * operator is dropped too, except `in` and `nin`, which collect their values.
 * A path whose related type is gone, or was not read, is dropped the same way.
 */
export function readView(params: URLSearchParams, schema: Schema, limit: number, defs: Definitions = {}): View {
	const keys = new Map(filterKeys(schema, defs).map((k) => [k.key, k]));
	const filters: Condition[] = [];
	const seen = new Map<string, Condition>();
	for (const [name, raw] of params) {
		const m = FILTER_PARAM.exec(name);
		if (!m) continue;
		const key = keys.get(m[1]);
		const op = (m[2] ?? 'eq') as FilterOp;
		const value = key?.family === 'text' ? raw : raw.trim();
		if (!key || !FAMILY_OPS[key.family].includes(op) || !validValue(key.family, op, value)) continue;
		const id = `${op}:${key.key}`;
		const held = seen.get(id);
		if (held) {
			if (isListOp(op) && !held.values.includes(value)) held.values.push(value);
			continue;
		}
		const condition = { key: key.key, op, values: [value] };
		seen.set(id, condition);
		filters.push(condition);
	}

	const sortAsked = params.get('sort') ?? '';
	const sort = sortKeys(schema).has(sortAsked.replace(/^-/, '')) ? sortAsked : DEFAULT_SORT;

	const choices = columnChoices(schema).map((c) => c.key);
	const columnsAsked = params.get('columns');
	let columns = choices;
	if (columnsAsked === '') {
		columns = [];
	} else if (columnsAsked !== null) {
		const asked = new Set(columnsAsked.split(','));
		const kept = choices.filter((c) => asked.has(c));
		// A list naming only columns that are gone is an old link, not a
		// request for an empty table.
		if (kept.length > 0) columns = kept;
	}

	// A content type without draft and publish has no status to narrow by.
	const statusAsked = schema.with_draft_publish ? (params.get('status') ?? '') : '';
	const status = (ENTRY_STATUSES as readonly string[]).includes(statusAsked) ? (statusAsked as EntryStatus) : null;

	return { filters, match: params.get('match') === 'any' ? 'any' : 'all', sort, columns, status, limit };
}

function appendFilters(params: URLSearchParams, filters: Condition[], match: Match): void {
	for (const c of filters) {
		for (const value of isListOp(c.op) ? c.values : c.values.slice(0, 1)) {
			params.append(`filters[${c.key}][${c.op}]`, value);
		}
	}
	if (match === 'any' && filters.length > 1) params.set('match', 'any');
}

/**
 * A view as the page's query string, with a leading `?`, or the empty string.
 *
 * A part at its default is left out, so the first page of the default view is
 * a clean path. `explicit` keeps the page size even at its default, so a link
 * inside the page always names a view and the load never swaps in the saved
 * one: clearing the filters must not bring the remembered ones back.
 */
export function viewQuery(
	view: View,
	schema: Schema,
	{ explicit = false, q = '', offset = 0 }: { explicit?: boolean; q?: string; offset?: number } = {},
): string {
	const params = new URLSearchParams();
	if (explicit || view.limit !== DEFAULT_LIMIT || offset > 0) params.set('limit', String(view.limit));
	if (view.status) params.set('status', view.status);
	appendFilters(params, view.filters, view.match);
	if (view.sort !== DEFAULT_SORT) params.set('sort', view.sort);
	const all = columnChoices(schema).map((c) => c.key);
	if (view.columns.join(',') !== all.join(',')) params.set('columns', view.columns.join(','));
	if (q) params.set('q', q);
	if (offset > 0) params.set('offset', String(offset));
	const query = params.toString();
	return query ? `?${query}` : '';
}

/**
 * The admin list's query for a view. A part at its default is left out, so a
 * list with nothing chosen asks exactly what it asked before filters existed.
 */
export function apiQuery(schemaName: string, view: View, q: string, offset: number): URLSearchParams {
	const params = new URLSearchParams({ schema: schemaName, limit: String(view.limit), offset: String(offset) });
	if (view.status) params.set('status', view.status);
	if (q) params.set('q', q);
	appendFilters(params, view.filters, view.match);
	if (view.sort !== DEFAULT_SORT) params.set('sort', view.sort);
	return params;
}

/** The list's own path, which is also the path its cookie is scoped to. */
export function listPath(schemaName: string): string {
	return `/admin/content/${encodeURIComponent(schemaName)}`;
}

/**
 * The view and position a detail page's URL carries, as the query its way
 * back to the list takes. Only the list's own parameters come back, every
 * value of each, so a repeated `in` survives the round trip.
 */
export function listQueryFrom(url: URL): string {
	const params = new URLSearchParams();
	for (const [name, value] of url.searchParams) {
		if (VIEW_PARAMS.includes(name) || name === 'q' || name === 'offset' || FILTER_PARAM.test(name)) {
			params.append(name, value);
		}
	}
	const query = params.toString();
	return query ? `?${query}` : '';
}

/** The cookie that remembers a list's last view. Its path is the list's, so each content type has its own. */
export const VIEW_COOKIE = 'lyeve_entry_view';

/** Past this a browser may refuse the cookie or the request that carries it. */
export const VIEW_COOKIE_MAX_BYTES = 3500;

const YEAR_SECONDS = 365 * 24 * 60 * 60;

function cookieAttributes(schemaName: string, maxAge: number): string {
	const secure = location.protocol === 'https:' ? '; Secure' : '';
	return `; Path=${listPath(schemaName)}; Max-Age=${maxAge}; SameSite=Lax${secure}`;
}

/**
 * Remembers a view in this browser. A view too large to send back forgets the
 * one before it, which the person has left, so the plain list opens plain.
 */
export function rememberView(schemaName: string, query: string): void {
	const value = encodeURIComponent(query.replace(/^\?/, ''));
	if (value.length > VIEW_COOKIE_MAX_BYTES) {
		forgetView(schemaName);
		return;
	}
	document.cookie = `${VIEW_COOKIE}=${value}${cookieAttributes(schemaName, YEAR_SECONDS)}`;
}

/** Forgets the remembered view of one list. */
export function forgetView(schemaName: string): void {
	document.cookie = `${VIEW_COOKIE}=${cookieAttributes(schemaName, 0)}`;
}
