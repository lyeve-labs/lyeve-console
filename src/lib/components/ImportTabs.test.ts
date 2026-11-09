// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const goto = vi.fn();
vi.mock('$app/navigation', () => ({ goto: (href: string) => goto(href) }));

import ImportTabs from './ImportTabs.svelte';

afterEach(() => {
	cleanup();
	goto.mockClear();
});

// The mapping templates are their own list with their own drawer, so they
// are a route beside the history behind one strip.
describe('ImportTabs', () => {
	it('names both pages', () => {
		const { getByRole } = render(ImportTabs, { props: { active: 'history' } });
		expect(getByRole('tab', { name: 'History' })).toBeTruthy();
		expect(getByRole('tab', { name: 'Mapping templates' })).toBeTruthy();
	});

	it('marks the page that is on screen', () => {
		const { getByRole } = render(ImportTabs, { props: { active: 'templates' } });
		expect(getByRole('tab', { name: 'Mapping templates' }).getAttribute('aria-selected')).toBe('true');
		expect(getByRole('tab', { name: 'History' }).getAttribute('aria-selected')).toBe('false');
	});

	it.each([
		['History', '/admin/imports', 'templates'],
		['Mapping templates', '/admin/imports/templates', 'history'],
	] as const)('navigates to %s', async (name, href, active) => {
		const { getByRole } = render(ImportTabs, { props: { active } });
		getByRole('tab', { name }).click();
		await Promise.resolve();
		expect(goto).toHaveBeenCalledWith(href);
	});
});
