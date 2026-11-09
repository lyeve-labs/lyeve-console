// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import NotRunning from './NotRunning.svelte';
import type { NotRunningReason } from '$lib/plugins';

afterEach(cleanup);

function mount(reason: NotRunningReason, operator = true) {
	return render(NotRunning, { props: { title: 'Search', plugin: 'search', reason, operator } });
}

function said(c: HTMLElement): string {
	return (c.textContent ?? '').replace(/\s+/g, ' ').trim();
}

describe('NotRunning', () => {
	it('marks every case with one test id, and tells them apart by state', () => {
		const { getByTestId } = mount({ state: 'not-built' });
		const box = getByTestId('not-running');
		expect(box.dataset.state).toBe('not-built');
		expect(box.dataset.plugin).toBe('search');
	});

	it('says a withheld page was withheld from this tenant, to every reader', () => {
		const { container, getByTestId } = mount({ state: 'withheld' }, false);
		expect(getByTestId('not-running').dataset.state).toBe('withheld');
		expect(said(container)).toContain('Turned off for this tenant');
		expect(said(container)).toContain('Search is turned off for this tenant');
	});

	it('shows the error of a plugin that failed to start, with the way to its details', () => {
		const { container, getByRole } = mount({ state: 'failed', error: 'index missing' });
		expect(said(container)).toContain('Stopped at startup');
		expect(said(container)).toContain('index missing');
		expect(getByRole('link', { name: 'Plugin details' }).getAttribute('href')).toBe('/admin/plugins/search');
	});

	it('draws a plugin that is not enabled as the not-enabled state, with the link the engine named', () => {
		const { getByTestId, getByRole } = mount({ state: 'not-enabled', upgradeUrl: 'https://example.test/enable' });
		expect(getByTestId('not-enabled')).toBeTruthy();
		expect(getByRole('link', { name: 'How to enable it' }).getAttribute('href')).toBe('https://example.test/enable');
	});

	it('passes the heading level it is given to every state, the not-enabled one included', () => {
		const failed = render(NotRunning, {
			props: { title: 'Search', plugin: 'search', reason: { state: 'failed', error: 'boom' }, level: 2 },
		});
		expect(failed.getByRole('heading', { name: 'Stopped at startup', level: 2 })).toBeTruthy();
		cleanup();
		const locked = render(NotRunning, {
			props: { title: 'Search', plugin: 'search', reason: { state: 'not-enabled', upgradeUrl: '' }, level: 2 },
		});
		expect(locked.getByRole('heading', { name: 'Search', level: 2 })).toBeTruthy();
	});

	it('shows no link when the engine named none, or an unsafe one, and no license module serves one', () => {
		const bare = mount({ state: 'not-enabled', upgradeUrl: '' });
		expect(bare.getByTestId('not-enabled')).toBeTruthy();
		expect(bare.queryByRole('link')).toBeNull();
		cleanup();
		const unsafe = mount({ state: 'not-enabled', upgradeUrl: 'javascript:alert(1)' });
		expect(unsafe.queryByRole('link')).toBeNull();
	});

	it('gives the engine\'s reason for a plugin it did not start', () => {
		const { container } = mount({ state: 'not-started', reason: 'granted but not requested via LYEVE_PLUGINS' });
		expect(said(container)).toContain('Not started');
		expect(said(container)).toContain('Reason: granted but not requested via LYEVE_PLUGINS.');
	});

	it('says a plugin is not part of this build, with nothing to click', () => {
		const { container, queryByRole } = mount({ state: 'not-built' });
		expect(said(container)).toContain('Not part of this build');
		expect(queryByRole('link')).toBeNull();
	});

	it('tells a reader without the status report who can say why, and offers no details', () => {
		const { container, queryByRole } = mount({ state: 'unexplained' }, false);
		expect(said(container)).toContain('Ask an administrator why.');
		expect(queryByRole('link')).toBeNull();
	});

	it('points an operator whose report says nothing at the plugin details', () => {
		const { getByRole } = mount({ state: 'unexplained' });
		expect(getByRole('link', { name: 'Plugin details' }).getAttribute('href')).toBe('/admin/plugins/search');
	});

	it('says only its own words when the engine and no license module sent any', () => {
		const reasons: NotRunningReason[] = [
			{ state: 'withheld' },
			{ state: 'failed', error: '' },
			{ state: 'not-enabled', upgradeUrl: '' },
			{ state: 'not-started', reason: '' },
			{ state: 'not-built' },
			{ state: 'unexplained' },
		];
		const text: Record<string, string> = {};
		for (const reason of reasons) {
			const { container } = mount(reason);
			text[reason.state] = said(container);
			cleanup();
		}
		expect(text).toMatchInlineSnapshot(`
			{
			  "failed": "Stopped at startup The search plugin stopped with an error at startup. Plugin details",
			  "not-built": "Not part of this build The search plugin is not included in this build.",
			  "not-enabled": "Search Not enabled on this engine.",
			  "not-started": "Not started The search plugin is included in this build but did not start. Plugin details",
			  "unexplained": "Not running The plugin behind this page is not running. Plugin details",
			  "withheld": "Turned off for this tenant Search is turned off for this tenant. Ask a super admin to turn it back on.",
			}
		`);
	});
});
