// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const goto = vi.fn();
vi.mock('$app/navigation', () => ({ goto: (href: string) => goto(href) }));

import RateLimitTabs from './RateLimitTabs.svelte';

afterEach(() => {
	cleanup();
	goto.mockClear();
});

const labels = (container: HTMLElement) => [...container.querySelectorAll('[role="tab"]')].map((t) => t.textContent?.trim());

/*
 * An admin opens the limits and the live counters too, so the strip names all
 * four pages whoever reads it, and the page on screen is always one of them.
 */
describe('RateLimitTabs', () => {
	it.each(['limits', 'live', 'tenant', 'refusals'] as const)('names all four pages on %s', (active) => {
		const { container } = render(RateLimitTabs, { props: { active } });
		expect(labels(container)).toEqual(['Limits', 'Right now', 'Tenant controls', 'Refusal history']);
		expect(container.querySelector('[aria-selected="true"]')).not.toBeNull();
	});

	it('marks the page that is on screen', () => {
		const { getByRole } = render(RateLimitTabs, { props: { active: 'refusals' } });
		expect(getByRole('tab', { name: 'Refusal history' }).getAttribute('aria-selected')).toBe('true');
		expect(getByRole('tab', { name: 'Limits' }).getAttribute('aria-selected')).toBe('false');
	});

	it.each([
		['Limits', '/admin/settings/rate-limits'],
		['Right now', '/admin/settings/rate-limits/live'],
		['Tenant controls', '/admin/settings/rate-limits/tenant'],
		['Refusal history', '/admin/settings/rate-limits/tenant/refusals'],
	])('navigates to %s rather than swapping a panel', async (name, href) => {
		const active = name === 'Limits' ? 'live' : 'limits';
		const { getByRole } = render(RateLimitTabs, { props: { active } });
		getByRole('tab', { name }).click();
		await Promise.resolve();
		expect(goto).toHaveBeenCalledWith(href);
	});
});
