import { describe, expect, it } from 'vitest';
import { fillProblem, fillRefusal, unfillableFields, type FillField } from './fill';
import type { SchemaOption } from './types';

describe('fillRefusal', () => {
	it.each([
		[{ field_type: 'text' }, null],
		[{ field_type: 'json' }, null],
		[{ field_type: 'text', no_ai: true }, 'is marked No AI'],
		[{ field_type: 'text', private: true }, 'is private'],
		[{ field_type: 'datetime', system: true }, 'is set automatically'],
		[{ field_type: 'relation' }, 'is a relation field'],
		[{ field_type: 'media' }, 'is a media field'],
		[{ field_type: 'uid' }, 'is a uid field'],
		[{ field_type: 'enumeration' }, 'is an enumeration field'],
		[{ field_type: '' }, 'has no type'],
		[{} as FillField, 'has no type'],
	])('%o', (field, want) => {
		expect(fillRefusal(field)).toBe(want);
	});
});

describe('unfillableFields', () => {
	it('lists only the refused fields, by name', () => {
		expect(
			unfillableFields([
				{ name: 'title', field_type: 'text' },
				{ name: 'body', field_type: 'rich_text', no_ai: true },
			])
		).toEqual({ body: 'is marked No AI' });
	});
});

describe('fillProblem', () => {
	const schemas: SchemaOption[] = [{ name: 'posts', display_name: 'Posts', fields: ['title'], unfillable: {} }];

	it('names a saved field the content type does not have, whatever its case', () => {
		expect(fillProblem(schemas, 'posts', 'Title')).toBe(
			'Title is not a field of this content type, so this node cannot fill it. Remove it from the list.'
		);
		expect(fillProblem(schemas, 'posts', 'deleted_field')).toMatch(/^deleted_field is not a field of this content type/);
	});

	it('says nothing for a field it fills or a content type the list does not have', () => {
		expect(fillProblem(schemas, 'posts', 'title')).toBeNull();
		expect(fillProblem(schemas, 'missing', 'anything')).toBeNull();
	});
});
