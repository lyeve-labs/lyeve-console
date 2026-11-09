// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const goto = vi.fn();
vi.mock('$app/navigation', () => ({ goto: (href: string) => goto(href) }));

import CacheTabs from './CacheTabs.svelte';

afterEach(() => {
	cleanup();
	goto.mockClear();
});

// Provider health, the response cache rules and the stored entries are one
// plugin, so they are three routes behind one strip.
describe('CacheTabs', () => {
	it('names the three pages', () => {
		const { getByRole } = render(CacheTabs, { props: { active: 'overview' } as never });
		expect(getByRole('tab', { name: /Overview/ })).toBeTruthy();
		expect(getByRole('tab', { name: /Response cache rules/ })).toBeTruthy();
		expect(getByRole('tab', { name: /Stored/ })).toBeTruthy();
	});

	it('marks the page that is on screen', () => {
		const { getByRole } = render(CacheTabs, { props: { active: 'stored' } as never });
		expect(getByRole('tab', { name: /Stored/ }).getAttribute('aria-selected')).toBe('true');
		expect(getByRole('tab', { name: /Overview/ }).getAttribute('aria-selected')).toBe('false');
	});

	it.each([
		['rules', /Response cache rules/, '/admin/observability/cache/rules'],
		['stored', /Stored/, '/admin/observability/cache/stored'],
	])('navigates to the %s page rather than swapping a panel', async (_id, name, href) => {
		const { getByRole } = render(CacheTabs, { props: { active: 'overview' } as never });
		getByRole('tab', { name }).click();
		await Promise.resolve();
		expect(goto).toHaveBeenCalledWith(href);
	});

	it('navigates back to the overview', async () => {
		const { getByRole } = render(CacheTabs, { props: { active: 'rules' } as never });
		getByRole('tab', { name: /Overview/ }).click();
		await Promise.resolve();
		expect(goto).toHaveBeenCalledWith('/admin/observability/cache');
	});

	// A count the page has not read is left off rather than drawn as zero.
	it('draws no count when the page passed none', () => {
		const { getByRole } = render(CacheTabs, { props: { active: 'overview' } as never });
		expect(getByRole('tab', { name: /Stored/ }).textContent).not.toMatch(/\d/);
	});

	it('draws the count the page did pass', () => {
		const { getByRole } = render(CacheTabs, { props: { active: 'rules', rules: 7 } as never });
		expect(getByRole('tab', { name: /Response cache rules/ }).textContent).toContain('7');
	});
});
