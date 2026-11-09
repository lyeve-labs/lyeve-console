// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const goto = vi.fn();
vi.mock('$app/navigation', () => ({ goto: (href: string) => goto(href) }));

import ProfilerTabs from './ProfilerTabs.svelte';

afterEach(() => {
	cleanup();
	goto.mockClear();
});

describe('ProfilerTabs', () => {
	it('names the three profiler pages', () => {
		const { getAllByRole } = render(ProfilerTabs, { props: { active: 'timings' } });
		expect(getAllByRole('tab').map((t) => t.textContent?.trim())).toEqual(['Timings', 'Memory', 'Profiles']);
	});

	it('marks the page that is on screen', () => {
		const { getByRole } = render(ProfilerTabs, { props: { active: 'capture' } });
		expect(getByRole('tab', { name: 'Profiles' }).getAttribute('aria-selected')).toBe('true');
		expect(getByRole('tab', { name: 'Timings' }).getAttribute('aria-selected')).toBe('false');
	});

	it.each([
		['Timings', '/admin/observability/profiler'],
		['Memory', '/admin/observability/profiler/memory'],
		['Profiles', '/admin/observability/profiler/capture'],
	])('navigates to the %s page rather than swapping a panel', async (label, href) => {
		const { getByRole } = render(ProfilerTabs, { props: { active: 'timings' } });
		getByRole('tab', { name: label }).click();
		await Promise.resolve();
		expect(goto).toHaveBeenCalledWith(href);
	});
});
