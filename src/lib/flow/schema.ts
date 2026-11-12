/**
 * How the inspector reads a node's JSON Schema. The catalog is the only
 * source of truth about a node type, so the widget choice is a function of
 * the schema alone and nothing here names a node type.
 */

import type { DatasourceOption, FlowOption, JsonSchema, SchemaOption, SystemEvent } from './types';

export type Widget =
	| 'expression'
	| 'string'
	| 'number'
	| 'boolean'
	| 'enum'
	| 'tags'
	| 'object'
	| 'map'
	| 'json'
	| 'schema'
	| 'field'
	| 'fields'
	| 'datasource'
	| 'flow'
	| 'event'
	| 'code'
	| 'grid'
	| 'choices';

/** The option a picker offers for a value it has no row for: the field turns into free text. */
export const CUSTOM = '__custom__';

/** The columns every content row carries whatever the schema declares. */
export const SYSTEM_FIELDS = ['id', 'created_at', 'updated_at'];

function typeOf(schema: JsonSchema): string {
	if (Array.isArray(schema.type)) {
		return schema.type.find((t) => t !== 'null') ?? 'string';
	}
	return schema.type ?? '';
}

/**
 * The widget for one property.
 *
 * Any string may carry `{{ }}` segments, but only a property marked
 * `x-expression` gets the taller monospace editor: the hint about the
 * environment is noise beside a field that holds a schema name.
 */
export function widgetFor(schema: JsonSchema): Widget {
	if (schema.enum && schema.enum.length > 0) return 'enum';
	const t = typeOf(schema);
	if (schema['x-editor'] === 'grid') return 'grid';
	if (schema['x-editor'] === 'code') return 'code';
	const source = schema['x-source'];
	if (source === 'content-schemas' && t === 'string') return 'schema';
	if (source === 'datasources' && t === 'string') return 'datasource';
	if (source === 'flows' && t === 'string') return 'flow';
	if (source === 'event-types' && t === 'string') return 'event';
	if (source === 'content-fields') {
		if (t === 'string') return 'field';
		if (t === 'array') return 'fields';
	}
	if (schema['x-expression']) return 'expression';
	switch (t) {
		case 'string':
			return 'string';
		case 'number':
		case 'integer':
			return 'number';
		case 'boolean':
			return 'boolean';
		case 'array':
			if (schema.items?.enum && schema.items.enum.length > 0) return 'choices';
			return schema.items && typeOf(schema.items) === 'string' ? 'tags' : 'json';
		case 'object':
			if (schema.properties && Object.keys(schema.properties).length > 0) return 'object';
			return 'map';
		default:
			return 'json';
	}
}

/**
 * The properties to render. The engine serializes a schema's properties in
 * key order, which puts "populate" above "schema". The required keys are
 * what a user fills first, so they lead, in the order the schema lists
 * them, and the rest follow in key order.
 */
export function propertyList(schema: JsonSchema): { key: string; schema: JsonSchema; required: boolean }[] {
	const requiredOrder = schema.required ?? [];
	const required = new Set(requiredOrder);
	const entries = Object.entries(schema.properties ?? {});
	const lead = requiredOrder
		.filter((key) => schema.properties && key in schema.properties)
		.map((key) => [key, schema.properties![key]] as [string, JsonSchema]);
	const rest = entries.filter(([key]) => !required.has(key));
	return [...lead, ...rest].map(([key, s]) => ({ key, schema: s, required: required.has(key) }));
}

/**
 * Whether the flow plugin locks an option on this instance. The option can
 * be read and left at its default, and setting it is refused on save. The
 * plugin writes `x-enabled: false` beside such an option.
 */
export function isLockedOption(schema: JsonSchema): boolean {
	return schema['x-enabled'] === false;
}

/**
 * A label for a property: its title, else the key with underscores as spaces.
 * A content type picker the plugin left untitled is keyed `schema`, the API's
 * name, so it reads "content type" instead.
 */
export function labelFor(key: string, schema: JsonSchema): string {
	if (typeof schema.title === 'string' && schema.title) return schema.title;
	if (schema['x-source'] === 'content-schemas') return 'content type';
	return key.replace(/_/g, ' ');
}

/** A number typed into a field, or undefined for a blank or unparsable one. */
export function parseNumber(raw: string): number | undefined {
	const trimmed = raw.trim();
	if (trimmed === '') return undefined;
	const n = Number(trimmed);
	return Number.isFinite(n) ? n : undefined;
}

/** Pretty JSON for the json widget, or an empty string for nothing. */
export function toJSONText(value: unknown): string {
	if (value === undefined || value === null) return '';
	return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

/**
 * Parses the json widget's text. Text that is not JSON is kept as a string,
 * because a bare `{{ expression }}` is the common thing to type there.
 */
export function fromJSONText(text: string): unknown {
	const trimmed = text.trim();
	if (trimmed === '') return undefined;
	try {
		return JSON.parse(trimmed);
	} catch {
		return text;
	}
}

/** The segments of `path` below `base`. Empty when they are equal, null when it is not under it. */
export function relativePath(path: string, base: string): string[] | null {
	if (path === base) return [];
	if (!path.startsWith(`${base}/`)) return null;
	return path.slice(base.length + 1).split('/');
}

/**
 * Whether a form drawn from `schema` at `base` has a field for the error's
 * path: its first segment below the base is a property. Only the first has
 * to be: a deeper unknown segment shows under that field with the rest of
 * the path, and an error with no field at all is listed on its own.
 */
export function hasKnownKey(schema: JsonSchema, base: string, path: string): boolean {
	const rel = relativePath(path, base);
	return rel !== null && rel.length > 0 && rel[0] in (schema.properties ?? {});
}

export interface FieldError {
	/** The path below the field, empty for the field itself. */
	suffix: string;
	message: string;
}

/**
 * The errors a field at `path` shows: the one on the field itself and every
 * deeper one, except a deeper one a nested form for this field will show
 * under a nearer key of its own. Matching only the exact path would count an
 * error at /config/headers/x-a in the badge and draw it nowhere.
 */
export function errorsForField(
	schema: JsonSchema,
	path: string,
	errors: { path: string; message: string }[]
): FieldError[] {
	const nested = widgetFor(schema) === 'object';
	const out: FieldError[] = [];
	for (const e of errors) {
		const rel = relativePath(e.path, path);
		if (rel === null) continue;
		if (rel.length > 0 && nested && rel[0] in (schema.properties ?? {})) continue;
		out.push({ suffix: rel.join('/'), message: e.message });
	}
	return out;
}

export interface PickerOption {
	value: string;
	label: string;
	keywords?: string[];
	/** A heading the row sits under. Rows sharing one must be neighbors. */
	group?: string;
}

/** The rows of a schema picker. */
export function schemaOptions(schemas: SchemaOption[]): PickerOption[] {
	return schemas.map((s) => ({
		value: s.name,
		label: s.display_name && s.display_name !== s.name ? `${s.display_name} (${s.name})` : s.name,
		keywords: [s.display_name],
	}));
}

/** The fields of the schema named `name`, system columns first. Empty for a schema the list does not know. */
export function fieldsOf(schemas: SchemaOption[], name: unknown): string[] {
	const found = typeof name === 'string' ? schemas.find((s) => s.name === name) : undefined;
	if (!found) return [];
	return [...SYSTEM_FIELDS, ...found.fields.filter((f) => !SYSTEM_FIELDS.includes(f))];
}

/** The rows of a field picker. A sort picker offers each field ascending and descending. */
export function fieldOptions(fields: string[], sortable = false): PickerOption[] {
	if (!sortable) return fields.map((f) => ({ value: f, label: f }));
	return fields.flatMap((f) => [
		{ value: f, label: `${f} ascending`, keywords: [f] },
		{ value: `-${f}`, label: `${f} descending`, keywords: [f] },
	]);
}

/** The rows of a datasource picker: the datasources of the kinds the schema names, or all of them. */
export function datasourceOptions(datasources: DatasourceOption[], kinds?: string[]): PickerOption[] {
	const wanted = kinds && kinds.length > 0 ? new Set(kinds) : null;
	return datasources
		.filter((d) => !wanted || wanted.has(d.kind))
		.map((d) => ({ value: d.name, label: `${d.name} (${d.kind})`, keywords: [d.kind] }));
}

/**
 * The rows of a flow picker: the published flows, by name, without the flow
 * being edited, which cannot call itself.
 */
export function flowOptions(flows: FlowOption[], selfId?: string): PickerOption[] {
	return flows
		.filter((f) => f.id !== selfId)
		.map((f) => ({
			value: f.slug,
			label: f.name && f.name !== f.slug ? `${f.name} (${f.slug})` : f.slug,
			keywords: [f.slug],
		}));
}

/**
 * The rows of a hook picker, grouped by the plugin that publishes each one.
 * The Select draws a group as a run of neighboring rows, so the rows are
 * ordered by plugin first. A hook with no plugin named goes last.
 */
export function eventTypeOptions(events: SystemEvent[]): PickerOption[] {
	const sorted = [...events].sort((a, b) => {
		if (a.plugin !== b.plugin) {
			if (!a.plugin) return 1;
			if (!b.plugin) return -1;
			return a.plugin.localeCompare(b.plugin);
		}
		return a.name.localeCompare(b.name);
	});
	return sorted.map((e) => ({
		value: e.name,
		label: e.name,
		keywords: [e.plugin, e.description].filter(Boolean),
		group: e.plugin || 'Other',
	}));
}

/** The description of the hook named `name`, for the hint under the picker, or undefined for one the list does not know. */
export function eventDescription(events: SystemEvent[], name: unknown): string | undefined {
	const found = typeof name === 'string' ? events.find((e) => e.name === name) : undefined;
	return found?.description || undefined;
}

/** The shape the engine accepts for a hook name. */
export const HOOK_NAME = /^[a-z][a-z0-9_.:-]{0,79}$/;

/** Why a typed hook name will be refused, or undefined when it will not. */
export function hookNameError(value: unknown): string | undefined {
	if (typeof value !== 'string' || value === '') return undefined;
	if (HOOK_NAME.test(value)) return undefined;
	if (value.length > 80) return 'Use up to 80 characters for the hook name.';
	return 'Use lower case letters, digits, _ . : and - for the hook name, starting with a letter.';
}

/**
 * The language of a code editor. The hint is a language name, or `$key`,
 * the name of a sibling whose value is the language: an inline data node's
 * editor follows its format.
 */
export function languageOf(schema: JsonSchema, siblings: Record<string, unknown>): string {
	const hint = schema['x-language'];
	if (!hint) return 'text';
	if (!hint.startsWith('$')) return hint;
	const sibling = siblings[hint.slice(1)];
	return typeof sibling === 'string' && sibling ? sibling : 'text';
}

/** Whether a picker's rows include the value, so the control knows to show the free-text field. */
export function isCustom(options: PickerOption[], value: unknown): boolean {
	if (value === undefined || value === null || value === '') return false;
	return !options.some((o) => o.value === String(value));
}
