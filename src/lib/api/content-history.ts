/**
 * Content history and activity, as the content plugin serves them.
 *
 * History is the stored versions of each entry, kept per content type when
 * the tenant switches it on. Activity is the record of who changed which
 * entry, kept on its own switch. The server's environment can fix either
 * switch, and the plugin then names the fields it fixed and reads each one as
 * the value in effect. A write that carries a fixed field with another value
 * answers 409, so the console never sends them.
 *
 * An engine older than this feature answers 404 on every route here.
 */
import type { HttpClient } from '@lyeve-labs/client';
import { query, type ListEnvelope } from './list';
import { record, whole } from './narrow';

const HISTORY_SETTINGS_URL = '/api/admin/content/history/settings';
const HISTORY_USAGE_URL = '/api/admin/content/history/usage';
const HISTORY_PRUNE_URL = '/api/admin/content/history/prune';
const HISTORY_URL = '/api/admin/content/history';
const ACTIVITY_URL = '/api/admin/content/activity';
const ACTIVITY_ALL_URL = '/api/admin/content/activity/all';

/** The capability that reads versions older than the read window. */
export const HISTORY_READ_FEATURE = 'content-pro';
/** The window a reader without that capability sees, in days. */
export const READ_WINDOW_DAYS = 30;

/** The longest retention a field takes, in days: a century. */
export const MAX_KEEP_DAYS = 36500;
/** The most versions a field keeps per entry. */
export const MAX_KEEP_VERSIONS = 100000;

export const HISTORY_MODES = ['off', 'all', 'selected'] as const;
export type HistoryMode = (typeof HISTORY_MODES)[number];

/** What the environment says about a switch: the tenant decides, or it is fixed. */
export type EnvSwitch = 'console' | 'off' | 'on';

/** One tenant's choices. A zero `keep_*` means no limit. */
export interface HistorySettings {
	history_mode: HistoryMode;
	/** The type names that keep history when the mode is `selected`. */
	schemas: string[];
	keep_days: number;
	keep_versions: number;
	activity_enabled: boolean;
	activity_keep_days: number;
	updated_by?: string;
	updated_at?: string;
}

/** The settings fields a tenant writes, and the names the plugin locks them by. */
export const SETTING_FIELDS = [
	'history_mode',
	'schemas',
	'keep_days',
	'keep_versions',
	'activity_enabled',
	'activity_keep_days',
] as const;
export type SettingField = (typeof SETTING_FIELDS)[number];

/** The settings read: the tenant's choices, what the environment fixes, and its defaults. */
export interface HistorySettingsRead {
	settings: HistorySettings;
	/** The fields the environment fixes. A write carrying one answers 409. */
	locked: SettingField[];
	/** The two switches as the environment sets them. */
	env: { history: EnvSwitch; activity: EnvSwitch };
	/** The retention a tenant that has not chosen runs under. */
	defaults: { keep_days: number; keep_versions: number; activity_keep_days: number };
}

/** What history holds for the tenant. Bytes are what the database stores and what full copies would take. */
export interface HistoryUsage {
	commits: number;
	objects: number;
	stored_bytes: number;
	logical_bytes: number;
	legacy_rows: number;
	legacy_bytes: number;
	/** When the oldest version kept was written, null with none. */
	oldest_at: string | null;
}

/**
 * What one retention run removed. A run too large to finish in the request
 * answers 202 with `done` false and carries on in the background, so the
 * counts are what it removed so far.
 */
export interface PruneResult {
	commits: number;
	legacy_rows: number;
	activity_rows: number;
	done: boolean;
}

/** What deleting one type's history removed, and how many versions a legal hold kept. */
export interface DeleteResult {
	commits: number;
	held: number;
}

/** One row of activity. */
export interface ActivityRow {
	id: string;
	tenant_id?: string;
	schema_name: string;
	entry_id: string;
	/** The entry's title when the change was recorded, null when the plugin has none. */
	entry_title?: string | null;
	/** Whether the entry is still there to open. */
	entry_exists?: boolean;
	action: string;
	source: string;
	/** The names of the fields the change touched. */
	fields: string[] | null;
	actor_id: string;
	/** The account's email, null when the plugin cannot name it. */
	actor_email?: string | null;
	/**
	 * What made the change: a person, a person through an admin token, or an
	 * API key. Null on a row written before the field existed and absent from
	 * an older engine, and either is a person. A row with no actor id is the
	 * unknown one.
	 */
	actor_kind?: 'user' | 'admin_token' | 'api_key' | null;
	/** The version history recorded for the change, null when it recorded none. */
	revision_num?: number | null;
	created_at: string;
}

/** The filters the activity page keeps in its address, by the routes' query names. */
export const ACTIVITY_FILTERS = ['schema', 'entry_id', 'actor', 'action', 'source', 'from', 'to'] as const;
export type ActivityFilter = Record<(typeof ACTIVITY_FILTERS)[number], string>;

/**
 * The actions the content plugin records, with the words the console shows
 * for each. A hard delete is `deleted`. Rows written before it existed
 * record a delete as `archived`. A row may carry an action this list does
 * not know, and it shows as sent.
 */
export const ACTION_LABELS: Readonly<Record<string, string>> = {
	created: 'Created',
	updated: 'Updated',
	published: 'Published',
	unpublished: 'Unpublished',
	archived: 'Archived',
	deleted: 'Deleted',
	rollback: 'Restored',
	scheduled_publish: 'Scheduled publish',
	scheduled_unpublish: 'Scheduled unpublish',
};

export function actionLabel(action: string): string {
	return ACTION_LABELS[action] ?? action;
}

/** The actions the filter always offers. */
export const ACTIVITY_ACTIONS = [
	'created',
	'updated',
	'published',
	'unpublished',
	'archived',
	'deleted',
	'rollback',
	'scheduled_publish',
	'scheduled_unpublish',
] as const;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The filter in the page's address. A date that is not a day is dropped, and reversed dates are swapped. */
export function readActivityFilter(url: URL): ActivityFilter {
	const text = (key: string) => (url.searchParams.get(key) ?? '').trim();
	const day = (key: string) => (DAY.test(text(key)) ? text(key) : '');
	let from = day('from');
	let to = day('to');
	if (from && to && from > to) [from, to] = [to, from];
	return {
		schema: text('schema'),
		entry_id: text('entry_id'),
		actor: text('actor'),
		action: text('action'),
		source: text('source'),
		from,
		to,
	};
}

function envSwitch(value: unknown): EnvSwitch {
	return value === 'off' || value === 'on' ? value : 'console';
}

/** The settings read in the shape the page renders, with every absent field at its default. */
export function toSettingsRead(body: unknown): HistorySettingsRead {
	const top = record(body);
	const s = record(top.settings);
	const env = record(top.env);
	const defaults = record(top.defaults);
	const mode = HISTORY_MODES.find((m) => m === s.history_mode) ?? 'off';
	return {
		settings: {
			history_mode: mode,
			schemas: Array.isArray(s.schemas) ? s.schemas.filter((n): n is string => typeof n === 'string') : [],
			keep_days: whole(s.keep_days),
			keep_versions: whole(s.keep_versions),
			activity_enabled: s.activity_enabled !== false,
			activity_keep_days: whole(s.activity_keep_days),
			updated_by: typeof s.updated_by === 'string' ? s.updated_by : undefined,
			updated_at: typeof s.updated_at === 'string' ? s.updated_at : undefined,
		},
		locked: Array.isArray(top.locked)
			? SETTING_FIELDS.filter((f) => (top.locked as unknown[]).includes(f))
			: [],
		env: { history: envSwitch(env.history), activity: envSwitch(env.activity) },
		defaults: {
			keep_days: whole(defaults.keep_days),
			keep_versions: whole(defaults.keep_versions),
			activity_keep_days: whole(defaults.activity_keep_days),
		},
	};
}

export async function readHistorySettings(client: HttpClient): Promise<HistorySettingsRead> {
	return toSettingsRead(await client.get<unknown>(HISTORY_SETTINGS_URL));
}

/** Saves the fields given and only those. A field the environment fixes is never among them. */
export async function saveHistorySettings(
	client: HttpClient,
	changes: Partial<HistorySettings>,
): Promise<HistorySettingsRead> {
	return toSettingsRead(await client.put<unknown>(HISTORY_SETTINGS_URL, changes));
}

export async function readHistoryUsage(client: HttpClient): Promise<HistoryUsage> {
	const u = record(await client.get<unknown>(HISTORY_USAGE_URL));
	return {
		commits: whole(u.commits),
		objects: whole(u.objects),
		stored_bytes: whole(u.stored_bytes),
		logical_bytes: whole(u.logical_bytes),
		legacy_rows: whole(u.legacy_rows),
		legacy_bytes: whole(u.legacy_bytes),
		oldest_at: typeof u.oldest_at === 'string' && u.oldest_at ? u.oldest_at : null,
	};
}

export async function pruneHistory(client: HttpClient): Promise<PruneResult> {
	const r = record(await client.post<unknown>(HISTORY_PRUNE_URL, {}));
	return {
		commits: whole(r.commits),
		legacy_rows: whole(r.legacy_rows),
		activity_rows: whole(r.activity_rows),
		done: r.done !== false,
	};
}

export async function deleteTypeHistory(client: HttpClient, schema: string): Promise<DeleteResult> {
	const r = record(await client.delete<unknown>(`${HISTORY_URL}?schema=${encodeURIComponent(schema)}`));
	return { commits: whole(r.commits), held: whole(r.held) };
}

/**
 * One page of activity. `tenant` is set only for a super admin, and moves
 * the read to the cross-tenant route, which takes it as `tenant_id`. An empty
 * value means every tenant.
 */
export function listActivity(
	client: HttpClient,
	filter: ActivityFilter,
	limit: number,
	offset: number,
	tenant?: string,
): Promise<ListEnvelope<ActivityRow> | ActivityRow[]> {
	// The page picks days. The route takes times, and `to` keeps the chosen
	// day whole by asking for everything before the next one.
	let to: string | undefined;
	if (filter.to) {
		const next = new Date(`${filter.to}T00:00:00Z`);
		next.setUTCDate(next.getUTCDate() + 1);
		to = `${next.toISOString().slice(0, 10)}T00:00:00Z`;
	}
	const params = query({
		schema: filter.schema,
		entry_id: filter.entry_id,
		actor: filter.actor,
		action: filter.action,
		source: filter.source,
		from: filter.from ? `${filter.from}T00:00:00Z` : undefined,
		to,
		tenant_id: tenant,
		limit,
		offset,
	});
	const base = tenant === undefined ? ACTIVITY_URL : ACTIVITY_ALL_URL;
	return client.get<ListEnvelope<ActivityRow> | ActivityRow[]>(`${base}${params}`);
}

/** Whether the license reads versions older than the read window for this tenant. */
export function readsOlderVersions(ent: { features?: string[]; withheld?: string[] } | null | undefined): boolean {
	return (ent?.features ?? []).includes(HISTORY_READ_FEATURE) && !(ent?.withheld ?? []).includes(HISTORY_READ_FEATURE);
}
