// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const goto = vi.fn();
vi.mock('$app/navigation', () => ({ goto: (href: string) => goto(href) }));

import CostTabs from './CostTabs.svelte';

afterEach(() => {
	cleanup();
	goto.mockClear();
});

describe('CostTabs', () => {
	it('names the three pages', () => {
		const { container } = render(CostTabs, { props: { active: 'month' } });
		expect([...container.querySelectorAll('[role="tab"]')].map((t) => t.textContent?.trim())).toEqual([
			'This month',
			'Budgets',
			'Prices',
		]);
	});

	it('marks the page that is on screen', () => {
		const { getByRole } = render(CostTabs, { props: { active: 'budgets' } });
		expect(getByRole('tab', { name: 'Budgets' }).getAttribute('aria-selected')).toBe('true');
		expect(getByRole('tab', { name: 'This month' }).getAttribute('aria-selected')).toBe('false');
	});

	it.each([
		['This month', '/admin/tenants/costs'],
		['Budgets', '/admin/tenants/costs/budgets'],
		['Prices', '/admin/tenants/costs/prices'],
	])('navigates to %s rather than swapping a panel', async (name, href) => {
		const active = name === 'Prices' ? 'month' : 'prices';
		const { getByRole } = render(CostTabs, { props: { active } });
		getByRole('tab', { name }).click();
		await Promise.resolve();
		expect(goto).toHaveBeenCalledWith(href);
	});
});
