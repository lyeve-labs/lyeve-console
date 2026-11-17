import type { ValidationError } from '#lib/api/flows.ts';
import type { ProblemItem } from '#lib/components/ProblemsMenu.svelte';
import { nodeById, specFor } from './graph';
import { TRIGGER_ID, type FlowDefinition, type NodeSpec } from './types';

/** Pointer segments that name a part of the definition rather than a field in it. */
const CONTAINERS = new Set(['config', 'edges', 'nodes', 'notes', 'settings', 'trigger']);

/** A message that reads as the rest of a sentence about the field: `must be a duration`. */
const PREDICATE = /^(must|is|are|cannot|has|have|needs|references|should)\b/i;
/** A message that is a verdict on the field without a verb: `not a duration`, `unsupported`. */
const FRAGMENT = /^(not|unsupported|unknown|no)\b/i;

/** Sentence case for a key: `left_key` reads as "Left key". */
function words(key: string): string {
	const s = key.replace(/_/g, ' ');
	return s.charAt(0).toUpperCase() + s.slice(1);
}

function sentence(s: string): string {
	const t = s.charAt(0).toUpperCase() + s.slice(1);
	return /[.!?]$/.test(t) ? t : `${t}.`;
}

/**
 * A validation error in the reader's terms.
 *
 * The engine names a node by its id and the field by a JSON pointer, and
 * words its message as a predicate on that field: `required`, `must be a
 * duration such as 30s`. Printed side by side, the three read as
 * `content_query/config/schema required`, so this names the node the way its
 * card does, and makes the field and the predicate one sentence.
 */
export function describeError(err: ValidationError, def: FlowDefinition, catalog: NodeSpec[], index: number): ProblemItem {
	const segments = err.path.split('/').filter(Boolean);
	const last = segments.at(-1);
	const field = last && !/^\d+$/.test(last) && !CONTAINERS.has(last) ? last : undefined;
	let where = 'Flow';
	if (err.node_id && err.node_id !== TRIGGER_ID) {
		const node = nodeById(def, err.node_id);
		where = node ? node.name || specFor(catalog, node.type)?.label || node.id : err.node_id;
	} else if (err.node_id === TRIGGER_ID || segments[0] === 'trigger') {
		where = 'Trigger';
	} else if (segments[0] === 'settings') {
		where = 'Flow settings';
	} else if (segments[0] === 'edges' && /^\d+$/.test(segments[1] ?? '')) {
		where = `Connection ${Number(segments[1]) + 1}`;
	}
	const message = err.message.trim();
	let what: string;
	if (!field) what = sentence(message);
	else if (message === 'required') what = `${words(field)} is required.`;
	else if (PREDICATE.test(message)) what = sentence(`${words(field)} ${message}`);
	else if (FRAGMENT.test(message)) what = sentence(`${words(field)}: ${message}`);
	else what = sentence(message);
	return { key: `${index}:${err.node_id ?? ''}${err.path}`, where, what };
}
