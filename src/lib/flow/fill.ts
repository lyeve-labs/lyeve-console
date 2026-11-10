/**
 * Which fields the "Fill fields with AI" node may fill. The node refuses to
 * run when its fields setting names any other, so its picker offers only
 * these. The rule matches the node's own: a field marked No AI, a private
 * field and a system field are never filled, and neither is a field of a
 * type the node cannot fill, such as a relation, a media reference or a uid.
 * A field hidden from the account that publishes the flow is refused too,
 * but the definition does not carry that mask, so the picker cannot see it.
 */

import { SYSTEM_FIELDS } from './schema';
import type { SchemaOption } from './types';

/** The node type whose fields setting follows this rule. */
export const FILL_NODE = 'content.fill';

/** The field types the node fills. */
const FILL_TYPES = new Set([
	'text',
	'rich_text',
	'email',
	'url',
	'number',
	'decimal',
	'integer',
	'boolean',
	'date',
	'datetime',
	'json',
]);

/** A field as the content type's definition describes it. */
export interface FillField {
	field_type: string;
	system?: boolean;
	private?: boolean;
	no_ai?: boolean;
}

/** Why the node never fills a field, as the end of a sentence that starts with its name, or null when it may. */
export function fillRefusal(field: FillField): string | null {
	if (field.no_ai) return 'is marked No AI';
	if (field.private) return 'is private';
	if (field.system) return 'is set automatically';
	if (!field.field_type) return 'has no type';
	// The type names that start with u (uid, url, uuid) are said with a
	// consonant sound, so only a, e, i and o take "an".
	if (!FILL_TYPES.has(field.field_type)) return `is ${/^[aeio]/i.test(field.field_type) ? 'an' : 'a'} ${field.field_type} field`;
	return null;
}

/** The reason for every field of a definition the node never fills, by field name. */
export function unfillableFields(fields: ({ name: string } & FillField)[]): Record<string, string> {
	const out: Record<string, string> = {};
	for (const f of fields) {
		const why = fillRefusal(f);
		if (why) out[f.name] = why;
	}
	return out;
}

/** The fields of the schema named `name` the node may fill. Empty for a schema the list does not know. */
export function fillableFieldsOf(schemas: SchemaOption[], name: unknown): string[] {
	const found = typeof name === 'string' ? schemas.find((s) => s.name === name) : undefined;
	if (!found) return [];
	const refused = found.unfillable ?? {};
	return found.fields.filter((f) => !SYSTEM_FIELDS.includes(f) && !(f in refused));
}

/**
 * Why the node refuses a field a flow already names, or null when it fills
 * it or the schema is not one the list knows.
 */
export function fillProblem(schemas: SchemaOption[], name: unknown, field: string): string | null {
	const found = typeof name === 'string' ? schemas.find((s) => s.name === name) : undefined;
	if (!found) return null;
	const why =
		found.unfillable?.[field] ??
		(SYSTEM_FIELDS.includes(field)
			? 'is set automatically'
			: found.fields.includes(field)
				? null
				: 'is not a field of this content type');
	return why ? `${field} ${why}, so this node cannot fill it. Remove it from the list.` : null;
}
