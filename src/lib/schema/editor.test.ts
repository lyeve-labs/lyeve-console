import { describe, expect, it } from 'vitest';
import type { Schema, SchemaField } from '@lyeve-labs/client';
import { appliedMessage, canonical, changesOf, createSchemaHistory, isRisky, problemsOf, COALESCE_MS, localizableProblem, dropUnlocalizableMark, isLocalizableFieldType, LOCALIZABLE_FIELD_TYPES } from './editor';

const field = (id: string, name: string, over: Partial<SchemaField> = {}): SchemaField => ({
	id,
	name,
	field_type: 'text',
	required: false,
	unique: false,
	indexed: false,
	...over,
});
const schema = (name: string, fields: SchemaField[], over: Partial<Schema> = {}): Schema => ({ name, display_name: name, fields, ...over });

describe('problemsOf', () => {
	it('passes a schema the engine would accept', () => {
		expect(problemsOf(schema('posts', [field('a', 'title')]), [], false)).toEqual([]);
	});

	it('asks for a table name and refuses one the engine would not take', () => {
		expect(problemsOf(schema('', []), [], true)[0]).toMatchObject({ target: 'schema-name', message: 'Enter a table name.' });
		expect(problemsOf(schema('2posts', []), [], true)[0].message).toMatch(/do not start it with a digit/);
	});

	it('refuses a new schema whose name is taken, whatever its case', () => {
		const p = problemsOf(schema('Posts', []), [schema('posts', [])], true);
		expect(p[0].message).toBe('A content type named Posts already exists.');
	});

	it('refuses a column the engine adds itself', () => {
		const [p] = problemsOf(schema('posts', [field('a', 'created_at')]), [], false);
		expect(p).toMatchObject({ fieldId: 'a', target: 'field-name-a' });
		expect(p.message).toMatch(/is a system column/);
	});

	it('refuses two fields that fold to one column', () => {
		const p = problemsOf(schema('posts', [field('a', 'Title'), field('b', 'title')]), [], false);
		expect(p.map((x) => x.fieldId)).toEqual(['a', 'b']);
	});

	it('asks a relation for its target and keeps a self relation to has_many', () => {
		const loose = problemsOf(schema('posts', [field('a', 'author', { field_type: 'relation', relation_type: 'belongs_to' })]), [], false);
		expect(loose[0].target).toBe('relation-target-a');
		const self = problemsOf(
			schema('posts', [field('a', 'parent', { field_type: 'relation', relation_type: 'belongs_to', relation_to: 'posts' })]),
			[],
			false,
		);
		expect(self[0].message).toMatch(/Has many/);
	});

	it('says where a new field is and exactly what it is missing', () => {
		const fresh = schema('posts', [
			field('s', 'id', { system: true }),
			field('a', 'title'),
			field('b', '', { field_type: 'relation', relation_type: 'belongs_to' }),
		]);
		expect(problemsOf(fresh, [], false)).toEqual([
			{ fieldId: 'b', target: 'field-name-b', where: 'New relation field, row 2', message: 'Enter a field name.' },
			{ fieldId: 'b', target: 'relation-target-b', where: 'New relation field, row 2', message: 'Pick the content type this relation points at.' },
		]);
	});

	it('names a field that has a name by it, and keeps the message free of it', () => {
		const [p] = problemsOf(schema('posts', [field('a', 'my title')]), [], false);
		expect(p.where).toBe('Field my title');
		expect(p.message).toMatch(/^Use only letters, digits and underscores in the field name/);
	});

	it('holds the save while a decimal scale is larger than its precision allows', () => {
		const decimal = (over: Partial<SchemaField>) => schema('posts', [field('a', 'price', { field_type: 'decimal', ...over })]);
		expect(problemsOf(decimal({ precision: 2, scale: 4 }), [], false)).toEqual([
			{ fieldId: 'a', target: 'decimal-scale-a', where: 'Field price', message: 'Enter a scale of at most 2.' },
		]);
		expect(problemsOf(decimal({ precision: 38, scale: 31 }), [], false)[0].message).toBe('Enter a scale of at most 30.');
		expect(problemsOf(decimal({ precision: 20, scale: 4 }), [], false)).toEqual([]);
		expect(problemsOf(decimal({}), [], false)).toEqual([]);
		expect(problemsOf(decimal({ precision: 1 }), [], false)).toEqual([]);
	});

	it('leaves the engine-owned rows alone', () => {
		expect(problemsOf(schema('posts', [field('s', 'id', { system: true })]), [], false)).toEqual([]);
	});
});

describe('changesOf', () => {
	const saved = schema('posts', [field('a', 'title'), field('b', 'body'), field('c', 'views', { field_type: 'number' })], {
		with_created_at: true,
	});

	it('reads a changed name on the same row as a rename, not a drop and an add', () => {
		const next = schema('posts', [field('a', 'headline'), field('b', 'body'), field('c', 'views', { field_type: 'number' })], {
			with_created_at: true,
		});
		const c = changesOf(saved, next);
		expect(c).toEqual({ renames: [{ from: 'title', to: 'headline' }], drops: [], retypes: [], systemDrops: [] });
		expect(isRisky(c)).toBe(true);
	});

	it('reads a renamed relation as a drop, since its key column is not the field name', () => {
		const withRel = schema('posts', [field('r', 'author', { field_type: 'relation', relation_type: 'belongs_to', relation_to: 'people' })]);
		const next = schema('posts', [field('r', 'writer', { field_type: 'relation', relation_type: 'belongs_to', relation_to: 'people' })]);
		const c = changesOf(withRel, next);
		expect(c.renames).toEqual([]);
		expect(c.drops).toEqual(['author']);
	});

	it('names dropped rows, retyped rows and removed system columns', () => {
		const next = schema('posts', [field('a', 'title'), field('c', 'views', { field_type: 'text' }), field('d', 'new')]);
		const c = changesOf(saved, next);
		expect(c.drops).toEqual(['body']);
		expect(c.retypes).toEqual([{ name: 'views', from: 'number', to: 'text' }]);
		expect(c.systemDrops).toEqual(['created_at']);
	});

	it('finds nothing risky in an added field or a new schema', () => {
		expect(isRisky(changesOf(saved, schema('posts', [...saved.fields, field('d', 'x')], { with_created_at: true })))).toBe(false);
		expect(isRisky(changesOf(null, saved))).toBe(false);
	});
});

describe('changesOf, decimal columns', () => {
	const price = (over: Partial<SchemaField>) => schema('posts', [field('a', 'price', { field_type: 'decimal', ...over })]);

	it('lists a new precision or scale as a column change', () => {
		const c = changesOf(price({ precision: 10, scale: 2 }), price({ precision: 12, scale: 4 }));
		expect(c.retypes).toEqual([{ name: 'price', from: 'decimal(10,2)', to: 'decimal(12,4)' }]);
		expect(isRisky(c)).toBe(true);
	});

	it('reads an absent precision and scale as the defaults', () => {
		expect(changesOf(price({}), price({ precision: 18, scale: 2 })).retypes).toEqual([]);
		expect(changesOf(price({}), price({ scale: 0 })).retypes).toEqual([{ name: 'price', from: 'decimal(18,2)', to: 'decimal(18,0)' }]);
		expect(changesOf(price({ precision: 1 }), price({ precision: 1, scale: 1 })).retypes).toEqual([]);
	});
});

describe('appliedMessage', () => {
	it('says what ran', () => {
		expect(appliedMessage(1, 0)).toBe('Applied one queued change');
		expect(appliedMessage(3, 0)).toBe('Applied 3 queued changes');
	});
	it('says which drops were kept and why', () => {
		expect(appliedMessage(0, 1)).toBe('Applied 0 queued changes. One was canceled because a content type still uses its column.');
		expect(appliedMessage(2, 2)).toBe('Applied 2 queued changes. 2 were canceled because a content type still uses their columns.');
	});
});

describe('canonical', () => {
	it('ignores the page row ids, so the same definition compares equal', () => {
		expect(canonical(schema('p', [field('a', 't')]))).toBe(canonical(schema('p', [field('zz', 't')])));
	});
});

describe('createSchemaHistory', () => {
	it('undoes and redoes whole edits', () => {
		let t = 0;
		const h = createSchemaHistory(schema('p', []), () => t);
		t = 10_000;
		h.push(schema('p', [field('a', 'x')]));
		t = 20_000;
		h.push(schema('p', [field('a', 'x'), field('b', 'y')]));
		expect(h.undo()?.fields).toHaveLength(1);
		expect(h.undo()?.fields).toHaveLength(0);
		expect(h.undo()).toBeNull();
		expect(h.redo()?.fields).toHaveLength(1);
	});

	it('folds keystrokes that arrive close together into one step', () => {
		let t = 1_000;
		const h = createSchemaHistory(schema('p', []), () => t);
		h.push(schema('p', [field('a', 't')]));
		t += COALESCE_MS / 2;
		h.push(schema('p', [field('a', 'ti')]));
		t += COALESCE_MS / 2;
		h.push(schema('p', [field('a', 'tit')]));
		expect(h.undo()?.fields).toHaveLength(0);
	});

	it('drops the redo branch on a new edit and ignores a push of what is on top', () => {
		let t = 0;
		const h = createSchemaHistory(schema('p', []), () => t);
		t = 5_000;
		h.push(schema('p', [field('a', 'x')]));
		h.undo();
		t = 10_000;
		h.push(schema('p', [field('b', 'y')]));
		expect(h.canRedo()).toBe(false);
		h.push(schema('p', [field('b', 'y')]));
		expect(h.undo()?.fields).toHaveLength(0);
	});
});

/*
 * Translatable is a property of a field, and it is bounded. The engine refuses
 * the mark rather than ignoring it, so the builder has to agree with it or the
 * box offers something the save will reject.
 */
describe('localizableProblem', () => {
	it('allows free text', () => {
		for (const field_type of ['text', 'rich_text', 'url']) {
			expect(localizableProblem({ field_type }), field_type).toBeNull();
		}
	});

	// A translated number is a different number, and a translated relation
	// points at something that does not exist.
	it('refuses every type where a translation would change what the row means', () => {
		for (const field_type of [
			'number',
			'boolean',
			'date',
			'datetime',
			'json',
			'relation',
			'media',
			'uid',
			'email',
		]) {
			expect(localizableProblem({ field_type }), field_type).not.toBeNull();
		}
	});

	it('refuses a unique field, and says it is a key', () => {
		const why = localizableProblem({ field_type: 'text', unique: true });
		expect(why).toContain('key');
	});

	it('says why in words a person can act on', () => {
		expect(localizableProblem({ field_type: 'rich_text' })).toBeNull();
		expect(localizableProblem({ field_type: 'datetime' })).toContain('every language');
	});
});

describe('isLocalizableFieldType', () => {
	it('agrees with the list the problem reads', () => {
		for (const t of LOCALIZABLE_FIELD_TYPES) expect(isLocalizableFieldType(t), t).toBe(true);
		expect(isLocalizableFieldType('number')).toBe(false);
		expect(isLocalizableFieldType('')).toBe(false);
	});
});

/*
 * The mark follows the field. A save carrying a mark the field can no longer
 * hold is refused whole by the engine, so the builder clears it at the change
 * and hands back the reason to show.
 */
describe('dropUnlocalizableMark', () => {
	it('clears the mark when the type changes to one a translation cannot apply to', () => {
		const field = { field_type: 'text', localized: true };
		field.field_type = 'number';
		const why = dropUnlocalizableMark(field);
		expect(field.localized).toBe(false);
		expect(why).toContain('every language');
	});

	it('clears the mark when the field becomes unique', () => {
		const field = { field_type: 'text', unique: false, localized: true };
		field.unique = true;
		const why = dropUnlocalizableMark(field);
		expect(field.localized).toBe(false);
		expect(why).toContain('key');
	});

	it('keeps the mark on a field that stays localizable', () => {
		const field = { field_type: 'text', unique: false, localized: true };
		field.field_type = 'rich_text';
		expect(dropUnlocalizableMark(field)).toBeNull();
		expect(field.localized).toBe(true);
	});

	it('reports nothing when there was no mark to clear', () => {
		const field = { field_type: 'number', localized: false };
		expect(dropUnlocalizableMark(field)).toBeNull();
		expect(field.localized).toBe(false);
	});
});
