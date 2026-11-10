import { describe, expect, it } from 'vitest';
import { fillRefusal, unfillableFields } from './fill';

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
