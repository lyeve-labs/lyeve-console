import type { HttpClient } from '@lyeve-labs/client';
import { getSummary, getTrend } from '@lyeve-labs/client-rest';
import { rowsOf, statedTotal, type ListEnvelope } from '$lib/api/list';
import { visibleTo } from '$lib/api/customization';
import { mediaKind, type MediaItem, type MediaKind } from '$lib/api/media';
import {
	widgetKind,
	widgetServed,
	type ApiUsage,
	type MediaUsage,
	type ResolvedWidget,
	type SchemaCount,
	type Widget,
	type WidgetAudit,
	type WidgetEntry,
	type WidgetWindow,
} from '$lib/api/custom-dashboard';
import { WINDOWS } from '$lib/dashboard';
import { UNTITLED } from '$lib/utils/new-entry';
import { hoursOf } from '$lib/server/dashboard';
import { PLUGIN, type PluginName } from '$lib/plugin-names';
import { runs, type PluginSet } from '$lib/plugins';

/** How many days an entry count's trend covers. */
export const TREND_DAYS = 14;
/** The most entries read to draw one schema's trend. */
const TREND_SAMPLE = 200;
/** The most library files read to size the media library. */
const MEDIA_SAMPLE = 500;

/** The day an ISO time falls on, in UTC, as YYYY-MM-DD. */
function dayOf(iso: string): string {
	return iso.slice(0, 10);
}

/**
 * Buckets entries by the UTC day of their latest change, oldest first. The
 * list comes newest first, so when a full sample stops inside the window the
 * days before its oldest entry are unknown, and the result says so.
 */
export function trendOf(rows: { updated_at: string }[], now: Date, full: boolean): { days: number[]; partial: boolean } {
	const days: string[] = [];
	for (let i = TREND_DAYS - 1; i >= 0; i--) {
		const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
		days.push(d.toISOString().slice(0, 10));
	}
	const counts = new Map(days.map((d) => [d, 0]));
	let oldest = '';
	for (const r of rows) {
		if (!r.updated_at) continue;
		const d = dayOf(r.updated_at);
		if (!oldest || d < oldest) oldest = d;
		if (counts.has(d)) counts.set(d, (counts.get(d) ?? 0) + 1);
	}
	return { days: days.map((d) => counts.get(d) ?? 0), partial: full && oldest > days[0] };
}

/**
 * Reads what each widget shows, with the viewer's own session, so a widget
 * never shows an entry the viewer could not open elsewhere. Widgets the
 * viewer's roles do not see are dropped here too, so an admin's dashboard
 * matches what the layout says an admin sees.
 *
 * Reads are shared within one call: two widgets over the same list make one
 * request.
 */
export async function resolveWidgets(
	client: HttpClient,
	widgets: Widget[],
	roles: readonly string[],
	plugins: PluginSet,
	now: Date = new Date(),
): Promise<ResolvedWidget[]> {
	const memo = new Map<string, Promise<unknown>>();
	const read = <T>(url: string): Promise<T | null> => {
		if (!memo.has(url)) memo.set(url, client.get<T>(url).catch(() => null));
		return memo.get(url) as Promise<T | null>;
	};
	const serves = (plugin: PluginName) => runs(plugins, plugin);

	const contentList = (params: Record<string, string>) =>
		read<ListEnvelope<Partial<WidgetEntry>> | Partial<WidgetEntry>[]>(`/api/admin/content?${new URLSearchParams(params)}`);
	const countOf = async (status: string, schema: string) =>
		statedTotal(await contentList({ ...(schema ? { schema } : {}), status, limit: '1', offset: '0' }));

	const resolveOne = async (w: Widget): Promise<ResolvedWidget> => {
		const kind = widgetKind(w.type);
		const out: ResolvedWidget = { ...w, heading: w.title?.trim() || kind.fallbackTitle };
		if (!widgetServed(kind, plugins)) return { ...out, unavailable: true };
		switch (w.type) {
			case 'entry_counts': {
				out.counts = await Promise.all(
					(w.schemas ?? []).map(async (schema): Promise<SchemaCount> => {
						const [stats, recent] = await Promise.all([
							read<{ rows?: number }>(`/api/admin/schemas/${encodeURIComponent(schema)}/stats`),
							serves(PLUGIN.content) ? contentList({ schema, limit: String(TREND_SAMPLE), offset: '0' }) : Promise.resolve(null),
						]);
						const rows = recent === null ? null : rowsOf(recent);
						const trend = rows === null ? null : trendOf(rows as { updated_at: string }[], now, rows.length >= TREND_SAMPLE);
						return {
							schema,
							rows: typeof stats?.rows === 'number' ? stats.rows : null,
							days: trend?.days ?? null,
							partial: trend?.partial ?? false,
						};
					}),
				);
				return out;
			}
			case 'latest_entries': {
				const params: Record<string, string> = { limit: String(w.limit ?? 5), offset: '0' };
				if (w.schema) params.schema = w.schema;
				if (w.status) params.status = w.status;
				const res = await contentList(params);
				out.entries =
					res === null
						? null
						: rowsOf(res).map((r) => ({
								id: String(r.id ?? ''),
								schema: r.schema ?? w.schema ?? '',
								title: r.title || UNTITLED,
								status: r.status ?? '',
								updated_at: r.updated_at ?? '',
							}));
				return out;
			}
			case 'status_breakdown': {
				const schema = w.schema ?? '';
				const [published, draft, archived] = await Promise.all([
					countOf('published', schema),
					countOf('draft', schema),
					countOf('archived', schema),
				]);
				out.statuses = published === null || draft === null || archived === null ? null : { published, draft, archived };
				return out;
			}
			case 'recent_activity': {
				const res = await read<ListEnvelope<WidgetAudit> | WidgetAudit[]>(`/api/admin/audit-log?limit=${w.limit ?? 5}&offset=0`);
				out.audit = res === null ? null : rowsOf(res).slice(0, w.limit ?? 5);
				return out;
			}
			case 'media_usage': {
				const res = await read<ListEnvelope<MediaItem> | MediaItem[]>(`/api/admin/media?limit=${MEDIA_SAMPLE}&offset=0`);
				if (res === null) {
					out.media = null;
					return out;
				}
				const items = rowsOf(res);
				const kinds = new Map<MediaKind, number>();
				for (const m of items) kinds.set(mediaKind(m.content_type), (kinds.get(mediaKind(m.content_type)) ?? 0) + 1);
				out.media = {
					files: statedTotal(res) ?? items.length,
					bytes: items.reduce((n, m) => n + (m.size || 0), 0),
					sampled: items.length,
					kinds: [...kinds.entries()].map(([kind, count]) => ({ kind, count })).sort((a, b) => b.count - a.count),
				};
				return out;
			}
			case 'api_usage': {
				const window: WidgetWindow = w.window || '24h';
				const since = new Date(now);
				since.setUTCMinutes(0, 0, 0);
				since.setUTCHours(since.getUTCHours() - WINDOWS[window]);
				const from = since.toISOString();
				const [summary, trend] = await Promise.all([
					getSummary({ from }, client).catch(() => null),
					getTrend({ from }, client).catch(() => null),
				]);
				out.window = window;
				out.api =
					summary === null
						? null
						: {
								total: summary.total_requests,
								errorRate: summary.error_rate,
								p95: summary.avg_latency_p95_ms,
								hours: trend ? hoursOf(trend.points, since, now) : [],
							};
				return out;
			}
			case 'links':
				return { ...out, links: (w.links ?? []).filter((l) => visibleTo(l.roles, roles)) };
			default:
				return out;
		}
	};

	return Promise.all(widgets.filter((w) => visibleTo(w.roles, roles)).map(resolveOne));
}
