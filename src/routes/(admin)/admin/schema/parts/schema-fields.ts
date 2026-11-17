import type { Schema, SchemaField } from '@lyeve-labs/client';
import { relationKind } from '#lib/relations.ts';

/** Names a field in a control's accessible name, before it has been named. */
export function fieldLabel(f: SchemaField): string {
	return f.name || 'new field';
}

/** Returns true if a field is a timestamp column (created_at / updated_at). */
export function isTimestamp(f: SchemaField) {
	return f.name === 'created_at' || f.name === 'updated_at';
}

export function addField(schema: Schema) {
	schema.fields = [
		...schema.fields,
		{ id: crypto.randomUUID(), name: '', field_type: 'text', required: false, unique: false, indexed: false },
	];
}

/**
 * A relation is a field whose type is relation, and that is the one fact
 * the editor never said. This adds one already typed, so the panel that
 * asks for the kind and the target opens without a trip through the picker.
 */
export function addRelation(schema: Schema, target?: string) {
	schema.fields = [
		...schema.fields,
		{
			id: crypto.randomUUID(),
			name: target ? relationFieldName(schema, target) : '',
			field_type: 'relation',
			relation_type: 'belongs_to',
			relation_to: target,
			required: false,
			unique: false,
			indexed: false,
		},
	];
}

/**
 * A relation drawn on the canvas arrives with a target and no name. It is
 * named after the target, or parent when a schema points at itself, with a
 * number added when the schema already has a field of that name.
 */
export function relationFieldName(s: Schema, target: string): string {
	const base = target === s.name ? 'parent' : target.toLowerCase();
	const taken = new Set(s.fields.map((f) => f.name));
	if (!taken.has(base)) return base;
	let n = 2;
	while (taken.has(`${base}_${n}`)) n++;
	return `${base}_${n}`;
}

/**
 * Removes a row at once. It is one undo away, and a save that would drop a
 * column with data in it says so, with the row count, before it runs.
 */
export function removeField(schema: Schema, fieldId: string) {
	const field = schema.fields.find((f) => f.id === fieldId);
	if (!field || field.system) return;
	schema.fields = schema.fields.filter((f) => f.id !== fieldId);
}

/**
 * No relation stores a column under its own name, so Idx on one indexes
 * nothing and the save fails naming a column the operator never typed. A
 * belongs_to is indexed by its foreign key already. The other three kinds
 * keep no column here at all, so Req on them has nothing to make NOT NULL
 * and the engine skips relations in validation besides.
 *
 * A json field cannot be an index key: MySQL refuses one and SQL Server
 * stores the value where no index reaches, so the engine refuses the save.
 */
export function inertFlags(field: SchemaField): { indexed: string | null; required: string | null } {
	if (field.field_type === 'json') {
		return { indexed: 'A json field cannot be indexed.', required: null };
	}
	if (field.field_type !== 'relation') return { indexed: null, required: null };
	const kind = relationKind(field.relation_type);
	return {
		indexed:
			kind.type === 'belongs_to'
				? 'Already indexed by its foreign key.'
				: 'This relation has no column here to index.',
		required:
			kind.type === 'belongs_to'
				? null
				: 'This relation has no column here to require. Its key is stored in ' + kind.storage + '.',
	};
}

export function dropInertFlags(field: SchemaField) {
	const inert = inertFlags(field);
	if (inert.indexed) field.indexed = false;
	if (inert.required) field.required = false;
	if (field.field_type === 'json') field.unique = false;
}
