// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const goto = vi.fn();
vi.mock('$app/navigation', () => ({ goto: (href: string) => goto(href) }));

import ReviewTabs from './ReviewTabs.svelte';

afterEach(() => {
	cleanup();
	goto.mockClear();
});

// The queue is every reviewer's and the definitions are an administrator's,
// so the strip draws only for a reader who may open both.
describe('ReviewTabs', () => {
	it('names both pages for an administrator', () => {
		const { getByRole } = render(ReviewTabs, { props: { active: 'assignments', operator: true } });
		expect(getByRole('tab', { name: 'Assignments' })).toBeTruthy();
		expect(getByRole('tab', { name: 'Definitions' })).toBeTruthy();
	});

	it('marks the page that is on screen', () => {
		const { getByRole } = render(ReviewTabs, { props: { active: 'definitions', operator: true } });
		expect(getByRole('tab', { name: 'Definitions' }).getAttribute('aria-selected')).toBe('true');
		expect(getByRole('tab', { name: 'Assignments' }).getAttribute('aria-selected')).toBe('false');
	});

	it.each([
		['Assignments', '/admin/reviews', 'definitions'],
		['Definitions', '/admin/reviews/definitions', 'assignments'],
	] as const)('navigates to %s', async (name, href, active) => {
		const { getByRole } = render(ReviewTabs, { props: { active, operator: true } });
		getByRole('tab', { name }).click();
		await Promise.resolve();
		expect(goto).toHaveBeenCalledWith(href);
	});

	it('draws no strip for a reviewer who may open only the assignments', () => {
		const { queryByRole } = render(ReviewTabs, { props: { active: 'assignments', operator: false } });
		expect(queryByRole('tablist')).toBeNull();
		expect(queryByRole('tab', { name: 'Definitions' })).toBeNull();
	});
});
