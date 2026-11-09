// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const goto = vi.fn();
vi.mock('$app/navigation', () => ({ goto: (href: string) => goto(href) }));

import ApiLabsTabs from './ApiLabsTabs.svelte';

afterEach(() => {
	cleanup();
	goto.mockClear();
});

const labels = (tabs: HTMLElement[]) => tabs.map((t) => t.textContent?.trim());

/*
 * Each lab is its own route, so a lab can be linked and reloaded. The labels
 * are the ones the segmented control carried before, which the docs quote.
 */
describe('ApiLabsTabs', () => {
	it('names every lab for a super admin', () => {
		const { getAllByRole } = render(ApiLabsTabs, { props: { active: 'rest', superAdmin: true } });
		expect(labels(getAllByRole('tab'))).toEqual(['REST', 'GraphQL', 'gRPC', 'Streams']);
	});

	// The gRPC lab refuses every role below super admin, so a tab that only
	// opens a refusal is left off.
	it('hides the gRPC lab from a role below super admin', () => {
		const { getAllByRole } = render(ApiLabsTabs, { props: { active: 'rest', superAdmin: false } });
		expect(labels(getAllByRole('tab'))).toEqual(['REST', 'GraphQL', 'Streams']);
	});

	it('marks the lab that is on screen', () => {
		const { getByRole } = render(ApiLabsTabs, { props: { active: 'streams', superAdmin: true } });
		expect(getByRole('tab', { name: 'Streams' }).getAttribute('aria-selected')).toBe('true');
		expect(getByRole('tab', { name: 'REST' }).getAttribute('aria-selected')).toBe('false');
	});

	it.each([
		['REST', 'streams', '/admin/api-labs'],
		['GraphQL', 'rest', '/admin/api-labs/graphql'],
		['gRPC', 'rest', '/admin/api-labs/grpc'],
		['Streams', 'rest', '/admin/api-labs/streams'],
	] as const)('navigates to the %s lab rather than swapping a panel', async (label, active, href) => {
		const { getByRole } = render(ApiLabsTabs, { props: { active, superAdmin: true } });
		getByRole('tab', { name: label }).click();
		await Promise.resolve();
		expect(goto).toHaveBeenCalledWith(href);
	});
});
