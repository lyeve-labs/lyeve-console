// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const goto = vi.fn();
vi.mock('$app/navigation', () => ({ goto: (href: string) => goto(href) }));

import GraphqlTabs from './GraphqlTabs.svelte';

afterEach(() => {
	cleanup();
	goto.mockClear();
});

/*
 * The schema and the persisted-query allowlist are two routes behind one
 * strip, so each keeps its own load and its own form actions.
 */
describe('GraphqlTabs', () => {
	it('names both halves', () => {
		const { getAllByRole } = render(GraphqlTabs, { props: { active: 'schema' } });
		expect(getAllByRole('tab').map((t) => t.textContent?.trim())).toEqual(['Schema', 'Persisted queries']);
	});

	it('marks the half that is on screen', () => {
		const { getByRole } = render(GraphqlTabs, { props: { active: 'persisted' } });
		expect(getByRole('tab', { name: /Persisted queries/ }).getAttribute('aria-selected')).toBe('true');
		expect(getByRole('tab', { name: /Schema/ }).getAttribute('aria-selected')).toBe('false');
	});

	it.each([
		['Schema', 'persisted', '/admin/settings/graphql'],
		['Persisted queries', 'schema', '/admin/settings/graphql/persisted'],
	] as const)('navigates to the %s route rather than swapping a panel', async (label, active, href) => {
		const { getByRole } = render(GraphqlTabs, { props: { active } });
		getByRole('tab', { name: new RegExp(label) }).click();
		await Promise.resolve();
		expect(goto).toHaveBeenCalledWith(href);
	});
});
