/**
 * Which plugins serve the signed-in tenant, as the shell learned it, and what
 * a page asks of that.
 *
 * The shell reads the set once per document and every page reads it from the
 * layout's data. A page belongs to one plugin. The sidebar lists it only while
 * that plugin runs, and the shell shows why in its place when the engine says
 * the plugin does not run.
 *
 * Hiding a page is a courtesy to the reader and never a control. Every route
 * behind a page answers for itself, whatever the admin shows.
 */
import type { HttpClient } from '@lyeve-labs/client';
import type { PluginStatus, PluginStatusReport } from '@lyeve-labs/client-rest';
import { readRunningPlugins, runningFromStatus, type RunningRead } from '#lib/api/plugins-running.ts';

/** What the shell knows about the plugins that run. */
export type PluginSet =
	/** The engine named them, or its status report did. */
	| { state: 'named'; running: string[]; withheld: string[] }
	/** Nothing could be read. The sidebar lists only the engine's own pages and says why. */
	| { state: 'unread' }
	/**
	 * An engine that does not name them, read by a role the status report is
	 * refused to. Every page is listed and every page renders, and each one
	 * reports what its own reads answer.
	 */
	| { state: 'unnamed' };

export const UNREAD: PluginSet = { state: 'unread' };
export const UNNAMED: PluginSet = { state: 'unnamed' };

/**
 * Whether the engine is known to run a plugin for this tenant, which is what
 * the sidebar, the menus and the dashboard offer a page by. An unread set
 * offers none of them: listing pages nobody vouched for would hide the one
 * notice that says why they are missing.
 */
export function runs(set: PluginSet | null | undefined, plugin: string): boolean {
	const known = set ?? UNNAMED;
	if (known.state === 'named') return known.running.includes(plugin);
	return known.state === 'unnamed';
}

/**
 * Whether the engine said a plugin does not run for this tenant. Only then
 * does the shell show a page's reason in its place, and only then does a load
 * skip the plugin's reads. A set that could not be read says nothing either
 * way, so the page renders and reports what its reads answer.
 */
export function notRunning(set: PluginSet | null | undefined, plugin: string): boolean {
	return set?.state === 'named' && !set.running.includes(plugin);
}

/** Whether a plugin runs on this instance but is withheld from this tenant. */
export function withheldFrom(set: PluginSet | null | undefined, plugin: string): boolean {
	return set?.state === 'named' && set.withheld.includes(plugin);
}

/** What the layout read, for `pluginSetOf`. */
export interface PluginReads {
	running: RunningRead;
	/** The plugin status. Null when it was not read or could not be. */
	status: PluginStatusReport | null;
	/** Whether the reader may read the status at all. */
	operator: boolean;
	/** What an operator withheld from this tenant, from the entitlements. */
	withheld: readonly string[];
}

/**
 * The set from what the layout read. The running list answers when it could
 * be read. An engine without the list is answered from an operator's status
 * report, and for everyone else it shows every page.
 */
export function pluginSetOf(reads: PluginReads): PluginSet {
	if (reads.running === 'failed') return UNREAD;
	if (reads.running !== 'missing') {
		return { state: 'named', running: reads.running.plugins, withheld: reads.running.withheld };
	}
	if (reads.status) {
		const derived = runningFromStatus(reads.status, reads.withheld);
		return { state: 'named', running: derived.plugins, withheld: derived.withheld };
	}
	return reads.operator ? UNREAD : UNNAMED;
}

/**
 * The set as a form action reads it. An action has no layout to ask, so it
 * reads the running list alone, and an engine without the list reads as one
 * that names none.
 */
export async function readPluginSet(client: HttpClient): Promise<PluginSet> {
	return pluginSetOf({ running: await readRunningPlugins(client), status: null, operator: false, withheld: [] });
}

/** Why a page's plugin does not run, as the shell tells its reader. */
export type NotRunningReason =
	/** It runs on this instance and an operator withheld it from this tenant. */
	| { state: 'withheld' }
	/** It stopped with an error when the engine started it. */
	| { state: 'failed'; error: string }
	/** It is in this build and not enabled on this instance. */
	| { state: 'not-enabled'; upgradeUrl: string }
	/** It is in this build and enabled, and the engine did not start it. */
	| { state: 'not-started'; reason: string }
	/** The engine was built without it. */
	| { state: 'not-built' }
	/** The reader cannot see the status report, or it does not say. */
	| { state: 'unexplained' };

const SERVING: readonly string[] = ['running', 'lazy'];

/**
 * Why a plugin does not run. Only an operator reads the status report, so
 * everybody else is told the plugin does not run and who can say why. A
 * withheld plugin is said to be withheld to everybody, because the running
 * list names it to every role.
 */
export function whyNotRunning(
	plugin: string,
	set: PluginSet | null | undefined,
	status: PluginStatusReport | null | undefined,
): NotRunningReason {
	if (withheldFrom(set, plugin)) return { state: 'withheld' };
	if (!status) return { state: 'unexplained' };
	const row: PluginStatus | undefined = status.plugins?.find((p) => p.name === plugin);
	if (!row || !row.compiled) return { state: 'not-built' };
	if (row.phase === 'failed') return { state: 'failed', error: row.last_error ?? '' };
	if (!row.entitled) return { state: 'not-enabled', upgradeUrl: row.upgrade_url ?? '' };
	// The status says it runs and the list said it did not: the two were read
	// a moment apart, around a start. A reload settles it.
	if (SERVING.includes(row.phase)) return { state: 'unexplained' };
	return { state: 'not-started', reason: row.reason ?? '' };
}
