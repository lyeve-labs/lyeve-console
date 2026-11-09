/**
 * What each relation kind actually does to the database, stated from the
 * engine's own rules rather than from the four words the picker shows.
 *
 * `belongs_to`, `has_one`, `has_many` and `many_to_many` look
 * interchangeable and are not, and they do not all write to the schema being
 * edited: `belongs_to` adds a column here, `has_one` and `has_many` read a
 * column on the other table, and `many_to_many` builds a table that belongs to
 * neither.
 *
 * Every name below mirrors the engine and has to keep mirroring it. A column
 * this module spells differently is a column the reader will look for and not
 * find.
 */
import type { Schema, SchemaField } from '@lyeve-labs/client';

export type RelationType = NonNullable<SchemaField['relation_type']>;

/** The physical table for a schema. Every collection table carries the underscore. */
export function tableName(schema: string): string {
	return '_' + schema.toLowerCase().replaceAll('-', '_');
}

/** The foreign key column derived from a name, unless the field overrides it. */
export function fkColumn(name: string, override?: string): string {
	if (override) return override;
	return name.toLowerCase().replaceAll('-', '_') + '_id';
}

/**
 * The pivot table for a many-to-many pair.
 *
 * Ordered alphabetically so both sides of the same relation name one table.
 * The names are folded the way the engine folds them first, because sorting
 * the raw names disagrees with the engine as soon as either one carries a
 * capital or a dash.
 */
export function pivotTable(a: string, b: string): string {
	const [x, y] = [a.toLowerCase().replaceAll('-', '_'), b.toLowerCase().replaceAll('-', '_')].sort();
	return `_pivot_${x}_${y}`;
}

export interface RelationKind {
	type: RelationType;
	/** What the picker shows. */
	label: string;
	/** The cardinality, in the words a data model uses for it. */
	cardinality: string;
	/** Which table the save writes to, which the four kind names alone do not say. */
	storage: 'this content type' | 'the other content type' | 'a pivot table';
	/** One line, short enough for a picker row. */
	blurb: string;
}

/**
 * Ordered from the one that acts on this schema to the one that acts on
 * neither, so the list itself reads as a scale.
 */
export const RELATION_KINDS: RelationKind[] = [
	{
		type: 'belongs_to',
		label: 'Belongs to one',
		cardinality: 'many to one',
		storage: 'this content type',
		blurb: 'Adds the key column to this content type. No other kind does.',
	},
	{
		type: 'has_one',
		label: 'Has one',
		cardinality: 'one to one',
		storage: 'the other content type',
		blurb: 'Uses a key column on the other content type. Adds no column here.',
	},
	{
		type: 'has_many',
		label: 'Has many',
		cardinality: 'one to many',
		storage: 'the other content type',
		blurb: 'Uses a key column on the other content type. Adds no column here.',
	},
	{
		type: 'many_to_many',
		label: 'Has and belongs to many',
		cardinality: 'many to many',
		storage: 'a pivot table',
		blurb: 'Creates a join table. Neither content type gets a new column.',
	},
];

export function relationKind(type: RelationType | undefined): RelationKind {
	return RELATION_KINDS.find((k) => k.type === type) ?? RELATION_KINDS[0];
}

/** The field the other schema must carry for an inverse relation to resolve. */
export interface InverseRequirement {
	/** The schema that needs the field. */
	schema: string;
	/** The name that field must have. It is the name, not the target, that derives the column. */
	field: string;
	/** The column the engine reads. */
	column: string;
	/** True once a field on that schema produces the column. */
	satisfied: boolean;
}

export interface RelationPlan {
	kind: RelationKind;
	/** The relation in a sentence, using the names on screen. */
	sentence: string;
	/** What the next save creates. Empty for the kinds that create nothing. */
	creates: string[];
	/** The column or table the engine reads this relation through. */
	reads: string;
	/** What the Req and Idx boxes on the row do for this kind, if anything. */
	flags: string;
	/** Set for the inverse kinds, which cannot work alone. */
	requires: InverseRequirement | null;
	/** Why this relation will not resolve as configured, if it will not. */
	problem: string | null;
}

function label(s: Schema | undefined, fallback: string): string {
	return s?.display_name || s?.name || fallback;
}

/**
 * Whether `target` already carries a field producing `column`.
 *
 * Matched on the derived column and not on the relation's direction, because
 * the column is the whole of what the engine looks for. A `belongs_to` named
 * after this schema is the ordinary way to get one, and an explicit
 * `relation_fk_name` is the other.
 */
function producesColumn(target: Schema | undefined, column: string): boolean {
	if (!target) return false;
	return target.fields.some(
		(f) =>
			f.field_type === 'relation' &&
			(f.relation_type ?? 'belongs_to') === 'belongs_to' &&
			fkColumn(f.name, f.relation_fk_name) === column,
	);
}

/**
 * Describes one relation field against the schemas currently on screen.
 *
 * Returns null for a field that is not a relation or names no target: there is
 * nothing true to say about a relation to nothing, so no sentence is
 * invented for it.
 */
export function planRelation(
	from: Schema,
	field: SchemaField,
	schemas: Schema[],
): RelationPlan | null {
	if (field.field_type !== 'relation' || !field.relation_to) return null;

	const kind = relationKind(field.relation_type ?? 'belongs_to');
	const target = schemas.find((s) => s.name === field.relation_to);
	const here = label(from, from.name || 'this content type');
	const there = label(target, field.relation_to);
	const thisTable = tableName(from.name || 'this');
	const thatTable = tableName(field.relation_to);

	if (kind.type === 'belongs_to') {
		const col = fkColumn(field.name || 'field', field.relation_fk_name);
		return {
			kind,
			sentence: `Many ${here} rows point at one ${there} row.`,
			creates: [
				`Column ${col} on ${thisTable}, a foreign key to ${thatTable}(id).`,
				`An index on ${thisTable}.${col}.`,
				field.required
					? `Required, so the column is NOT NULL and deleting one ${there} row deletes every ${here} row that points at it.`
					: `Optional, so deleting one ${there} row leaves the ${here} rows behind and sets their ${col} to NULL.`,
			],
			reads: `${thisTable}.${col}`,
			flags: `Req makes ${col} NOT NULL and turns the delete into a cascade. Idx is already on, because the foreign key gets its own index.`,
			requires: null,
			problem: null,
		};
	}

	if (kind.type === 'many_to_many') {
		const pivot = field.relation_through || pivotTable(from.name || 'this', field.relation_to);
		const a = tableName(from.name || 'this').slice(1) + '_id';
		const b = thatTable.slice(1) + '_id';
		const self = from.name === field.relation_to;
		return {
			kind,
			sentence: self
				? `Any number of ${here} rows pair with any number of other ${here} rows.`
				: `Any number of ${here} rows pair with any number of ${there} rows, and the other way round.`,
			creates: [
				`Table ${pivot}, holding ${a} and ${b} as its primary key.`,
				`Both sides cascade: deleting a row deletes its pairings, never the row it was paired with.`,
			],
			reads: pivot,
			flags: 'Neither applies. There is no column here to require or index, because the pivot table has its own keys.',
			requires: null,
			// Both sides of a self-pair derive the same key column, so the pivot
			// would need two columns of one name. The save path refuses it too.
			problem: self
				? `A pivot between ${here} and itself would need two columns named ${a}.`
				: null,
		};
	}

	// has_one and has_many are the same mechanism at two cardinalities: the key
	// is on the other table and it is named after THIS schema, not after the
	// field. A field called `articles` on `author` is read through `author_id`
	// on `_article`, so renaming the field moves nothing.
	const column = fkColumn(from.name || 'this');
	const satisfied = producesColumn(target, column);
	const requires: InverseRequirement = {
		schema: field.relation_to,
		field: from.name || 'this',
		column,
		satisfied,
	};
	const many = kind.type === 'has_many';
	return {
		kind,
		sentence: many
			? `Each ${here} row has many ${there} rows.`
			: `Each ${here} row has one ${there} row. The limit is not enforced, so if several ${there} rows point here, the first one is used.`,
		creates: [],
		reads: `${thatTable}.${column}`,
		flags: `Neither applies. The key is ${thatTable}.${column}, and Req and Idx on it belong to ${there}.`,
		requires,
		problem: target
			? satisfied
				? null
				: `${there} has no field named ${requires.field}, so ${thatTable}.${column} does not exist and this relation returns ${many ? 'an empty list' : 'nothing'}.`
			: `${field.relation_to} is not a content type in this tenant.`,
	};
}

/**
 * Every relation on a schema, in field order, with the ones that will not
 * resolve marked. Used for the summary above the field list, which is the only
 * place the inverse problem is visible without opening each row.
 */
export function planSchemaRelations(
	from: Schema,
	schemas: Schema[],
): Array<{ field: SchemaField; plan: RelationPlan }> {
	const out: Array<{ field: SchemaField; plan: RelationPlan }> = [];
	for (const field of from.fields) {
		const plan = planRelation(from, field, schemas);
		if (plan) out.push({ field, plan });
	}
	return out;
}
