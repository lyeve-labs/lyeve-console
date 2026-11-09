/**
 * A test run of the draft on the canvas: the sample trigger it starts from,
 * the nodes it may stop at, and the reading of a refused run. Nothing here
 * touches the network.
 */

import { ApiError } from '@lyeve-labs/client';
import { FlowRefusal, validationErrors, type ValidationError } from '$lib/api/flows';
import { isOutage } from '$lib/api/gate';
import { outageFor } from '$lib/outage';
import { SIGN_IN_AGAIN } from '$lib/session';
import { isBlockedMessage, notEnabledText } from './blocked';
import type { FlowDefinition } from './types';

/**
 * What the sample trigger follows. The kind of an event trigger changes the
 * payload shape as much as the type does, and a system event's name and scope
 * are part of it, so the sample follows those and nothing else in the config.
 */
export function sampleKey(trigger: FlowDefinition['trigger']): string {
	const { type, config } = trigger;
	return type === 'trigger.event' && config.kind === 'system'
		? `${type}:system:${String(config.name ?? '')}:${String(config.schema ?? '')}`
		: `${type}:${String(config.kind ?? '')}`;
}

/** The nodes a test run may stop after, the whole run first. */
export function untilOptions(nodes: FlowDefinition['nodes']): { value: string; label: string }[] {
	return [{ value: '', label: 'Run to the end' }, ...nodes.map((n) => ({ value: n.id, label: n.name ? `${n.name} (${n.id})` : n.id }))];
}

/** The trigger payload the reader typed, or why it cannot be sent. An empty field is an empty object. */
export function parseTrigger(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
	try {
		return { ok: true, value: text.trim() ? JSON.parse(text) : {} };
	} catch {
		return { ok: false, error: 'The trigger is not valid JSON.' };
	}
}

/** What a refused test run means for the editor. */
export type TestFailure =
	| { kind: 'blocked' }
	| {
			kind: 'refused';
			/** The problems to mark on the canvas, empty when the refusal names none. */
			errors: ValidationError[];
			/** What the test panel says. */
			text: string;
	  };

/**
 * Reads a failed test run. A 402 names the nodes this instance does not
 * enable, or none when flows are not enabled at all, and either is said in
 * the save's words. The engine refuses a blocked flow with one static
 * message, and a definition naming a type no started plugin contributes with
 * the validation list. Neither is a run that failed: the first is the
 * banner, the second lands on the node it names.
 */
export function testFailure(err: unknown): TestFailure {
	if (err instanceof FlowRefusal) return { kind: 'refused', errors: err.errors, text: notEnabledText(err.nodeIds) };
	// The run was sent again after a renewal, so a 401 here is a session that ended.
	if (err instanceof ApiError && err.status === 401) return { kind: 'refused', errors: [], text: SIGN_IN_AGAIN };
	if (isOutage(err)) return { kind: 'refused', errors: [], text: outageFor('the test run did not finish') };
	const message = err instanceof Error ? err.message : '';
	if (isBlockedMessage(message)) return { kind: 'blocked' };
	const errors = validationErrors(message);
	if (errors.length > 0) return { kind: 'refused', errors, text: 'Fix the problems in the definition.' };
	// The client puts the raw body of an answer that was not JSON in the
	// message, which may be a proxy's error page. Only a refusal the engine
	// worded is relayed.
	const worded = err instanceof ApiError && err.status >= 400 && err.status < 500 && err.body !== undefined;
	return { kind: 'refused', errors: [], text: (worded && message) || 'The test run failed.' };
}
