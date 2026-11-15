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

/** Whether the other content type carries the key an inverse relation reads. */
export interface InverseRequirement {
	/** The content type that needs the key. */
	schema: string;
	/** The column the engine reads, once the rule finds one. */
	column: string | null;
	/** True once the rule finds the key. */
	satisfied: boolean;
}

/** Why the key of an inverse relation cannot be read. */
export type InverseProblem = 'no-target' | 'not-a-key' | 'ambiguous' | 'no-key';

export type InverseKey =
	| { ok: true; field: SchemaField; column: string }
	| { ok: false; problem: InverseProblem; candidates?: SchemaField[] };

/** Whether a relation field is one of the two kinds that store nothing on their own side. */
export function isInverse(field: SchemaField): boolean {
	return field.field_type === 'relation' && (field.relation_type === 'has_one' || field.relation_type === 'has_many');
}

function isBelongsTo(field: SchemaField): boolean {
	return field.field_type === 'relation' && (field.relation_type ?? 'belongs_to') === 'belongs_to';
}

/** The column a field stores, or null for a relation kind that stores none on its own table. */
function columnOf(field: SchemaField): string | null {
	if (field.field_type !== 'relation') return field.name;
	return isBelongsTo(field) ? fkColumn(field.name, field.relation_fk_name) : null;
}

/** The belongs_to fields on `target` that point back at `source`, any one of which can be an inverse key. */
export function inverseCandidates(source: string, target: Schema | undefined): SchemaField[] {
	return (target?.fields ?? []).filter((f) => !f.system && isBelongsTo(f) && f.relation_to === source);
}

/**
 * The key a has_one or has_many on `source` reads on its target, by the rule
 * every surface applies:
 *
 * 1. `relation_fk_name` on the field names the key column of a belongs_to on
 *    the target toward the source.
 * 2. Without it, the one belongs_to on the target toward the source.
 * 3. Without one, a field on the target whose column is `<source>_id`.
 *
 * Anything else cannot be read, and neither can two belongs_to toward the
 * source with no `relation_fk_name` to choose between them.
 */
export function inverseKey(source: string, field: SchemaField, target: Schema | undefined): InverseKey {
	if (!target) return { ok: false, problem: 'no-target' };
	const own = target.fields.filter((f) => !f.system);
	const back = inverseCandidates(source, target);

	if (field.relation_fk_name) {
		const named = back.find((f) => columnOf(f) === field.relation_fk_name);
		return named ? { ok: true, field: named, column: field.relation_fk_name } : { ok: false, problem: 'not-a-key' };
	}
	if (back.length === 1) return { ok: true, field: back[0], column: columnOf(back[0]) as string };
	if (back.length > 1) return { ok: false, problem: 'ambiguous', candidates: back };

	const column = fkColumn(source);
	const legacy = own.find((f) => columnOf(f) === column);
	return legacy ? { ok: true, field: legacy, column } : { ok: false, problem: 'no-key' };
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
	// is a belongs_to on the other table that points back here, so the field
	// itself can be called anything and renaming it moves nothing.
	const key = inverseKey(from.name || 'this', field, target);
	const requires: InverseRequirement = {
		schema: field.relation_to,
		column: key.ok ? key.column : null,
		satisfied: key.ok,
	};
	const many = kind.type === 'has_many';
	const empty = `this relation returns ${many ? 'an empty list' : 'nothing'}`;
	let problem: string | null = null;
	if (!key.ok) {
		switch (key.problem) {
			case 'no-target':
				problem = `${field.relation_to} is not a content type in this tenant.`;
				break;
			case 'not-a-key':
				problem = `${field.relation_fk_name} is not the key of a field on ${there} that belongs to ${here}, so ${empty}.`;
				break;
			case 'ambiguous':
				problem = `${there} has ${key.candidates?.length} fields that belong to ${here} (${(key.candidates ?? []).map((f) => f.name).join(', ')}). Choose which one this relation reads.`;
				break;
			default:
				problem = `${there} has no field that belongs to ${here}, so ${empty}. Add a relation field of kind "Belongs to one" to ${there} that points back here.`;
		}
	}
	return {
		kind,
		sentence: many
			? `Each ${here} row has many ${there} rows.`
			: `Each ${here} row has one ${there} row. The limit is not enforced, so if several ${there} rows point here, the first one is used.`,
		creates: [],
		reads: key.ok ? `${thatTable}.${key.column}` : `no key on ${thatTable}`,
		flags: key.ok
			? `Neither applies. The key is ${thatTable}.${key.column}, and Req and Idx on it belong to ${there}.`
			: `Neither applies. The key belongs to ${there}.`,
		requires,
		problem,
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
