/**
 * The dashboard a tenant composes, in beta: an ordered list of widgets drawn
 * from data the admin already reads, each at a third, half or full row and
 * each limited to roles. No layout means the stock dashboard.
 *
 * Every signed-in user reads it, filtered to their roles. An admin reads the
 * whole layout to edit it. Writing and resetting are an admin's.
 */
import type { HttpClient } from '@lyeve-labs/client';
import type { StatusTone } from '@lyeve-labs/ui-kit';
import type { CustomLink } from '$lib/api/customization';
import type { MediaKind } from '$lib/api/media';
import { PLUGIN, type PluginName } from '$lib/plugin-names';
import { runs, type PluginSet } from '$lib/plugins';

export type WidgetType =
	| 'entry_counts'
	| 'latest_entries'
	| 'status_breakdown'
	| 'recent_activity'
	| 'media_usage'
	| 'api_usage'
	| 'links'
	| 'text';

export type WidgetWidth = 'third' | 'half' | 'full';
export type WidgetWindow = '6h' | '24h' | '7d';
/** A text widget's Alert tone. The empty string draws the text with no Alert. */
export type WidgetTone = '' | StatusTone;
export type WidgetStatus = '' | 'draft' | 'published' | 'archived';

export interface Widget {
	id: string;
	type: WidgetType;
	title?: string;
	width?: WidgetWidth;
	roles?: string[];
	schema?: string;
	schemas?: string[];
	status?: WidgetStatus;
	limit?: number;
	window?: WidgetWindow;
	body?: string;
	tone?: WidgetTone;
	links?: CustomLink[];
}

export interface DashboardLayout {
	entitled: boolean;
	/** Whether the tenant replaced the stock dashboard. */
	custom: boolean;
	widgets: Widget[];
	updated_at: string | null;
}

/** The most widgets one dashboard holds. The engine refuses more. */
export const MAX_WIDGETS = 24;
export const MAX_WIDGET_ROWS = 20;

export interface WidgetKind {
	type: WidgetType;
	label: string;
	/** What it shows, as the editor offers it. */
	description: string;
	/** The plugin its data needs, or null when it needs none. */
	plugin: PluginName | null;
	/** The title it draws when none is set. */
	fallbackTitle: string;
	/**
	 * Whether its data comes from routes only an admin may read. A viewer or
	 * an editor given such a widget sees it say it could not be read, so a
	 * new one is limited to admins until someone decides otherwise.
	 */
	adminData: boolean;
}

/**
 * Every widget, in the order the editor offers them. The plugin is what the
 * read behind the widget needs: a widget whose plugin does not run is not
 * offered, and a saved one whose plugin has stopped says so where it would
 * draw.
 */
export const WIDGET_KINDS: readonly WidgetKind[] = [
	{ type: 'entry_counts', label: 'Entry counts', description: 'How many entries each content type has, and how many changed each day over the last two weeks.', plugin: null, fallbackTitle: 'Entries', adminData: false },
	{ type: 'latest_entries', label: 'Latest entries', description: 'The entries changed most recently, in one content type or in all of them.', plugin: PLUGIN.content, fallbackTitle: 'Latest entries', adminData: true },
	{ type: 'status_breakdown', label: 'Status breakdown', description: 'How many entries are published, draft and archived.', plugin: PLUGIN.content, fallbackTitle: 'Entries by status', adminData: true },
	{ type: 'recent_activity', label: 'Recent activity', description: 'The latest entries in the audit log: who changed what.', plugin: PLUGIN.audit, fallbackTitle: 'Recent activity', adminData: true },
	{ type: 'media_usage', label: 'Media usage', description: 'How many files the media library has, how much space they take, and of what kind.', plugin: PLUGIN.media, fallbackTitle: 'Media library', adminData: true },
	{ type: 'api_usage', label: 'API usage', description: 'Requests, failures and latency over a window, with requests per hour.', plugin: PLUGIN.analytics, fallbackTitle: 'API usage', adminData: true },
	{ type: 'links', label: 'Links', description: "A list of links: your team's own tools, or pages of the console.", plugin: null, fallbackTitle: 'Links', adminData: false },
	{ type: 'text', label: 'Text', description: 'A note in Markdown, plain or as a callout.', plugin: null, fallbackTitle: '', adminData: false },
];

/** Whether a widget's data can be read: it needs no plugin, or its plugin runs. */
export function widgetServed(kind: WidgetKind, plugins: PluginSet): boolean {
	return kind.plugin === null || runs(plugins, kind.plugin);
}

export function widgetKind(type: WidgetType): WidgetKind {
	return WIDGET_KINDS.find((k) => k.type === type) ?? WIDGET_KINDS[0];
}

/** How many of the six grid columns a widget spans on a wide screen. */
export const WIDTH_SPAN: Record<WidgetWidth, string> = {
	third: 'lg:col-span-2',
	half: 'lg:col-span-3',
	full: 'lg:col-span-6',
};

export const WIDTH_LABEL: Record<WidgetWidth, string> = { third: 'A third', half: 'Half', full: 'Full width' };

/** A widget id nobody else on the layout carries. */
export function newWidgetId(taken: readonly string[]): string {
	for (;;) {
		const id = `w-${Math.random().toString(36).slice(2, 10)}`;
		if (!taken.includes(id)) return id;
	}
}

/** A new widget of a type, filled with what its form binds. */
export function newWidget(type: WidgetType, taken: readonly string[], schemas: readonly string[]): Widget {
	const id = newWidgetId(taken);
	const base = { id, type, title: '', roles: widgetKind(type).adminData ? ['admin'] : [] };
	switch (type) {
		case 'entry_counts':
			return { ...base, width: 'full', schemas: schemas.slice(0, 4) };
		case 'latest_entries':
			return { ...base, width: 'half', schema: '', status: '', limit: 5 };
		case 'status_breakdown':
			return { ...base, width: 'third', schema: '' };
		case 'recent_activity':
			return { ...base, width: 'half', limit: 5 };
		case 'media_usage':
			return { ...base, width: 'third' };
		case 'api_usage':
			return { ...base, width: 'full', window: '24h' };
		case 'links':
			return { ...base, width: 'third', links: [{ label: '', url: 'https://' }] };
		case 'text':
			return { ...base, width: 'full', body: '', tone: '' };
	}
}

/**
 * A widget with every field its form binds, filled. The engine leaves an
 * empty field out of what it stores, and the kit's inputs refuse to bind to
 * undefined.
 */
export function editableWidget(w: Widget): Widget {
	return {
		...w,
		title: w.title ?? '',
		width: w.width || 'half',
		roles: [...(w.roles ?? [])],
		schema: w.schema ?? '',
		schemas: [...(w.schemas ?? [])],
		status: w.status ?? '',
		limit: w.limit ?? 5,
		window: w.window || '24h',
		body: w.body ?? '',
		tone: w.tone ?? '',
		links: (w.links ?? []).map((l) => ({ label: l.label ?? '', url: l.url ?? '', roles: [...(l.roles ?? [])] })),
	};
}

/**
 * What goes to the engine: only the fields the widget's type reads, so a
 * form that kept a schema list around after the type changed sends nothing
 * the engine would validate against the wrong type.
 */
export function wireWidget(w: Widget): Widget {
	const out: Widget = { id: w.id, type: w.type, width: w.width || 'half' };
	if (w.title?.trim()) out.title = w.title.trim();
	if (w.roles?.length) out.roles = [...w.roles];
	switch (w.type) {
		case 'entry_counts':
			out.schemas = [...(w.schemas ?? [])];
			break;
		case 'latest_entries':
			if (w.schema) out.schema = w.schema;
			if (w.status) out.status = w.status;
			out.limit = Number(w.limit) || 5;
			break;
		case 'status_breakdown':
			if (w.schema) out.schema = w.schema;
			break;
		case 'recent_activity':
			out.limit = Number(w.limit) || 5;
			break;
		case 'api_usage':
			out.window = w.window || '24h';
			break;
		case 'links':
			out.links = (w.links ?? []).map((l) => ({
				label: l.label.trim(),
				url: l.url.trim(),
				...(l.roles?.length ? { roles: [...l.roles] } : {}),
			}));
			break;
		case 'text':
			out.body = w.body ?? '';
			if (w.tone) out.tone = w.tone;
			break;
	}
	return out;
}

/**
 * The layout the editor offers as a start: roughly what the stock dashboard
 * shows, as widgets, so a tenant edits from something familiar rather than
 * from nothing.
 */
export function starterLayout(schemas: readonly string[], plugins: PluginSet): Widget[] {
	const taken: string[] = [];
	const out: Widget[] = [];
	const add = (type: WidgetType, patch: Partial<Widget> = {}) => {
		if (!widgetServed(widgetKind(type), plugins)) return;
		const w = { ...newWidget(type, taken, schemas), ...patch };
		taken.push(w.id);
		out.push(w);
	};
	if (schemas.length > 0) add('entry_counts');
	add('status_breakdown');
	add('media_usage');
	add('api_usage', { width: 'third', roles: ['admin'] });
	add('latest_entries');
	add('recent_activity');
	return out;
}

export async function getDashboardLayout(client: HttpClient): Promise<DashboardLayout> {
	const res = await client.get<Partial<DashboardLayout>>('/api/admin/customization/dashboard');
	return {
		entitled: !!res.entitled,
		custom: !!res.custom,
		widgets: res.widgets ?? [],
		updated_at: res.updated_at ?? null,
	};
}

export function saveDashboardLayout(client: HttpClient, widgets: Widget[]): Promise<DashboardLayout> {
	return client.put<DashboardLayout>('/api/admin/customization/dashboard', { widgets: widgets.map(wireWidget) });
}

export function resetDashboardLayout(client: HttpClient): Promise<unknown> {
	return client.delete('/api/admin/customization/dashboard');
}

export interface WidgetEntry {
	id: string;
	schema: string;
	title: string;
	status: string;
	updated_at: string;
}

export interface WidgetAudit {
	id: string;
	action: string;
	resource_type: string;
	resource_id: string;
	created_at: string;
}

export interface SchemaCount {
	schema: string;
	rows: number | null;
	/** Entries whose latest change fell on each of the last days, oldest first. */
	days: number[] | null;
	/** True when the sample ran out before the window did, so early days undercount. */
	partial: boolean;
}

export interface MediaUsage {
	files: number;
	/** Bytes held by the files read, which is every file unless `sampled` is below `files`. */
	bytes: number;
	sampled: number;
	kinds: { kind: MediaKind; count: number }[];
}

export interface ApiUsage {
	total: number;
	errorRate: number;
	p95: number;
	hours: { hour: string; requests: number; errorRate: number }[];
}

/**
 * A widget with what it shows already read. `null` in a data field means the
 * read failed or was refused: it draws as "could not be read", never as zero.
 * `unavailable` means this instance does not serve the plugin behind it.
 */
export interface ResolvedWidget extends Widget {
	heading: string;
	unavailable?: boolean;
	counts?: SchemaCount[];
	entries?: WidgetEntry[] | null;
	statuses?: { published: number; draft: number; archived: number } | null;
	audit?: WidgetAudit[] | null;
	media?: MediaUsage | null;
	api?: ApiUsage | null;
}
