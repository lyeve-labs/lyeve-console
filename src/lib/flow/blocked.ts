/**
 * The blocked state, as the engine words it.
 *
 * A published flow is blocked when its version names a node type no started
 * plugin contributes any more. The engine says so in two places: the flow's
 * status, and a 422 whose message is `BLOCKED_MESSAGE` when a blocked flow is
 * run. A definition that names such a type is refused at validation with a
 * message that names the plugin the instance would need, and the editor reads
 * the plugin out of that message so the banner and the pill can say which.
 */

import type { ValidationError } from '$lib/api/flows';

/** The static message of a 422 on a run of a blocked flow, verbatim. */
export const BLOCKED_MESSAGE = 'flow is blocked: a node type it uses is not available on this engine';

/** The same message from a flow plugin released before the API said "engine". */
export const BLOCKED_MESSAGE_BEFORE = 'flow is blocked: a node type it uses is not available on this instance';

/** What every blocked surface says, before the plugin is known. */
export const BLOCKED_TEXT = 'A node type this flow uses is not available on this instance.';

export function isBlockedMessage(message: string | null | undefined): boolean {
	const trimmed = (message ?? '').trim();
	return trimmed === BLOCKED_MESSAGE || trimmed === BLOCKED_MESSAGE_BEFORE;
}

/**
 * The validation message of a missing contributed type ends in "it needs the
 * <plugin> plugin, which is not started". The plugin's name is the word after
 * "needs the".
 */
const NEEDS_PLUGIN = /\bneeds the (\S+) plugin\b/;

/** The plugin a validation message says is missing, or null when it names none. */
export function missingPlugin(message: string): string | null {
	const m = NEEDS_PLUGIN.exec(message);
	return m ? m[1] : null;
}

/** The first plugin the problems list names as missing, or null. */
export function missingPluginOf(errors: readonly ValidationError[]): string | null {
	for (const err of errors) {
		const plugin = missingPlugin(err.message);
		if (plugin) return plugin;
	}
	return null;
}

/** The blocked sentence, naming the plugin when one is known. */
export function blockedText(plugin: string | null = null): string {
	return plugin ? `${BLOCKED_TEXT} It needs the ${plugin} plugin, which is not started.` : BLOCKED_TEXT;
}

/**
 * The sentence for a 402 that names the elements this instance does not
 * enable, or the routes as a whole when it names none. A save, a publish and
 * a test run each say it in these words.
 */
export function notEnabledText(nodeIds: readonly string[]): string {
	if (nodeIds.length === 0) return 'Flows are not enabled on this instance.';
	const named = nodeIds.map((id) => (id === 'trigger' ? 'the trigger' : id)).join(', ');
	return `${nodeIds.length === 1 ? 'One element uses' : `${nodeIds.length} elements use`} a feature that is not enabled on this instance: ${named}.`;
}
