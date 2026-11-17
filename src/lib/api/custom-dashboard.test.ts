import { describe, expect, it, vi } from 'vitest';
import type { HttpClient } from '@lyeve-labs/client';
import {
	WIDGET_KINDS,
	editableWidget,
	getDashboardLayout,
	newWidget,
	saveDashboardLayout,
	starterLayout,
	wireWidget,
	type Widget,
} from './custom-dashboard';
import { UNNAMED } from '#lib/plugins.ts';

describe('custom dashboard helpers', () => {
	it('offers every widget type the engine accepts, once', () => {
		expect(WIDGET_KINDS.map((k) => k.type)).toEqual([
			'entry_counts',
			'latest_entries',
			'status_breakdown',
			'recent_activity',
			'media_usage',
			'api_usage',
			'links',
			'text',
		]);
	});

	it('gives each new widget an id nobody else on the layout carries', () => {
		const taken: string[] = [];
		for (let i = 0; i < 50; i++) taken.push(newWidget('media_usage', taken, []).id);
		expect(new Set(taken).size).toBe(50);
		for (const id of taken) expect(id).toMatch(/^[a-z0-9][a-z0-9-]{0,39}$/);
	});

	it('fills every field a form binds, whatever the engine left out', () => {
		const w = editableWidget({ id: 'a', type: 'latest_entries' });
		expect(w).toMatchObject({ title: '', width: 'half', roles: [], schema: '', status: '', limit: 5, body: '', tone: '' });
	});

	it('sends only the fields a widget type reads', () => {
		const stale: Widget = {
			id: 'a',
			type: 'status_breakdown',
			title: '  Status ',
			width: 'third',
			roles: [],
			schema: 'posts',
			schemas: ['posts', 'authors'],
			limit: 9,
			body: 'left over from a text widget',
			links: [{ label: 'x', url: 'https://x.y' }],
		};
		expect(wireWidget(stale)).toEqual({ id: 'a', type: 'status_breakdown', width: 'third', title: 'Status', schema: 'posts' });
		expect(wireWidget({ id: 'b', type: 'links', links: [{ label: ' Docs ', url: ' https://d.e ', roles: [] }] })).toEqual({
			id: 'b',
			type: 'links',
			width: 'half',
			links: [{ label: 'Docs', url: 'https://d.e' }],
		});
	});

	it('starts from a layout close to the stock dashboard, without what does not run', () => {
		const all = starterLayout(['posts'], UNNAMED).map((w) => w.type);
		expect(all).toEqual(['entry_counts', 'status_breakdown', 'media_usage', 'api_usage', 'latest_entries', 'recent_activity']);
		const bare = starterLayout([], { state: 'named', running: ['content'], withheld: [] }).map((w) => w.type);
		expect(bare).toEqual(['status_breakdown', 'latest_entries']);
	});

	it('reads a stock dashboard from an engine that says nothing more', async () => {
		const get = vi.fn().mockResolvedValue({ entitled: true });
		expect(await getDashboardLayout({ get } as unknown as HttpClient)).toEqual({ entitled: true, custom: false, widgets: [], updated_at: null });
	});

	it('saves the layout as the engine takes it', async () => {
		const put = vi.fn().mockResolvedValue({});
		await saveDashboardLayout({ put } as unknown as HttpClient, [editableWidget({ id: 'm', type: 'media_usage', width: 'third' })]);
		expect(put).toHaveBeenCalledWith('/api/admin/customization/dashboard', { widgets: [{ id: 'm', type: 'media_usage', width: 'third' }] });
	});
});
