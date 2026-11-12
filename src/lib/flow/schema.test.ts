import { describe, expect, it } from 'vitest';
import {
	datasourceOptions,
	errorsForField,
	eventDescription,
	eventTypeOptions,
	fieldOptions,
	fieldsOf,
	flowOptions,
	fromJSONText,
	hookNameError,
	hasKnownKey,
	isCustom,
	labelFor,
	languageOf,
	parseNumber,
	propertyList,
	relativePath,
	schemaOptions,
	toJSONText,
	widgetFor,
} from './schema';
import { fixtureDatasources, fixtureEventTypes, fixtureFlowOptions, fixtureGroupedEventTypes, fixtureSchemas } from './fixtures';
import type { JsonSchema } from './types';

describe('widgetFor', () => {
	it.each<[string, JsonSchema, string]>([
		['an enum, whatever its type', { type: 'string', enum: ['a', 'b'] }, 'enum'],
		['a string marked x-expression', { type: 'string', 'x-expression': true }, 'expression'],
		['a plain string', { type: 'string' }, 'string'],
		['a number', { type: 'number' }, 'number'],
		['an integer', { type: 'integer' }, 'number'],
		['a boolean', { type: 'boolean' }, 'boolean'],
		['an array of strings', { type: 'array', items: { type: 'string' } }, 'tags'],
		['an array of anything else', { type: 'array', items: { type: 'object' } }, 'json'],
		['an array of enum values', { type: 'array', items: { type: 'string', enum: ['rest', 'grpc'] }, uniqueItems: true }, 'choices'],
		['an object with properties', { type: 'object', properties: { a: { type: 'string' } } }, 'object'],
		['an object without properties', { type: 'object', additionalProperties: { type: 'string' } }, 'map'],
		['no type at all', {}, 'json'],
		['a string sourced from the published flows', { type: 'string', 'x-source': 'flows' }, 'flow'],
		['a string sourced from the event types', { type: 'string', 'x-source': 'event-types' }, 'event'],
		['a list sourced from the flows, which no picker offers', { type: 'array', items: { type: 'string' }, 'x-source': 'flows' }, 'tags'],
	])('picks the widget for %s', (_name, schema, widget) => {
		expect(widgetFor(schema)).toBe(widget);
	});

	it('reads the non-null type out of a nullable union', () => {
		expect(widgetFor({ type: ['null', 'integer'] })).toBe('number');
		expect(widgetFor({ type: ['null'] })).toBe('string');
	});

	it('lets an empty enum fall through to the type', () => {
		expect(widgetFor({ type: 'boolean', enum: [] })).toBe('boolean');
	});
});

describe('propertyList', () => {
	it('leads with the required keys and marks them', () => {
		const list = propertyList({
			type: 'object',
			properties: { b: { type: 'string' }, a: { type: 'number' } },
			required: ['a'],
		});
		expect(list.map((p) => p.key)).toEqual(['a', 'b']);
		expect(list.map((p) => p.required)).toEqual([true, false]);
	});

	it('is empty for a schema with no properties', () => {
		expect(propertyList({ type: 'object' })).toEqual([]);
	});
});

describe('labelFor', () => {
	it('prefers the title and falls back to the key with spaces', () => {
		expect(labelFor('left_key', { title: 'Left key' })).toBe('Left key');
		expect(labelFor('left_key', {})).toBe('left key');
		expect(labelFor('left_key', { title: '' })).toBe('left key');
	});

	it('names an untitled content type picker a content type, not by its key', () => {
		expect(labelFor('schema', { type: 'string', 'x-source': 'content-schemas' })).toBe('content type');
		expect(labelFor('schema', { type: 'string', title: 'Target', 'x-source': 'content-schemas' })).toBe('Target');
		expect(labelFor('schema', { type: 'string' })).toBe('schema');
	});
});

describe('parseNumber', () => {
	it('parses a number and refuses blanks and words', () => {
		expect(parseNumber(' 12 ')).toBe(12);
		expect(parseNumber('-1.5')).toBe(-1.5);
		expect(parseNumber('')).toBeUndefined();
		expect(parseNumber('   ')).toBeUndefined();
		expect(parseNumber('{{ input }}')).toBeUndefined();
		expect(parseNumber('Infinity')).toBeUndefined();
	});
});

describe('toJSONText and fromJSONText', () => {
	it('prints nothing for nothing and a string as itself', () => {
		expect(toJSONText(undefined)).toBe('');
		expect(toJSONText(null)).toBe('');
		expect(toJSONText('{{ input }}')).toBe('{{ input }}');
	});

	it('pretty prints a structure', () => {
		expect(toJSONText({ a: 1 })).toBe('{\n  "a": 1\n}');
	});

	it('parses JSON and keeps a bare expression as text', () => {
		expect(fromJSONText('{"a": 1}')).toEqual({ a: 1 });
		expect(fromJSONText('  ')).toBeUndefined();
		expect(fromJSONText('{{ input.rows }}')).toBe('{{ input.rows }}');
	});

	it('round trips through the two', () => {
		const value = { rows: [1, 2], name: 'x' };
		expect(fromJSONText(toJSONText(value))).toEqual(value);
	});
});

describe('relativePath', () => {
	it('splits the segments below the base', () => {
		expect(relativePath('/config/headers/x-a', '/config')).toEqual(['headers', 'x-a']);
		expect(relativePath('/config', '/config')).toEqual([]);
	});

	it('is null off the base, including a base that is only a prefix of a segment', () => {
		expect(relativePath('/position/x', '/config')).toBeNull();
		expect(relativePath('/configuration/x', '/config')).toBeNull();
	});
});

describe('hasKnownKey', () => {
	const schema: JsonSchema = { type: 'object', properties: { headers: { type: 'object' }, body: { type: 'string' } } };

	it('is true when the first segment below the base is a property', () => {
		expect(hasKnownKey(schema, '/config', '/config/body')).toBe(true);
		expect(hasKnownKey(schema, '/config', '/config/headers/x-a')).toBe(true);
	});

	it('is false for an unknown key, the base itself and a path elsewhere', () => {
		expect(hasKnownKey(schema, '/config', '/config/nope')).toBe(false);
		expect(hasKnownKey(schema, '/config', '/config')).toBe(false);
		expect(hasKnownKey(schema, '/config', '/type')).toBe(false);
		expect(hasKnownKey({}, '/config', '/config/body')).toBe(false);
	});
});

describe('errorsForField', () => {
	const errors = [
		{ path: '/config/headers', message: 'on the field' },
		{ path: '/config/headers/x-a', message: 'below it' },
		{ path: '/config/body', message: 'elsewhere' },
	];

	it('takes the exact path and anything below it for a leaf or a map', () => {
		const found = errorsForField({ type: 'object', additionalProperties: { type: 'string' } }, '/config/headers', errors);
		expect(found).toEqual([
			{ suffix: '', message: 'on the field' },
			{ suffix: 'x-a', message: 'below it' },
		]);
	});

	it('leaves a deeper error to the nested form when that form has the key', () => {
		const nested: JsonSchema = { type: 'object', properties: { 'x-a': { type: 'string' } } };
		expect(errorsForField(nested, '/config/headers', errors)).toEqual([{ suffix: '', message: 'on the field' }]);
	});

	it('keeps a deeper error the nested form does not know', () => {
		const nested: JsonSchema = { type: 'object', properties: { other: { type: 'string' } } };
		expect(errorsForField(nested, '/config/headers', errors).map((e) => e.suffix)).toEqual(['', 'x-a']);
	});
});

describe('picker hints', () => {
	it('chooses a picker widget from the source hint and the type', () => {
		expect(widgetFor({ type: 'string', 'x-source': 'content-schemas' })).toBe('schema');
		expect(widgetFor({ type: 'string', 'x-source': 'content-fields' })).toBe('field');
		expect(widgetFor({ type: 'array', items: { type: 'string' }, 'x-source': 'content-fields' })).toBe('fields');
		expect(widgetFor({ type: 'string', 'x-source': 'datasources', 'x-kinds': ['postgres'] })).toBe('datasource');
		expect(widgetFor({ type: 'string', 'x-editor': 'code', 'x-language': 'sql' })).toBe('code');
		expect(widgetFor({ type: 'array', items: { type: 'array' }, 'x-editor': 'grid' })).toBe('grid');
		// A keys hint on a map leaves the map widget alone. The form reads it for the key column.
		expect(widgetFor({ type: 'object', additionalProperties: { type: 'string' }, 'x-keys-source': 'content-fields' })).toBe('map');
		// An enum outranks a source: the engine's fixed list is the list.
		expect(widgetFor({ type: 'string', enum: ['a'], 'x-source': 'content-schemas' })).toBe('enum');
	});

	it('lists the fields of the named schema with the system columns first', () => {
		expect(fieldsOf(fixtureSchemas, 'orders')).toEqual(['id', 'created_at', 'updated_at', 'total', 'customer', 'status']);
		expect(fieldsOf(fixtureSchemas, 'missing')).toEqual([]);
		expect(fieldsOf(fixtureSchemas, undefined)).toEqual([]);
		expect(fieldsOf(fixtureSchemas, '{{ trigger.query.schema }}')).toEqual([]);
	});

	it('offers each field ascending and descending for a sort', () => {
		expect(fieldOptions(['id', 'total'], true).map((o) => o.value)).toEqual(['id', '-id', 'total', '-total']);
		expect(fieldOptions(['id'], false).map((o) => o.value)).toEqual(['id']);
	});

	it('labels a schema by its display name and keeps the name as the value', () => {
		expect(schemaOptions(fixtureSchemas)[0]).toMatchObject({ value: 'orders', label: 'Orders (orders)' });
		expect(schemaOptions([{ name: 'tags', display_name: 'tags', fields: [] }])[0].label).toBe('tags');
	});

	it('filters datasources by the kinds the schema names', () => {
		expect(datasourceOptions(fixtureDatasources, ['postgres', 'mysql', 'mssql']).map((o) => o.value)).toEqual(['warehouse']);
		expect(datasourceOptions(fixtureDatasources).map((o) => o.value)).toEqual(['warehouse', 'inventory']);
		expect(datasourceOptions(fixtureDatasources, ['http'])[0].label).toBe('inventory (http)');
	});

	it('reads the code language from the hint, or from the sibling it names', () => {
		expect(languageOf({ 'x-language': 'sql' }, {})).toBe('sql');
		expect(languageOf({ 'x-language': '$format' }, { format: 'yaml' })).toBe('yaml');
		expect(languageOf({ 'x-language': '$format' }, {})).toBe('text');
		expect(languageOf({}, {})).toBe('text');
	});

	it('offers the published flows by name and leaves the flow being edited out', () => {
		const rows = flowOptions(fixtureFlowOptions, 'f1');
		expect(rows.map((o) => o.value)).toEqual(['send-receipt', 'nightly-sync']);
		expect(rows[0].label).toBe('Send receipt (send-receipt)');
		expect(rows[1].label).toBe('nightly-sync');
		expect(flowOptions(fixtureFlowOptions)).toHaveLength(3);
	});

	it('groups the hooks by plugin as neighboring rows and searches by plugin and description', () => {
		const rows = eventTypeOptions(fixtureGroupedEventTypes);
		expect(rows.map((o) => [o.group, o.value])).toEqual([
			['example', 'example.closed'],
			['example', 'example.opened'],
			['flow', 'flow.run_failed'],
		]);
		expect(rows[2].keywords).toEqual(['flow', 'A flow run ended failed.']);
		expect(eventTypeOptions([{ name: 'custom:x', plugin: '', description: '' }])[0].group).toBe('Other');
		expect(eventDescription(fixtureEventTypes.system, 'flow.run_failed')).toBe('A flow run ended failed.');
		expect(eventDescription(fixtureEventTypes.system, 'unknown:hook')).toBeUndefined();
	});

	it('refuses a hook name the engine would, and says how', () => {
		expect(hookNameError('form:after_submit')).toBeUndefined();
		expect(hookNameError('')).toBeUndefined();
		expect(hookNameError(undefined)).toBeUndefined();
		expect(hookNameError('Form:After')).toContain('lower case');
		expect(hookNameError('9lives')).toContain('starting with a letter');
		expect(hookNameError(`a${'b'.repeat(80)}`)).toContain('80 characters');
	});

	it('knows when a value is not one the picker offers', () => {
		const options = fieldOptions(['id']);
		expect(isCustom(options, 'id')).toBe(false);
		expect(isCustom(options, '{{ x }}')).toBe(true);
		expect(isCustom(options, '')).toBe(false);
		expect(isCustom(options, undefined)).toBe(false);
	});
});

describe('propertyList order', () => {
	it('leads with the required keys in the order the schema lists them', () => {
		const keys = propertyList({
			type: 'object',
			required: ['schema', 'id'],
			properties: { populate: { type: 'array' }, id: { type: 'string' }, schema: { type: 'string' } },
		} as never).map((p) => p.key);
		expect(keys).toEqual(['schema', 'id', 'populate']);
	});
});
