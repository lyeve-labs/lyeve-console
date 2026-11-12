/**
 * What the inspector knows about an event trigger without naming its type:
 * which schema shape is one, and which of its properties belong to each
 * kind of subscription.
 */

import type { JsonSchema } from './types';

export type EventKind = 'content' | 'system';

export const EVENT_KINDS: EventKind[] = ['content', 'system'];

const KIND_KEY = 'kind';

/** What the schema field is called under a system event, and what it does there. */
export const SCOPE_LABEL = 'Scope (content type or publisher key)';
export const SCOPE_HINT =
	"Optional. The publisher's key, such as the flow slug for a run hook or the content type of a record. Leave blank for all.";

/**
 * The keys each kind reads, in the order the form draws them. A system
 * event may still name a schema, which for a publisher such as the flow
 * plugin is the flow slug, so `schema` shows under both and is required
 * under content only. The rest of the schema, if any, shows under both.
 */
const KIND_KEYS: Record<EventKind, string[]> = {
	content: ['schema', 'event'],
	system: ['name', 'schema', 'filter'],
};

/**
 * A schema the event trigger form renders: a `kind` enum offering content and
 * system, and a `name` whose rows come from the event types. Matched by shape
 * rather than by trigger type, so the catalog stays the only authority on
 * what a trigger is. An engine without the kind still gets the plain form.
 */
export function isEventTriggerSchema(schema: JsonSchema): boolean {
	const kind = schema.properties?.[KIND_KEY];
	if (!kind || !Array.isArray(kind.enum)) return false;
	if (!EVENT_KINDS.every((k) => kind.enum!.includes(k))) return false;
	return schema.properties?.name?.['x-source'] === 'event-types';
}

/** The kind a config is in. Content when it says nothing, which is the engine's default. */
export function eventKindOf(config: Record<string, unknown>): EventKind {
	return config[KIND_KEY] === 'system' ? 'system' : 'content';
}

/**
 * The slice of the trigger schema one kind renders: its own keys plus any
 * the schema declares that no kind claims. A key is required when the
 * schema says so or when the kind cannot work without it, which the
 * schema cannot say because its required list is the same for both.
 */
export function kindSchema(schema: JsonSchema, kind: EventKind): JsonSchema {
	const claimed = new Set([KIND_KEY, ...Object.values(KIND_KEYS).flat()]);
	if (kind === 'system') claimed.add('event');
	const own = KIND_KEYS[kind];
	const keys = [...own, ...Object.keys(schema.properties ?? {}).filter((k) => !claimed.has(k))];
	const properties: Record<string, JsonSchema> = {};
	for (const key of keys) {
		const p = schema.properties?.[key];
		if (p) properties[key] = p;
	}
	// Under a system event the schema is the publisher's own key, a flow slug
	// for a run hook, so the field says so rather than "schema".
	if (kind === 'system' && properties.schema) {
		properties.schema = { ...properties.schema, title: SCOPE_LABEL, description: SCOPE_HINT };
	}
	const declared = schema.required ?? [];
	const needed = kind === 'content' ? ['schema', 'event'] : ['name'];
	const required = [...needed, ...declared].filter((k, i, all) => k in properties && all.indexOf(k) === i);
	return { ...schema, properties, required };
}

/**
 * The config after a kind change: the new kind, and only the keys the
 * schema declares for neither kind in particular. The other kind's keys
 * would leave a content trigger naming a hook, and the schema means a
 * different thing on each side (a content schema, then a publisher's key),
 * so a content schema carried into a system event would scope it to
 * nothing. Both go.
 */
export function switchKind(schema: JsonSchema, config: Record<string, unknown>, kind: EventKind): Record<string, unknown> {
	const claimed = new Set([KIND_KEY, ...Object.values(KIND_KEYS).flat()]);
	const out: Record<string, unknown> = { [KIND_KEY]: kind };
	for (const [k, v] of Object.entries(config)) {
		if (!claimed.has(k)) out[k] = v;
	}
	return out;
}
