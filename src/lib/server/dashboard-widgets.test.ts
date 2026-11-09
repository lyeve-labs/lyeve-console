import { describe, expect, it, vi } from 'vitest';
import type { HttpClient } from '@lyeve-labs/client';
import type { Widget } from '$lib/api/custom-dashboard';
import { TREND_DAYS, resolveWidgets, trendOf } from './dashboard-widgets';
import { UNNAMED } from '$lib/plugins';

const NOW = new Date('2026-09-26T12:00:00Z');

/** A client that answers by path prefix. Anything unmapped is refused. */
function client(answers: Record<string, unknown>) {
	const get = vi.fn(async (url: string) => {
		const hit = Object.keys(answers)
			.sort((a, b) => b.length - a.length)
			.find((k) => url.startsWith(k));
		if (hit === undefined) throw new Error(`refused ${url}`);
		return answers[hit];
	});
	return { get, c: { get } as unknown as HttpClient };
}

describe('trendOf', () => {
	it('buckets by the day of the latest change, oldest first', () => {
		const rows = [
			{ updated_at: '2026-09-26T09:00:00Z' },
			{ updated_at: '2026-09-26T01:00:00Z' },
			{ updated_at: '2026-09-25T23:59:00Z' },
			{ updated_at: '2026-09-01T00:00:00Z' },
		];
		const { days, partial } = trendOf(rows, NOW, false);
		expect(days).toHaveLength(TREND_DAYS);
		expect(days[TREND_DAYS - 1]).toBe(2);
		expect(days[TREND_DAYS - 2]).toBe(1);
		expect(days.reduce((a, b) => a + b, 0)).toBe(3);
		expect(partial).toBe(false);
	});

	it('says the early days undercount when a full sample stops inside the window', () => {
		const rows = Array.from({ length: 5 }, () => ({ updated_at: '2026-09-25T10:00:00Z' }));
		expect(trendOf(rows, NOW, true).partial).toBe(true);
		expect(trendOf(rows, NOW, false).partial).toBe(false);
	});
});

describe('resolveWidgets', () => {
	it('drops the widgets and links the viewer does not see', async () => {
		const { c } = client({});
		const widgets: Widget[] = [
			{ id: 'a', type: 'text', body: 'all' },
			{ id: 'b', type: 'text', body: 'admins', roles: ['admin'] },
			{ id: 'c', type: 'links', links: [{ label: 'x', url: 'https://x.y' }, { label: 'y', url: '/admin/y', roles: ['admin'] }] },
		];
		const asEditor = await resolveWidgets(c, widgets, ['editor'], UNNAMED, NOW);
		expect(asEditor.map((w) => w.id)).toEqual(['a', 'c']);
		expect(asEditor[1].links?.map((l) => l.label)).toEqual(['x']);
		expect((await resolveWidgets(c, widgets, ['super_admin'], UNNAMED, NOW)).map((w) => w.id)).toEqual(['a', 'b', 'c']);
	});

	it('counts each schema and draws its trend, reading each list once', async () => {
		const { c, get } = client({
			'/api/admin/schemas/posts/stats': { rows: 12 },
			'/api/admin/schemas/authors/stats': { rows: 3 },
			'/api/admin/content?schema=posts': { data: [{ id: '1', updated_at: '2026-09-26T08:00:00Z' }], total_count: 1 },
			'/api/admin/content?schema=authors': { data: [], total_count: 0 },
		});
		const widgets: Widget[] = [
			{ id: 'a', type: 'entry_counts', schemas: ['posts', 'authors'] },
			{ id: 'b', type: 'entry_counts', schemas: ['posts'] },
		];
		const [a] = await resolveWidgets(c, widgets, ['admin'], UNNAMED, NOW);
		expect(a.heading).toBe('Entries');
		expect(a.counts?.map((x) => [x.schema, x.rows, x.days?.at(-1)])).toEqual([
			['posts', 12, 1],
			['authors', 3, 0],
		]);
		const statsReads = get.mock.calls.filter(([u]) => u === '/api/admin/schemas/posts/stats');
		expect(statsReads).toHaveLength(1);
	});

	it('says a read failed rather than showing zero', async () => {
		const { c } = client({});
		const widgets: Widget[] = [
			{ id: 'a', type: 'latest_entries', limit: 5 },
			{ id: 'b', type: 'status_breakdown' },
			{ id: 'c', type: 'recent_activity', limit: 5 },
			{ id: 'd', type: 'media_usage' },
			{ id: 'e', type: 'entry_counts', schemas: ['posts'] },
		];
		const [a, b, cc, d, e] = await resolveWidgets(c, widgets, ['admin'], UNNAMED, NOW);
		expect(a.entries).toBeNull();
		expect(b.statuses).toBeNull();
		expect(cc.audit).toBeNull();
		expect(d.media).toBeNull();
		expect(e.counts?.[0]).toMatchObject({ rows: null, days: null });
	});

	it('marks a widget whose plugin this engine does not serve, and reads nothing for it', async () => {
		const { c, get } = client({});
		const [w] = await resolveWidgets(c, [{ id: 'api', type: 'api_usage', window: '24h' }], ['admin'], { state: 'named', running: ['content', 'media'], withheld: [] }, NOW);
		expect(w.unavailable).toBe(true);
		expect(get).not.toHaveBeenCalled();
	});

	it('sizes the media library from its first page and names the kinds', async () => {
		const { c } = client({
			'/api/admin/media': {
				data: [
					{ id: '1', content_type: 'image/png', size: 1000 },
					{ id: '2', content_type: 'image/jpeg', size: 500 },
					{ id: '3', content_type: 'application/pdf', size: 2000 },
				],
				total_count: 900,
			},
		});
		const [w] = await resolveWidgets(c, [{ id: 'm', type: 'media_usage' }], ['admin'], UNNAMED, NOW);
		expect(w.media).toEqual({ files: 900, bytes: 3500, sampled: 3, kinds: [{ kind: 'image', count: 2 }, { kind: 'pdf', count: 1 }] });
	});

	it('breaks entries down by status, in one schema or all', async () => {
		const { c, get } = client({
			'/api/admin/content?schema=posts&status=published': { data: [], total_count: 4 },
			'/api/admin/content?schema=posts&status=draft': { data: [], total_count: 2 },
			'/api/admin/content?schema=posts&status=archived': { data: [], total_count: 1 },
		});
		const [w] = await resolveWidgets(c, [{ id: 's', type: 'status_breakdown', schema: 'posts' }], ['admin'], UNNAMED, NOW);
		expect(w.statuses).toEqual({ published: 4, draft: 2, archived: 1 });
		expect(get).toHaveBeenCalledTimes(3);
	});
});
