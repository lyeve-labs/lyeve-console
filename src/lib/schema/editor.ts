import type { Schema, SchemaField } from '@lyeve-labs/client';

/**
 * What the schema builder checks while the operator types, what a save would
 * change in the database, and the undo stack. Pure, so the page stays a view
 * over it and each rule is tested on its own.
 */

/*
 * The public delivery marks, until the client package types them. Both travel
 * in the definition the builder saves, and an absent mark reads as false.
 */
declare module '@lyeve-labs/client' {
	interface Schema {
		/** The published entries are served without a credential, on routes a CDN may cache. */
		public_delivery?: boolean;
	}
	interface SchemaField {
		/** Never served on the public delivery routes. A system field cannot carry it. */
		private?: boolean;
	}
}

/** The engine's identifier rule, which every table and column name passes. */
const IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const MAX_IDENTIFIER = 63;

/**
 * Names the engine adds to a table itself. A field called one of them saves
 * a second column of the same name, which the database refuses after the
 * definition has already been read as valid.
 */
export const RESERVED_FIELD_NAMES = ['id', 'tenant_id', 'created_at', 'updated_at', 'deleted_at', '_locale'] as const;

export interface Problem {
	/** The field the problem belongs to, or null for the schema itself. */
	fieldId: string | null;
	/** The id of the control that fixes it, so the problems list can focus it. */
	target: string;
	/**
	 * Where it is, in the words the editor shows: the machine name, a field
	 * by its name, or a field not named yet by its type and its row.
	 */
	where: string;
	/** What is wrong or missing, as a sentence that makes sense beside `where`. */
	message: string;
}

/** A field as the problems list names it. A new one has no name yet, so its type and row stand in. */
function fieldWhere(f: SchemaField, row: number): string {
	if (f.name) return `Field ${f.name}`;
	return `New ${f.field_type.replace(/_/g, ' ')} field, row ${row}`;
}

function identifierProblem(name: string, what: string): string | null {
	if (!name) return `Enter a ${what} name.`;
	if (name.length > MAX_IDENTIFIER) return `The ${what} name is longer than ${MAX_IDENTIFIER} characters.`;
	if (!IDENTIFIER.test(name)) return `Use only letters, digits and underscores in the ${what} name, and do not start it with a digit.`;
	return null;
}

/**
 * The field types a translation makes sense on.
 *
 * Free text and nothing else, which the engine enforces rather than merely
 * documents. A translated number is a different number, a translated date is a
 * different instant, and a translated relation, media reference or uid points
 * at something that does not exist. A unique field is refused from the other
 * direction: one constraint cannot be satisfied in several languages at once.
 */
export const LOCALIZABLE_FIELD_TYPES = ['text', 'rich_text', 'url'] as const;

/** Whether a field of this type may carry the localized mark. */
export function isLocalizableFieldType(fieldType: string): boolean {
	return (LOCALIZABLE_FIELD_TYPES as readonly string[]).includes(fieldType);
}

/** Whether this field may be marked localized, and why not when it may not. */
export function localizableProblem(field: {
	field_type: string;
	unique?: boolean;
}): string | null {
	if (!isLocalizableFieldType(field.field_type)) {
		return `A ${field.field_type.replace(/_/g, ' ')} field is the same value in every language.`;
	}
	if (field.unique) {
		return 'A unique field is a key, and one key cannot cover several languages.';
	}
	return null;
}

/**
 * Clears the localized mark once the field can no longer carry it, and
 * returns why, or null when nothing was cleared.
 *
 * The engine refuses the mark rather than dropping it, so a mark left on a
 * field that changed type or became unique fails the whole save. The builder
 * drops it at the moment of the change instead, and the reason it returns is
 * shown beside the control, so nobody goes on believing the field translates.
 */
export function dropUnlocalizableMark(field: {
	field_type: string;
	unique?: boolean;
	localized?: boolean;
}): string | null {
	if (!field.localized) return null;
	const why = localizableProblem(field);
	if (why === null) return null;
	field.localized = false;
	return why;
}

/** The control that edits a field's name, by the id the page gives it. */
export const fieldNameTarget = (fieldId: string) => `field-name-${fieldId}`;

/**
 * Everything that would make a save fail, in the order the page shows it.
 *
 * Duplicates compare without case: MySQL and SQL Server fold column names, so
 * `Title` and `title` are one column there and two here.
 */
export function problemsOf(schema: Schema, others: Schema[], isNew: boolean): Problem[] {
	const out: Problem[] = [];
	const nameProblem = identifierProblem(schema.name, 'table');
	const tableWhere = 'Machine name';
	if (nameProblem) out.push({ fieldId: null, target: 'schema-name', where: tableWhere, message: nameProblem });
	else if (isNew && others.some((s) => s.name.toLowerCase() === schema.name.toLowerCase())) {
		out.push({ fieldId: null, target: 'schema-name', where: tableWhere, message: `A content type named ${schema.name} already exists.` });
	}

	const seen = new Map<string, number>();
	for (const f of schema.fields) {
		if (f.system) continue;
		const key = f.name.toLowerCase();
		seen.set(key, (seen.get(key) ?? 0) + 1);
	}

	let row = 0;
	for (const f of schema.fields) {
		if (f.system) continue;
		row++;
		const id = f.id ?? f.name;
		const target = fieldNameTarget(id);
		const where = fieldWhere(f, row);
		const p = identifierProblem(f.name, 'field');
		if (p) out.push({ fieldId: id, target, where, message: p });
		else if ((RESERVED_FIELD_NAMES as readonly string[]).includes(f.name.toLowerCase())) {
			out.push({ fieldId: id, target, where, message: `${f.name} is a system column. Choose another name.` });
		} else if ((seen.get(f.name.toLowerCase()) ?? 0) > 1) {
			out.push({ fieldId: id, target, where, message: `${f.name} is used by more than one field.` });
		}
		if (f.field_type === 'decimal') {
			// The engine's defaults when the definition names neither.
			const most = Math.min(f.precision ?? 18, 30);
			if (decimalScale(f) > most) {
				out.push({ fieldId: id, target: `decimal-scale-${id}`, where, message: `Enter a scale of at most ${most}.` });
			}
		}
		if (f.field_type === 'relation') {
			if (!f.relation_to) {
				out.push({ fieldId: id, target: `relation-target-${id}`, where, message: 'Pick the content type this relation points at.' });
			} else if (f.relation_to === schema.name && f.relation_type !== 'has_many') {
				out.push({ fieldId: id, target: `relation-type-${id}`, where, message: 'A relation to its own content type has to be Has many.' });
			}
		}
	}
	return out;
}

export interface Change {
	renames: { from: string; to: string }[];
	drops: string[];
	retypes: { name: string; from: string; to: string }[];
	/** System columns the save removes. */
	systemDrops: string[];
}

const SYSTEM_FLAGS: [keyof Schema, string][] = [
	['with_created_at', 'created_at'],
	['with_updated_at', 'updated_at'],
	['with_soft_delete', 'deleted_at'],
];

/**
 * What a save does to columns that may already hold data.
 *
 * Fields are matched by the id the page gives each row, not by name, so a
 * field whose name changed is a rename. The engine diffs by name, and without
 * this it reads a rename as a new column and a dropped one, and the data in
 * the old column goes with the drop.
 */
export function changesOf(saved: Schema | null, next: Schema): Change {
	const change: Change = { renames: [], drops: [], retypes: [], systemDrops: [] };
	if (!saved) return change;
	const before = new Map(saved.fields.filter((f) => !f.system && f.id).map((f) => [f.id as string, f]));
	const after = new Map(next.fields.filter((f) => !f.system && f.id).map((f) => [f.id as string, f]));
	for (const [id, old] of before) {
		const now = after.get(id);
		if (!now) {
			change.drops.push(old.name);
			continue;
		}
		if (now.name && now.name !== old.name) {
			// A relation's key column is not named after the field, so the
			// column rename route cannot move it. Renaming one is a drop of the
			// old relation and a new one, and the dialog says so.
			if (old.field_type === 'relation' || now.field_type === 'relation') change.drops.push(old.name);
			else change.renames.push({ from: old.name, to: now.name });
		}
		if (now.field_type !== old.field_type) {
			change.retypes.push({ name: now.name || old.name, from: old.field_type, to: now.field_type });
		} else if (now.field_type === 'decimal' && decimalType(now) !== decimalType(old)) {
			// A new precision or scale rewrites the column the way a new type does.
			change.retypes.push({ name: now.name || old.name, from: decimalType(old), to: decimalType(now) });
		}
	}
	for (const [flag, column] of SYSTEM_FLAGS) {
		if (saved[flag] && !next[flag]) change.systemDrops.push(column);
	}
	return change;
}

/**
 * A decimal field's scale. One left out is 2, or the precision when that is
 * smaller, as the engine reads it.
 */
export function decimalScale(f: SchemaField): number {
	return f.scale ?? Math.min(2, f.precision ?? 18);
}

/** A decimal field's column type, with the engine's defaults where the definition names none. */
function decimalType(f: SchemaField): string {
	return `decimal(${f.precision ?? 18},${decimalScale(f)})`;
}

/** Whether a change touches data that already exists. */
export function isRisky(c: Change): boolean {
	return c.renames.length + c.drops.length + c.retypes.length + c.systemDrops.length > 0;
}

/** The definition as the engine stores it: the page's row ids are its own. */
export function wireSchema(s: Schema): Schema {
	return { ...s, fields: s.fields.map(({ id: _id, ...f }) => f as SchemaField) };
}

/** A comparable form, so dirty is a comparison and an undo back to the saved state clears it. */
export function canonical(s: Schema | null): string {
	return s ? JSON.stringify(wireSchema(s)) : '';
}

/**
 * What a run of a table's queue did. A canceled change is a drop, or a clear
 * of one tenant's values, whose column a definition uses again, so the engine
 * kept the column and its values instead of running it.
 */
export function appliedMessage(applied: number, canceled: number): string {
	const ran = applied === 1 ? 'Applied one queued change' : `Applied ${applied} queued changes`;
	if (canceled === 0) return ran;
	const kept = canceled === 1 ? 'One was canceled because a content type still uses its column.' : `${canceled} were canceled because a content type still uses their columns.`;
	return `${ran}. ${kept}`;
}

/** How long after an edit the next one still joins the same undo step. */
export const COALESCE_MS = 800;

/**
 * An undo stack of serialized snapshots.
 *
 * Stored as strings because the schema on screen is a Svelte proxy and a held
 * reference would change under the entry that remembers it. Edits closer
 * together than `COALESCE_MS` replace the top entry, so typing a name is one
 * step rather than one per key.
 */
export function createSchemaHistory(initial: Schema, now: () => number = Date.now) {
	let stack = [JSON.stringify(initial)];
	let index = 0;
	let lastPush = 0;
	return {
		push(s: Schema) {
			const snap = JSON.stringify(s);
			if (snap === stack[index]) return;
			const t = now();
			stack = stack.slice(0, index + 1);
			if (index > 0 && t - lastPush < COALESCE_MS) stack[index] = snap;
			else {
				stack.push(snap);
				index++;
			}
			lastPush = t;
		},
		undo(): Schema | null {
			if (index === 0) return null;
			index--;
			lastPush = 0;
			return JSON.parse(stack[index]) as Schema;
		},
		redo(): Schema | null {
			if (index >= stack.length - 1) return null;
			index++;
			lastPush = 0;
			return JSON.parse(stack[index]) as Schema;
		},
		canUndo: () => index > 0,
		canRedo: () => index < stack.length - 1,
	};
}

export type SchemaHistory = ReturnType<typeof createSchemaHistory>;
