/**
 * What the access rules let the reader do with one content type.
 *
 * The content plugin decides it per type and reports it on its access route
 * and on every entry it returns: `hidden_fields` names the fields the reader
 * may not read, which an entry leaves out, and `allowed_actions` names which
 * of create, read, update and delete the reader may take. An engine older
 * than the rules reports nothing, so its screens offer what the type
 * defines and the engine refuses what it refuses.
 */
import type { Schema } from '@lyeve-labs/client';

export type ContentAction = 'create' | 'read' | 'update' | 'delete';

const ACTIONS: readonly ContentAction[] = ['create', 'read', 'update', 'delete'];

export type TypeAccess = {
	/** The fields hidden from the reader, a relation by its field and its key column alike. */
	hidden: string[];
	/** The actions the reader may take, or null when the engine did not say. */
	actions: ContentAction[] | null;
};

export const UNKNOWN_ACCESS: TypeAccess = { hidden: [], actions: null };

/** The access an entry reports. An engine older than the rules reports none. */
export function accessOf(entry: unknown): TypeAccess {
	if (entry === null || typeof entry !== 'object') return UNKNOWN_ACCESS;
	const { hidden_fields: hidden, allowed_actions: actions } = entry as {
		hidden_fields?: unknown;
		allowed_actions?: unknown;
	};
	return {
		hidden: Array.isArray(hidden) ? hidden.filter((n): n is string => typeof n === 'string') : [],
		actions: Array.isArray(actions)
			? ACTIONS.filter((a) => actions.includes(a))
			: null,
	};
}

/**
 * Two reports on one type joined: every field either hides, and the newer
 * report's actions when it carries any.
 */
export function joinAccess(older: TypeAccess, newer: TypeAccess): TypeAccess {
	return {
		hidden: [...new Set([...older.hidden, ...newer.hidden])],
		actions: newer.actions ?? older.actions,
	};
}

/** Whether the reader may take `action`. Without a report the engine decides on the request. */
export function may(access: TypeAccess | undefined, action: ContentAction): boolean {
	return !access?.actions || access.actions.includes(action);
}

/** A definition with the fields the reader may not read taken out, which the list keys read. */
export type ReadableSchema = Schema & { hidden_fields?: readonly string[] };

/**
 * The definition as the reader may use it: the hidden fields are gone, so no
 * screen draws, filters, sorts or sends them, and the names stay on the
 * definition for the entry's own title and slug, which no field declares.
 */
export function withoutHidden(def: Schema, hidden: readonly string[]): ReadableSchema {
	if (hidden.length === 0) return def;
	const names = new Set(hidden);
	return { ...def, fields: (def.fields ?? []).filter((f) => !names.has(f.name)), hidden_fields: [...names] };
}

/** Whether the reader's rules hide `name` on this definition. */
export function hides(def: Schema, name: string): boolean {
	return (def as ReadableSchema).hidden_fields?.includes(name) ?? false;
}
