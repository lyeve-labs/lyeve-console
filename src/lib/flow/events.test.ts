import { describe, expect, it } from 'vitest';
import { eventKindOf, isEventTriggerSchema, kindSchema, switchKind } from './events';
import { fixtureCatalog } from './fixtures';

const spec = fixtureCatalog.find((s) => s.type === 'trigger.event')!.config_schema;

describe('event trigger shape', () => {
	it('matches a schema with the kind enum and a name sourced from the event types', () => {
		expect(isEventTriggerSchema(spec)).toBe(true);
	});

	it('leaves a content-only trigger to the plain form', () => {
		expect(isEventTriggerSchema({ type: 'object', properties: { schema: { type: 'string' }, event: { type: 'string', enum: ['after_create'] } } })).toBe(false);
		expect(isEventTriggerSchema({ type: 'object', properties: { kind: { type: 'string', enum: ['content'] }, name: { type: 'string', 'x-source': 'event-types' } } })).toBe(false);
	});

	it('reads content as the kind when the config says nothing', () => {
		expect(eventKindOf({})).toBe('content');
		expect(eventKindOf({ kind: 'system' })).toBe('system');
		expect(eventKindOf({ kind: 'anything else' })).toBe('content');
	});

	it('slices the schema per kind and marks what that kind cannot do without', () => {
		const content = kindSchema(spec, 'content');
		expect(Object.keys(content.properties!)).toEqual(['schema', 'event']);
		expect(content.required).toEqual(['schema', 'event']);
		const system = kindSchema(spec, 'system');
		expect(Object.keys(system.properties!)).toEqual(['name', 'schema', 'filter']);
		expect(system.required).toEqual(['name']);
		expect(system.properties!.schema.title).toBe('Scope (content type or publisher key)');
		expect(system.properties!.schema.description).toContain('flow slug');
		expect(content.properties!.schema.title).toBe('Schema');
	});

	it('keeps a key no kind claims under both, with the schema\'s own required list', () => {
		const wider = { ...spec, properties: { ...spec.properties, debounce: { type: 'integer' } }, required: ['debounce'] };
		expect(Object.keys(kindSchema(wider, 'system').properties!)).toEqual(['name', 'schema', 'filter', 'debounce']);
		expect(kindSchema(wider, 'system').required).toEqual(['name', 'debounce']);
	});

	it('switching the kind drops both kinds\' keys, the schema included, and keeps an unclaimed one', () => {
		expect(switchKind(spec, { schema: 'orders', event: 'after_create' }, 'system')).toEqual({ kind: 'system' });
		expect(switchKind(spec, { kind: 'system', name: 'flow.run_failed', schema: 'contact', filter: 'x' }, 'content')).toEqual({ kind: 'content' });
		expect(switchKind(spec, { kind: 'system', name: 'flow.run_failed', debounce: 3 }, 'content')).toEqual({ kind: 'content', debounce: 3 });
	});
});
