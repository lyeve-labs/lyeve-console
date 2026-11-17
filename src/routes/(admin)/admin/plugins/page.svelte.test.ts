// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import type { PluginStatus } from '@lyeve-labs/client-rest';
import type { DescribedPluginStatus, PluginManifest } from '#lib/plugin-rows.ts';

import PluginsPage from './+page.svelte';

afterEach(cleanup);

function status(
	name: string,
	over: Partial<PluginStatus> = {},
	manifest?: PluginManifest,
): DescribedPluginStatus {
	return {
		name,
		compiled: true,
		entitled: true,
		requested: true,
		active: true,
		phase: 'running',
		...over,
		...(manifest ? { manifest } : {}),
	};
}

const PLUGINS: DescribedPluginStatus[] = [
	status('search', {}, { label: 'Search', description: 'Ranked full-text search.', category: 'content', maturity: 'stable' }),
	status('webhook', {}, { label: 'Webhooks', category: 'automation', maturity: 'beta' }),
	status(
		'example',
		{ entitled: false, active: false, phase: 'registered', reason: 'not enabled here', upgrade_url: '/admin/settings/license' },
		{ label: 'Example', category: 'insight' },
	),
	status(
		'cron',
		{ phase: 'failed', active: false, last_error: 'migration 12 already applied' },
		{ label: 'Cron', category: 'automation' },
	),
	status('media', { requested: false, active: false, phase: 'registered', reason: 'not requested' }, { label: 'Media', category: 'content' }),
	status('extra', {}),
];

function renderPage(plugins: DescribedPluginStatus[] = PLUGINS, gate: unknown = { state: 'ok' }) {
	return render(PluginsPage, { props: { data: { plugins, gate } } as never });
}

function row(container: HTMLElement, name: string): HTMLElement {
	const el = container.querySelector<HTMLElement>(`[data-testid="plugin-row"][data-plugin="${name}"]`);
	if (!el) throw new Error(`no row for ${name}`);
	return el;
}

describe('plugins page', () => {
	it('counts the plugins that run out of the ones this build carries', () => {
		renderPage();
		expect(screen.getByText('3 of 6 plugins running')).toBeTruthy();
	});

	it('labels each row with the state the engine reports', () => {
		const { container } = renderPage();
		expect(row(container, 'search').dataset.state).toBe('running');
		expect(row(container, 'search').textContent).toContain('Running');
		expect(row(container, 'example').textContent).toContain('Not enabled');
		expect(row(container, 'cron').textContent).toContain('Failed');
		expect(row(container, 'media').textContent).toContain('Not started');
	});

	it('says why a plugin does not run, when the engine said', () => {
		const { container } = renderPage();
		expect(row(container, 'cron').textContent).toContain('migration 12 already applied');
		expect(row(container, 'media').textContent).toContain('not requested');
		expect(row(container, 'example').textContent).toContain('not enabled here');
	});

	it('shows how a plugin describes itself, and marks the beta ones', () => {
		const { container } = renderPage();
		expect(row(container, 'search').textContent).toContain('Search');
		expect(row(container, 'search').textContent).toContain('Ranked full-text search.');
		expect(row(container, 'search').textContent).not.toContain('Beta');
		expect(row(container, 'webhook').textContent).toContain('Beta');
	});

	it('lists a plugin that sends no manifest by its name, under Other', () => {
		const { container } = renderPage();
		expect(row(container, 'extra').textContent).toContain('extra');
		const headings = [...container.querySelectorAll('h2')].map((h) => h.textContent?.trim());
		expect(headings).toEqual(['Content', 'Automation', 'Insight', 'Other']);
	});

	it('offers the way to turn a plugin on only on a row that is not enabled', () => {
		const { container } = renderPage();
		const link = row(container, 'example').querySelector('a[href="/admin/settings/license"]');
		expect(link?.textContent).toContain('How to enable it');
		expect(row(container, 'search').textContent).not.toContain('How to enable it');
	});

	// The link is 16px tall. Under a finger its hit area grows to 44px, and the
	// row pads its foot so that area ends inside its own row.
	it('gives the enable link a touch hit area that stays inside its row', () => {
		const { container } = renderPage();
		const link = row(container, 'example').querySelector('a[href="/admin/settings/license"]') as HTMLElement;
		expect(link.className).toContain('relative');
		expect(link.className).toContain('hit-area');
		expect((link.parentElement as HTMLElement).className).toContain('coarse:pb-3.5');
	});

	it('links every row to its plugin', () => {
		const { container } = renderPage();
		for (const p of PLUGINS) {
			expect(row(container, p.name).querySelector(`a[href="/admin/plugins/${p.name}"]`)).toBeTruthy();
		}
	});

	it('names the failures and filters to them on request', async () => {
		const { container } = renderPage();
		expect(screen.getByText('One plugin failed to start')).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Show them' }));
		await tick();
		const shown = [...container.querySelectorAll<HTMLElement>('[data-testid="plugin-row"]')].map((r) => r.dataset.plugin);
		expect(shown).toEqual(['cron']);
	});

	it('says so when the engine carries no plugins', () => {
		const { container } = renderPage([]);
		expect(screen.getByText('This build has no plugins.')).toBeTruthy();
		expect(screen.getByText('No plugins in this build')).toBeTruthy();
		expect(container.querySelector('[data-testid="plugin-row"]')).toBeNull();
		expect(screen.queryByRole('searchbox')).toBeNull();
	});

	it('words a row that is not enabled with its name, the engine\'s reason, the state and the link alone', () => {
		const { container } = renderPage();
		const words = [...row(container, 'example').querySelectorAll('p, span, a')]
			.filter((el) => el.children.length === 0)
			.map((el) => el.textContent?.replace(/\s+/g, ' ').trim())
			.filter(Boolean);
		expect(words).toEqual(['Example', 'not enabled here', 'Not enabled', 'How to enable it']);
	});
});

const base = { plan: 'example', state: 'active', features: [], tenant_quota: 0 };

// A role query over the whole page is slow.
// A selector finds the one link directly.
function mountWithEntitlements(entitlements: Record<string, unknown> | null) {
	const { container } = render(PluginsPage, { props: { data: { plugins: [], gate: { state: 'ok' }, entitlements } } as never });
	return {
		licenseLink: container.querySelector<HTMLAnchorElement>('[data-testid="page-actions"] a[href="/admin/settings/license"]'),
		actions: container.querySelector('[data-testid="page-actions"]'),
	};
}

describe('plugins page license link', () => {
	it('leads to the license page on a build that links a license module', () => {
		const { licenseLink } = mountWithEntitlements({ ...base, license_module: true });
		expect(licenseLink?.textContent).toContain('Manage license');
	});

	it.each([
		['a build without one', { ...base, license_module: false }],
		['an engine that does not say', base],
		['entitlements nobody could read', null],
	])('offers no way to a license page on %s', (_, entitlements) => {
		const { licenseLink, actions } = mountWithEntitlements(entitlements);
		expect(licenseLink).toBeNull();
		expect(actions).toBeNull();
	});
});
