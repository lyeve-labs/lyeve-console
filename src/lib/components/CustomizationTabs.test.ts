// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const goto = vi.fn();
vi.mock('$app/navigation', () => ({ goto: (href: string) => goto(href) }));

import CustomizationTabs from './CustomizationTabs.svelte';

afterEach(() => {
	cleanup();
	goto.mockClear();
});

// Every tab is open to the same roles, an admin or a super admin, so the
// strip has one list of tabs for everyone who can see it.
describe('CustomizationTabs', () => {
	it('names the four features in order', () => {
		const { getAllByRole } = render(CustomizationTabs, { props: { active: 'brand' } });
		expect(getAllByRole('tab').map((t) => t.textContent?.trim())).toEqual(['Brand', 'Menu', 'Dashboard', 'Pages']);
	});

	it('marks the feature that is on screen', () => {
		const { getByRole } = render(CustomizationTabs, { props: { active: 'dashboard' } });
		expect(getByRole('tab', { name: 'Dashboard' }).getAttribute('aria-selected')).toBe('true');
		expect(getByRole('tab', { name: 'Brand' }).getAttribute('aria-selected')).toBe('false');
	});

	it.each([
		['Brand', '/admin/settings/customization'],
		['Menu', '/admin/settings/customization/menu'],
		['Dashboard', '/admin/settings/customization/dashboard'],
		['Pages', '/admin/settings/customization/pages'],
	])('navigates to the %s route rather than swapping a panel', async (name, href) => {
		const { getByRole } = render(CustomizationTabs, { props: { active: name === 'Brand' ? 'pages' : 'brand' } });
		getByRole('tab', { name }).click();
		await Promise.resolve();
		expect(goto).toHaveBeenCalledWith(href);
	});
});
