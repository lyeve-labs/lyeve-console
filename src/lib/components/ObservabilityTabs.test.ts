// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const goto = vi.fn();
vi.mock('$app/navigation', () => ({ goto: (href: string) => goto(href) }));

import ObservabilityTabs from './ObservabilityTabs.svelte';

afterEach(() => {
	cleanup();
	goto.mockClear();
});

describe('ObservabilityTabs', () => {
	it('names the overview and its two tools', () => {
		const { getAllByRole } = render(ObservabilityTabs, { props: { active: 'overview' } });
		expect(getAllByRole('tab').map((t) => t.textContent?.trim())).toEqual([
			'Overview',
			'Goroutine engine',
			'Live log tail',
		]);
	});

	it('marks the route that is on screen', () => {
		const { getByRole } = render(ObservabilityTabs, { props: { active: 'goroutines' } });
		expect(getByRole('tab', { name: 'Goroutine engine' }).getAttribute('aria-selected')).toBe('true');
		expect(getByRole('tab', { name: 'Overview' }).getAttribute('aria-selected')).toBe('false');
	});

	it.each([
		['Overview', '/admin/observability'],
		['Goroutine engine', '/admin/observability/goroutines'],
		['Live log tail', '/admin/observability/log-tail'],
	])('navigates to the %s route rather than swapping a panel', async (label, href) => {
		const { getByRole } = render(ObservabilityTabs, { props: { active: 'log-tail' } });
		getByRole('tab', { name: label }).click();
		await Promise.resolve();
		expect(goto).toHaveBeenCalledWith(href);
	});
});
