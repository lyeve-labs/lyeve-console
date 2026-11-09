// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const goto = vi.fn();
vi.mock('$app/navigation', () => ({ goto: (href: string) => goto(href) }));

import SearchTabs from './SearchTabs.svelte';

afterEach(() => {
	cleanup();
	goto.mockClear();
});

// A query reloads only the results, so the settings are routes of their own
// behind one strip.
describe('SearchTabs', () => {
	it('names the three pages', () => {
		const { getByRole } = render(SearchTabs, { props: { active: 'search' } });
		for (const name of ['Search', 'Synonyms', 'Settings']) {
			expect(getByRole('tab', { name })).toBeTruthy();
		}
	});

	it('marks the page that is on screen', () => {
		const { getByRole } = render(SearchTabs, { props: { active: 'synonyms' } });
		expect(getByRole('tab', { name: 'Synonyms' }).getAttribute('aria-selected')).toBe('true');
		expect(getByRole('tab', { name: 'Search' }).getAttribute('aria-selected')).toBe('false');
	});

	it.each([
		['Search', '/admin/search', 'settings'],
		['Synonyms', '/admin/search/synonyms', 'search'],
		['Settings', '/admin/search/settings', 'search'],
	] as const)('navigates to %s', async (name, href, active) => {
		const { getByRole } = render(SearchTabs, { props: { active } });
		getByRole('tab', { name }).click();
		await Promise.resolve();
		expect(goto).toHaveBeenCalledWith(href);
	});
});
