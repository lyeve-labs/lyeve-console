/**
 * One row per plugin, from the plugin status alone.
 *
 * The engine reports every plugin compiled into it: whether it is enabled on
 * this instance, the phase it reached, and why it does not run when it does
 * not. Each plugin describes itself in the manifest its row carries, so the
 * list shows what the engine it talks to carries and nothing else. A plugin
 * that sends no manifest is listed by its name, under Other.
 */
import type { StatusTone } from '@lyeve-labs/ui-kit';
import type {
	PluginManifest,
	PluginRoute,
	PluginRouteGroup,
	PluginStatus,
	PluginStatusReport,
} from '@lyeve-labs/client-rest';
import { SERVING_PHASES } from '$lib/api/plugins-running';
import { linkHref } from '$lib/links';
import { CATEGORY_ORDER, categoryOf, type CategoryKey } from '$lib/plugin-categories';
import { text } from '$lib/api/narrow';

export type { PluginManifest, PluginRoute };

/** Who may call a route the plugin serves. */
export type RouteGroup = PluginRouteGroup;

/**
 * A status row as the page reads it. The manifest and the routes may be
 * absent, so both are read defensively.
 */
export type DescribedPluginStatus = PluginStatus;

/**
 * What a row is, in a word or two.
 *
 * Resolved in this order. A plugin the engine was built without has nothing
 * more to say. A failure comes next, because a plugin that stopped with an
 * error is the one that needs somebody today. A plugin that serves its routes
 * runs. Of the rest, one that is not enabled on this instance says so, and
 * one that is enabled and was not started says why, when the engine did.
 */
export type PluginState = 'failed' | 'running' | 'not-enabled' | 'not-started' | 'not-built';

export const PLUGIN_STATES: readonly PluginState[] = [
	'failed',
	'running',
	'not-enabled',
	'not-started',
	'not-built',
];

export const STATE_LABEL: Record<PluginState, string> = {
	failed: 'Failed',
	running: 'Running',
	'not-enabled': 'Not enabled',
	'not-started': 'Not started',
	'not-built': 'Not in this build',
};

/** The badge tone for each state. Only a failure and a running plugin carry a color. */
export const STATE_TONE: Record<PluginState, StatusTone> = {
	failed: 'danger',
	running: 'success',
	'not-enabled': 'neutral',
	'not-started': 'neutral',
	'not-built': 'neutral',
};

/** What a plugin says about itself, as a row shows it. */
export interface PluginDescription {
	label: string;
	description: string;
	category: CategoryKey;
	beta: boolean;
}

export interface PluginRow extends PluginDescription {
	name: string;
	state: PluginState;
	/**
	 * What the engine said about a plugin that does not run: the error it
	 * stopped with, or why it was not started. Null when it said nothing.
	 */
	reason: string | null;
	/** Where the plugin is turned on, on a row that is not enabled, when the engine offered a safe link. */
	upgradeUrl: string | null;
}

/** What a plugin says about itself. One that says nothing is labeled by its name. */
export function describePlugin(status: PluginStatus): PluginDescription {
	const raw = (status as DescribedPluginStatus).manifest;
	const manifest: Partial<Record<keyof PluginManifest, unknown>> =
		raw && typeof raw === 'object' ? raw : {};
	return {
		label: text(manifest.label) || status.name,
		description: text(manifest.description),
		category: categoryOf(text(manifest.category)),
		beta: text(manifest.maturity) === 'beta',
	};
}

export function stateOf(status: PluginStatus): PluginState {
	if (!status.compiled) return 'not-built';
	if (status.phase === 'failed') return 'failed';
	if (SERVING_PHASES.includes(status.phase)) return 'running';
	if (!status.entitled) return 'not-enabled';
	return 'not-started';
}

function reasonOf(status: PluginStatus, state: PluginState): string | null {
	if (state === 'failed') return text(status.last_error) || text(status.reason) || null;
	if (state === 'not-enabled' || state === 'not-started') return text(status.reason) || null;
	return null;
}

export function rowOf(status: PluginStatus): PluginRow {
	const state = stateOf(status);
	return {
		name: status.name,
		...describePlugin(status),
		state,
		reason: reasonOf(status, state),
		upgradeUrl: state === 'not-enabled' ? linkHref(status.upgrade_url) : null,
	};
}

/** Every row, by label, so a group reads in the order a person looks things up. */
export function buildRows(plugins: readonly PluginStatus[]): PluginRow[] {
	return plugins
		.map(rowOf)
		.sort((a, b) => a.label.localeCompare(b.label, 'en', { sensitivity: 'base' }) || a.name.localeCompare(b.name));
}

/** What the detail page shows beyond the row. */
export interface PluginDetail extends PluginRow {
	/** The version the plugin reports, or null when it reports none. */
	version: string | null;
	/** When a running plugin started, as the engine sent it. */
	startedAt: string | null;
	/** The routes a running plugin serves, in the engine's order. */
	routes: PluginRoute[];
}

/** Who may call each group, in the order the page lists them. */
export const ROUTE_GROUPS: readonly RouteGroup[] = ['public', 'auth', 'admin', 'super_admin'];

export const ROUTE_GROUP_LABEL: Record<RouteGroup, string> = {
	public: 'Anyone',
	auth: 'Signed-in users',
	admin: 'Admins',
	super_admin: 'Super admins',
};

function routesOf(status: DescribedPluginStatus): PluginRoute[] {
	if (!Array.isArray(status.routes)) return [];
	return status.routes.filter(
		(r): r is PluginRoute =>
			!!r && typeof r.method === 'string' && typeof r.pattern === 'string' && ROUTE_GROUPS.includes(r.group),
	);
}

/** The routes in each group, in the set's own order. A group with none is dropped. */
export function groupRoutes(routes: readonly PluginRoute[]): [RouteGroup, PluginRoute[]][] {
	return ROUTE_GROUPS.map((g): [RouteGroup, PluginRoute[]] => [g, routes.filter((r) => r.group === g)]).filter(
		([, group]) => group.length > 0,
	);
}

export function detailOf(status: PluginStatus): PluginDetail {
	const described = status as DescribedPluginStatus;
	const row = rowOf(status);
	const running = row.state === 'running';
	return {
		...row,
		version: text(described.version) || null,
		startedAt: running ? text(status.started_at) || null : null,
		routes: running ? routesOf(described) : [],
	};
}

/**
 * The row for one plugin. A report that does not carry the plugin says the
 * engine was built without it, and no report says nothing, so that is null.
 */
export function rowFor(report: PluginStatusReport | null | undefined, name: string): PluginRow | null {
	if (!report) return null;
	return rowOf(statusFor(report, name));
}

/** The detail for one plugin, read the way rowFor reads its row. */
export function detailFor(report: PluginStatusReport | null | undefined, name: string): PluginDetail | null {
	if (!report) return null;
	return detailOf(statusFor(report, name));
}

function statusFor(report: PluginStatusReport, name: string): PluginStatus {
	return (
		report.plugins?.find((p) => p.name === name) ?? {
			name,
			compiled: false,
			entitled: false,
			requested: false,
			active: false,
			phase: 'registered',
		}
	);
}

export interface PluginFilters {
	query: string;
	category: string;
	states: string[];
}

export function filterRows(rows: PluginRow[], f: PluginFilters): PluginRow[] {
	const q = f.query.trim().toLowerCase();
	return rows.filter((r) => {
		if (q && !`${r.label} ${r.name} ${r.description}`.toLowerCase().includes(q)) return false;
		if (f.category && r.category !== f.category) return false;
		if (f.states.length > 0 && !f.states.includes(r.state)) return false;
		return true;
	});
}

/**
 * Grouped for rendering, in the set's own order, so the page does not reorder
 * itself as rows are filtered out. A group with nothing left in it is dropped
 * rather than rendered empty.
 */
export function groupRows(rows: PluginRow[]): [CategoryKey, PluginRow[]][] {
	return CATEGORY_ORDER.map((c): [CategoryKey, PluginRow[]] => [c, rows.filter((r) => r.category === c)]).filter(
		([, group]) => group.length > 0,
	);
}

/** What the header counts: the plugins that run, out of the ones this build carries. */
export function runningCounts(rows: readonly PluginRow[]): { running: number; compiled: number } {
	const compiled = rows.filter((r) => r.state !== 'not-built');
	return { running: compiled.filter((r) => r.state === 'running').length, compiled: compiled.length };
}

export function failedCount(rows: readonly PluginRow[]): number {
	return rows.filter((r) => r.state === 'failed').length;
}
