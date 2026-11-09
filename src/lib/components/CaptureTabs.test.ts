// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const goto = vi.fn();
vi.mock('$app/navigation', () => ({ goto: (href: string) => goto(href) }));

import CaptureTabs from './CaptureTabs.svelte';

afterEach(() => {
	cleanup();
	goto.mockClear();
});

// The captures, their rules and the replay sets are one plugin, so they are
// three routes behind one strip. Each keeps its own load and form actions.
describe('CaptureTabs', () => {
	it('names the three pages', () => {
		const { getByRole } = render(CaptureTabs, { props: { active: 'captures' } as never });
		expect(getByRole('tab', { name: /^Captures/ })).toBeTruthy();
		expect(getByRole('tab', { name: /Capture rules/ })).toBeTruthy();
		expect(getByRole('tab', { name: /Replay sets/ })).toBeTruthy();
	});

	it('marks the page that is on screen', () => {
		const { getByRole } = render(CaptureTabs, { props: { active: 'rules' } as never });
		expect(getByRole('tab', { name: /Capture rules/ }).getAttribute('aria-selected')).toBe('true');
		expect(getByRole('tab', { name: /^Captures/ }).getAttribute('aria-selected')).toBe('false');
	});

	it.each([
		['sets', /Replay sets/, '/admin/observability/captures/sets'],
		['rules', /Capture rules/, '/admin/observability/captures/rules'],
	])('navigates to the %s page rather than swapping a panel', async (_id, name, href) => {
		const { getByRole } = render(CaptureTabs, { props: { active: 'captures' } as never });
		getByRole('tab', { name }).click();
		await Promise.resolve();
		expect(goto).toHaveBeenCalledWith(href);
	});

	it('navigates back to the captures', async () => {
		const { getByRole } = render(CaptureTabs, { props: { active: 'sets' } as never });
		getByRole('tab', { name: /^Captures/ }).click();
		await Promise.resolve();
		expect(goto).toHaveBeenCalledWith('/admin/observability/captures');
	});

	// A count the page has not read is left off rather than drawn as zero.
	it('draws no count when the page passed none', () => {
		const { getByRole } = render(CaptureTabs, { props: { active: 'captures' } as never });
		expect(getByRole('tab', { name: /Capture rules/ }).textContent).not.toMatch(/\d/);
	});

	it('draws the count the page did pass', () => {
		const { getByRole } = render(CaptureTabs, { props: { active: 'captures', captures: 412 } as never });
		expect(getByRole('tab', { name: /^Captures/ }).textContent).toContain('412');
	});
});
