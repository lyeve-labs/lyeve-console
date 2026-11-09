import { describe, it, expect } from 'vitest';
import type { SchemaField } from '@lyeve-labs/client';
import {
	fieldKey,
	buildEmpty,
	buildFromData,
	validate,
	serialize,
	extractM2MRelations,
} from './content-form';

// helpers

function field(overrides: Partial<SchemaField> & { name: string; field_type: string }): SchemaField {
	return {
		required: false,
		unique: false,
		indexed: false,
		system: false,
		...overrides,
	};
}

// fieldKey

describe('fieldKey', () => {
	it('returns field name for non-relation fields', () => {
		expect(fieldKey(field({ name: 'title', field_type: 'text' }))).toBe('title');
	});

	it('returns {name}_id for belongs_to relation', () => {
		expect(fieldKey(field({ name: 'author', field_type: 'relation', relation_type: 'belongs_to' }))).toBe('author_id');
	});

	it('uses relation_fk_name override when provided', () => {
		expect(fieldKey(field({ name: 'author', field_type: 'relation', relation_type: 'belongs_to', relation_fk_name: 'user_id' }))).toBe('user_id');
	});

	it('returns field name for has_many relations', () => {
		expect(fieldKey(field({ name: 'notes', field_type: 'relation', relation_type: 'has_many' }))).toBe('notes');
	});
});

// buildEmpty

describe('buildEmpty', () => {
	it('defaults text fields to empty string', () => {
		const result = buildEmpty([field({ name: 'title', field_type: 'text' })]);
		expect(result).toEqual({ title: '' });
	});

	it('defaults boolean fields to false', () => {
		const result = buildEmpty([field({ name: 'active', field_type: 'boolean' })]);
		expect(result).toEqual({ active: false });
	});

	it('defaults has_many / many_to_many to empty array', () => {
		const result = buildEmpty([
			field({ name: 'tags', field_type: 'relation', relation_type: 'many_to_many', relation_to: 'tags' }),
		]);
		expect(result).toEqual({ tags: [] });
	});

	it('skips system fields', () => {
		const result = buildEmpty([
			field({ name: 'id', field_type: 'uid', system: true }),
			field({ name: 'title', field_type: 'text' }),
		]);
		expect(result).toEqual({ title: '' });
	});

	it('uses FK column name for belongs_to', () => {
		const result = buildEmpty([field({ name: 'author', field_type: 'relation', relation_type: 'belongs_to', relation_to: 'users' })]);
		expect(result).toEqual({ author_id: '' });
	});
});

// buildFromData

describe('buildFromData', () => {
	it('reads values from server data', () => {
		const result = buildFromData(
			[field({ name: 'title', field_type: 'text' })],
			{ title: 'Hello' },
		);
		expect(result).toEqual({ title: 'Hello' });
	});

	it('converts boolean values', () => {
		const result = buildFromData(
			[field({ name: 'active', field_type: 'boolean' })],
			{ active: 1 },
		);
		expect(result.active).toBe(true);
	});

	it('converts json to formatted string', () => {
		const result = buildFromData(
			[field({ name: 'meta', field_type: 'json' })],
			{ meta: { key: 'val' } },
		);
		expect(result.meta).toBe(JSON.stringify({ key: 'val' }, null, 2));
	});
});

// validate

describe('validate', () => {
	it('returns empty errors when all required fields are filled', () => {
		const errors = validate(
			[field({ name: 'title', field_type: 'text', required: true })],
			{ title: 'Hello' },
		);
		expect(errors).toEqual({});
	});

	it('reports error for empty required field', () => {
		const errors = validate(
			[field({ name: 'title', field_type: 'text', required: true })],
			{ title: '' },
		);
		expect(errors.title).toBeDefined();
	});

	it('does not validate boolean fields for emptiness', () => {
		const errors = validate(
			[field({ name: 'active', field_type: 'boolean', required: true })],
			{ active: false },
		);
		expect(errors).toEqual({});
	});

	it('skips system fields', () => {
		const errors = validate(
			[field({ name: 'id', field_type: 'uid', required: true, system: true })],
			{ id: '' },
		);
		expect(errors).toEqual({});
	});
});

// serialize

describe('serialize', () => {
	it('sends nothing for a relation whose key lives on the other table', () => {
		// A has_one value sent under the field name would reach the insert as a
		// column that does not exist and fail the whole save.
		const fields = [
			field({ name: 'title', field_type: 'text' }),
			field({ name: 'editor', field_type: 'relation', relation_type: 'has_one', relation_to: 'authors' }),
			field({ name: 'notes', field_type: 'relation', relation_type: 'has_many', relation_to: 'notes' }),
			field({ name: 'author', field_type: 'relation', relation_type: 'belongs_to', relation_to: 'authors' }),
		];
		const json = serialize(fields, { title: 't', editor: 'id-1', notes: ['id-2'], author_id: 'id-3' });
		expect(JSON.parse(json)).toEqual({ title: 't', author_id: 'id-3' });
	});

	it('serializes text field', () => {
		const json = serialize([field({ name: 'title', field_type: 'text' })], { title: 'hello' });
		expect(JSON.parse(json)).toEqual({ title: 'hello' });
	});

	it('coerces number field', () => {
		const json = serialize([field({ name: 'count', field_type: 'number' })], { count: '42' });
		expect(JSON.parse(json).count).toBe(42);
	});

	it('sends a safe integer as a number and a larger one as its digits', () => {
		const fields = [field({ name: 'n', field_type: 'integer' })];
		expect(JSON.parse(serialize(fields, { n: ' 42 ' })).n).toBe(42);
		expect(JSON.parse(serialize(fields, { n: '-9223372036854775808' })).n).toBe('-9223372036854775808');
		expect(JSON.parse(serialize(fields, { n: 9007199254740991 })).n).toBe(9007199254740991);
		expect(JSON.parse(serialize(fields, { n: '' })).n).toBeNull();
	});

	it('sends an integer that is not a plain whole number as typed, for the API to refuse', () => {
		const fields = [field({ name: 'n', field_type: 'integer' })];
		expect(JSON.parse(serialize(fields, { n: '12.5' })).n).toBe('12.5');
		expect(JSON.parse(serialize(fields, { n: '1e3' })).n).toBe('1e3');
	});

	it('sends a decimal as its trimmed string, never as a number', () => {
		const fields = [field({ name: 'price', field_type: 'decimal', precision: 10, scale: 2 })];
		expect(JSON.parse(serialize(fields, { price: ' 19.90 ' })).price).toBe('19.90');
		expect(JSON.parse(serialize(fields, { price: '' })).price).toBeNull();
	});

	it('sends a decimal holding a comma as typed, for the API to refuse rather than to read as a point', () => {
		const fields = [field({ name: 'price', field_type: 'decimal', precision: 10, scale: 2 })];
		expect(JSON.parse(serialize(fields, { price: '1,000' })).price).toBe('1,000');
	});

	it('null for empty number field', () => {
		const json = serialize([field({ name: 'count', field_type: 'number' })], { count: '' });
		expect(JSON.parse(json).count).toBeNull();
	});

	it('parses JSON field', () => {
		const json = serialize([field({ name: 'meta', field_type: 'json' })], { meta: '{"a":1}' });
		expect(JSON.parse(json).meta).toEqual({ a: 1 });
	});

	it('excludes has_many / many_to_many fields', () => {
		const json = serialize(
			[field({ name: 'tags', field_type: 'relation', relation_type: 'many_to_many' })],
			{ tags: ['id1'] },
		);
		expect(JSON.parse(json)).not.toHaveProperty('tags');
	});

	it('skips system fields', () => {
		const json = serialize(
			[field({ name: 'id', field_type: 'uid', system: true })],
			{ id: 'some-id' },
		);
		expect(JSON.parse(json)).not.toHaveProperty('id');
	});
});

// extractM2MRelations

describe('extractM2MRelations', () => {
	it('returns empty array when no m2m fields', () => {
		const result = extractM2MRelations(
			[field({ name: 'title', field_type: 'text' })],
			{ title: 'hello' },
		);
		expect(result).toEqual([]);
	});

	it('extracts m2m field ids', () => {
		const result = extractM2MRelations(
			[field({ name: 'tags', field_type: 'relation', relation_type: 'many_to_many' })],
			{ tags: ['id1', 'id2'] },
		);
		expect(result).toEqual([{ fieldName: 'tags', ids: ['id1', 'id2'] }]);
	});

	it('ignores system fields', () => {
		const result = extractM2MRelations(
			[field({ name: 'tags', field_type: 'relation', relation_type: 'many_to_many', system: true })],
			{ tags: ['id1'] },
		);
		expect(result).toEqual([]);
	});
});

// serialize / buildFromData / validate. rich_text & JSON edge cases

describe('serialize - JSON and text edge cases', () => {
	it('keeps the raw value when JSON is malformed', () => {
		const json = serialize([field({ name: 'meta', field_type: 'json' })], { meta: '{ not json' });
		expect(JSON.parse(json).meta).toBe('{ not json');
	});

	it('coerces an empty text field to null', () => {
		const json = serialize([field({ name: 'title', field_type: 'text' })], { title: '' });
		expect(JSON.parse(json).title).toBeNull();
	});
});

describe('buildFromData - relation arrays', () => {
	it('passes through an array of related ids', () => {
		const result = buildFromData(
			[field({ name: 'tags', field_type: 'relation', relation_type: 'many_to_many' })],
			{ tags: ['a', 'b'] },
		);
		expect(result.tags).toEqual(['a', 'b']);
	});

	it('defaults a missing relation to an empty array', () => {
		const result = buildFromData(
			[field({ name: 'tags', field_type: 'relation', relation_type: 'has_many' })],
			{},
		);
		expect(result.tags).toEqual([]);
	});
});

describe('serialize - boolean coercion', () => {
	it('casts truthy/falsy boolean field values', () => {
		expect(JSON.parse(serialize([field({ name: 'active', field_type: 'boolean' })], { active: true })).active).toBe(true);
		expect(JSON.parse(serialize([field({ name: 'active', field_type: 'boolean' })], { active: false })).active).toBe(false);
	});
});

describe('validate - rich_text', () => {
	it('reports an error when rich_text contains only empty markup', () => {
		const errors = validate(
			[field({ name: 'body', field_type: 'rich_text', required: true })],
			{ body: '<p></p>' },
		);
		expect(errors.body).toBeDefined();
	});

	it('accepts rich_text with real content', () => {
		const errors = validate(
			[field({ name: 'body', field_type: 'rich_text', required: true })],
			{ body: '<p>Hello</p>' },
		);
		expect(errors).toEqual({});
	});
});

// datetime round trip
//
// There is no vitest.config.ts. The vitest block lives in vite.config.ts and
// pins no zone, so a machine in UTC would pass a build that corrupts every
// entry an operator east or west of it saves. Each case names its own zone and
// asserts a literal.

const when = field({ name: 'when', field_type: 'datetime' });

/** Run one case under a fixed zone. Node applies process.env.TZ immediately. */
function inTZ<T>(tz: string, fn: () => T): T {
	const previous = process.env.TZ;
	process.env.TZ = tz;
	try {
		return fn();
	} finally {
		if (previous === undefined) delete process.env.TZ;
		else process.env.TZ = previous;
	}
}

function toForm(tz: string, stored: unknown): unknown {
	return inTZ(tz, () => buildFromData([when], { when: stored }).when);
}

function toApi(tz: string, formValue: unknown): unknown {
	return inTZ(tz, () => JSON.parse(serialize([when], { when: formValue })).when);
}

/** Load then save with no edit, the pass that must not shift the stored instant. */
function roundTrip(tz: string, stored: string, passes = 1): unknown {
	return inTZ(tz, () => {
		let current: unknown = stored;
		for (let i = 0; i < passes; i++) {
			const form = buildFromData([when], { when: current });
			current = JSON.parse(serialize([when], form)).when;
		}
		return current;
	});
}

describe('datetime test harness', () => {
	it('actually applies the pinned zone', () => {
		// A worker thread holds a copy of process.env, so the assignment never
		// reaches V8 and every case below would quietly read the machine's zone.
		// vite.config.ts runs this file in a forked child for that reason.
		expect(inTZ('Etc/GMT-9', () => new Date(2026, 0, 2).getTimezoneOffset())).toBe(-540);
		expect(inTZ('America/New_York', () => new Date(2026, 0, 2).getTimezoneOffset())).toBe(300);
		expect(inTZ('UTC', () => new Date(2026, 0, 2).getTimezoneOffset())).toBe(0);
	});

	it('restores the ambient zone after a case', () => {
		const before = process.env.TZ;
		inTZ('Etc/GMT-9', () => null);
		expect(process.env.TZ).toBe(before);
	});
});

describe('buildFromData - datetime is the local wall clock of the stored instant', () => {
	it('renders a positive offset zone', () => {
		// Etc/GMT-9 is UTC+9 all year, its sign inverted by POSIX. 03:04:05Z is
		// 12:04:05 there.
		expect(toForm('Etc/GMT-9', '2026-01-02T03:04:05.000Z')).toBe('2026-01-02T12:04:05');
	});

	it('renders a negative offset zone, crossing back over the date', () => {
		// America/New_York is UTC-5 in January.
		expect(toForm('America/New_York', '2026-01-02T03:04:05.000Z')).toBe('2026-01-01T22:04:05');
	});

	it('renders UTC unchanged', () => {
		expect(toForm('UTC', '2026-01-02T03:04:05.000Z')).toBe('2026-01-02T03:04:05');
	});

	it('omits seconds for a whole minute', () => {
		expect(toForm('Etc/GMT-9', '2026-01-02T03:04:00.000Z')).toBe('2026-01-02T12:04');
	});

	it('keeps milliseconds', () => {
		expect(toForm('Etc/GMT-9', '2026-01-02T03:04:05.123Z')).toBe('2026-01-02T12:04:05.123');
	});

	it('honors an offset the stored value carries', () => {
		expect(toForm('UTC', '2026-01-02T12:04:05+09:00')).toBe('2026-01-02T03:04:05');
		expect(toForm('UTC', '2026-01-02T00:04:05-03:00')).toBe('2026-01-02T03:04:05');
	});

	it('reads a zone-less stored timestamp as UTC', () => {
		// A MySQL DATETIME column renders with a space and no zone. The engine
		// stores UTC, so reading it as local would move it by the offset.
		expect(toForm('Etc/GMT-9', '2026-01-02 03:04:05')).toBe('2026-01-02T12:04:05');
	});

	it('applies the offset in force on each side of a DST boundary', () => {
		// America/New_York moves to EDT at 02:00 on 2026-03-08. Two instants an
		// hour apart land two wall clock hours apart, which no fixed offset can
		// produce.
		expect(toForm('America/New_York', '2026-03-08T06:30:00.000Z')).toBe('2026-03-08T01:30');
		expect(toForm('America/New_York', '2026-03-08T07:30:00.000Z')).toBe('2026-03-08T03:30');
	});

	it('keeps a year below 0100 out of the 1900s', () => {
		expect(toForm('UTC', '0099-01-02T03:04:05.000Z')).toBe('0099-01-02T03:04:05');
	});

	it('leaves an empty value empty', () => {
		expect(toForm('Etc/GMT-9', '')).toBe('');
		expect(toForm('Etc/GMT-9', null)).toBe('');
		expect(inTZ('Etc/GMT-9', () => buildFromData([when], {}).when)).toBe('');
	});

	it('hands back an unparseable value unchanged', () => {
		expect(toForm('Etc/GMT-9', 'nope')).toBe('nope');
		expect(toForm('Etc/GMT-9', '2026-02-30T00:00:00Z')).toBe('2026-02-30T00:00:00Z');
		expect(toForm('Etc/GMT-9', '2026-13-02T00:00:00Z')).toBe('2026-13-02T00:00:00Z');
		expect(toForm('Etc/GMT-9', '2026-01-02T25:00:00Z')).toBe('2026-01-02T25:00:00Z');
	});
});

describe('serialize - datetime is a local wall clock going back to an instant', () => {
	it('reads the form value in a positive offset zone', () => {
		expect(toApi('Etc/GMT-9', '2026-01-02T12:04')).toBe('2026-01-02T03:04:00.000Z');
	});

	it('reads the form value in a negative offset zone', () => {
		expect(toApi('America/New_York', '2026-01-01T22:04:05')).toBe('2026-01-02T03:04:05.000Z');
	});

	it('reads the form value in UTC', () => {
		expect(toApi('UTC', '2026-01-02T03:04:05.123')).toBe('2026-01-02T03:04:05.123Z');
	});

	it('uses the offset in force on each side of a DST boundary', () => {
		expect(toApi('America/New_York', '2026-03-08T01:30')).toBe('2026-03-08T06:30:00.000Z');
		expect(toApi('America/New_York', '2026-03-08T03:30')).toBe('2026-03-08T07:30:00.000Z');
	});

	it('honors an explicit zone instead of reading it as local', () => {
		expect(toApi('America/New_York', '2026-01-02T03:04:05Z')).toBe('2026-01-02T03:04:05.000Z');
	});

	it('sends null for an empty value', () => {
		expect(toApi('Etc/GMT-9', '')).toBeNull();
	});

	it('keeps the raw value when the datetime is unparseable', () => {
		expect(toApi('Etc/GMT-9', 'not-a-date')).toBe('not-a-date');
		expect(toApi('Etc/GMT-9', '2026-02-30T00:00')).toBe('2026-02-30T00:00');
	});
});

describe('datetime round trip - load then save with no edit', () => {
	it('returns the stored instant byte for byte in a positive offset zone', () => {
		expect(roundTrip('Etc/GMT-9', '2026-01-02T03:04:00.000Z')).toBe('2026-01-02T03:04:00.000Z');
	});

	it('returns the stored instant byte for byte in a negative offset zone', () => {
		expect(roundTrip('America/New_York', '2026-01-02T03:04:00.000Z')).toBe('2026-01-02T03:04:00.000Z');
	});

	it('returns the stored instant byte for byte in UTC', () => {
		expect(roundTrip('UTC', '2026-01-02T03:04:00.000Z')).toBe('2026-01-02T03:04:00.000Z');
	});

	it('keeps seconds and milliseconds', () => {
		expect(roundTrip('Etc/GMT-9', '2026-01-02T03:04:05.000Z')).toBe('2026-01-02T03:04:05.000Z');
		expect(roundTrip('Etc/GMT-9', '2026-01-02T03:04:05.123Z')).toBe('2026-01-02T03:04:05.123Z');
	});

	it('holds across a DST boundary', () => {
		expect(roundTrip('America/New_York', '2026-03-08T06:30:00.000Z')).toBe('2026-03-08T06:30:00.000Z');
		expect(roundTrip('America/New_York', '2026-03-08T07:30:00.000Z')).toBe('2026-03-08T07:30:00.000Z');
	});

	it('does not drift over repeated saves', () => {
		// A save that reads the wall clock in the wrong zone moves the instant by
		// the offset on every pass.
		expect(roundTrip('Etc/GMT-9', '2026-01-02T03:04:00.000Z', 5)).toBe('2026-01-02T03:04:00.000Z');
		expect(roundTrip('America/New_York', '2026-01-02T03:04:00.000Z', 5)).toBe('2026-01-02T03:04:00.000Z');
	});

	it('canonicalizes an offset the API sent to the same instant in UTC', () => {
		expect(roundTrip('Etc/GMT-9', '2026-01-02T12:04:05+09:00')).toBe('2026-01-02T03:04:05.000Z');
	});
});

