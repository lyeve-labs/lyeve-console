// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';

import DashboardWidgets from './DashboardWidgets.svelte';
import type { ResolvedWidget } from '$lib/api/custom-dashboard';

afterEach(cleanup);

const now = new Date('2026-10-14T09:00:00Z');
const draw = (widgets: ResolvedWidget[]) => render(DashboardWidgets, { props: { widgets, now } });

/** The text of the one widget whose heading is `heading`. */
function widget(heading: string): string {
	const el = screen.getByText(heading).closest('[data-widget]') as HTMLElement;
	return el.textContent ?? '';
}

describe('DashboardWidgets', () => {
	it('says each failed read could not be read, never zero or none', () => {
		draw([
			{ id: 'a', type: 'latest_entries', heading: 'Latest', entries: null },
			{ id: 'b', type: 'status_breakdown', heading: 'Statuses', statuses: null },
			{ id: 'c', type: 'recent_activity', heading: 'Activity', audit: null },
			{ id: 'd', type: 'media_usage', heading: 'Media', media: null },
			{ id: 'e', type: 'api_usage', heading: 'API', api: null },
		]);
		expect(widget('Latest')).toContain('Could not load these entries.');
		expect(widget('Statuses')).toContain('Could not load the counts.');
		expect(widget('Activity')).toContain('Could not load the audit log.');
		expect(widget('Media')).toContain('Could not load the media library.');
		expect(widget('API')).toContain('Could not load API usage.');
	});

	it('tells an empty read apart from a failed one', () => {
		draw([
			{ id: 'a', type: 'latest_entries', heading: 'Latest', entries: [] },
			{ id: 'c', type: 'recent_activity', heading: 'Activity', audit: [] },
			{ id: 'l', type: 'links', heading: 'Links', links: [] },
		]);
		expect(widget('Latest')).toContain('No entries yet.');
		expect(widget('Activity')).toContain('No activity yet.');
		expect(widget('Links')).toContain('No links for your role.');
	});

	it('says a widget this engine cannot serve is not served', () => {
		draw([{ id: 'a', type: 'api_usage', heading: 'API', unavailable: true, api: null }]);
		expect(widget('API')).toContain('This widget needs a plugin that is not running on this engine.');
		expect(widget('API')).not.toContain('Could not load');
	});

	it('links each count to its schema and says how much changed', () => {
		draw([
			{
				id: 'a',
				type: 'entry_counts',
				heading: 'Entries',
				counts: [
					{ schema: 'posts', rows: 1200, days: [1, 2, 3], partial: true },
					{ schema: 'orders', rows: null, days: null, partial: false },
				],
			},
		]);
		expect(screen.getByRole('link', { name: /posts/ }).getAttribute('href')).toBe('/admin/content/posts');
		expect(widget('Entries')).toContain('1,200');
		expect(widget('Entries')).toContain('6 changed in 14 days, from the latest 200');
		expect(widget('Entries')).toContain('unknown');
	});

	it('lists the latest entries, each linked to its editor', () => {
		draw([{ id: 'a', type: 'latest_entries', heading: 'Latest', entries: [{ id: 'e1', schema: 'posts', title: 'Hello', status: 'draft', updated_at: '2026-10-01T00:00:00Z' }] }]);
		expect(screen.getByRole('link', { name: 'Hello' }).getAttribute('href')).toBe('/admin/content/posts/e1');
		expect(widget('Latest')).toContain('draft');
	});

	it('reports API traffic with its failure share and p95', () => {
		draw([{ id: 'a', type: 'api_usage', heading: 'API', window: '24h', api: { total: 5000, errorRate: 0.0123, p95: 181.6, hours: [] } }]);
		expect(widget('API')).toContain('5,000');
		expect(widget('API')).toContain('1.2%');
		expect(widget('API')).toContain('182 ms');
		expect(widget('API')).toContain('No requests per hour in the last');
	});

	it('renders a text widget as Markdown elements and never as HTML', () => {
		const { container } = draw([{ id: 't', type: 'text', heading: 'Note', body: 'Ship **today**. <script>alert(1)</script>' }]);
		expect(screen.getByText('today').tagName).toBe('STRONG');
		expect(container.querySelector('script')).toBeNull();
	});

	it('opens an outside link in a new tab and keeps an admin link in place', () => {
		draw([
			{
				id: 'l',
				type: 'links',
				heading: 'Links',
				links: [
					{ label: 'Status page', url: 'https://status.example.com' },
					{ label: 'Media', url: '/admin/media' },
				],
			},
		]);
		expect(screen.getByRole('link', { name: /Status page/ }).getAttribute('target')).toBe('_blank');
		expect(screen.getByRole('link', { name: 'Media' }).getAttribute('target')).toBeNull();
	});
});
