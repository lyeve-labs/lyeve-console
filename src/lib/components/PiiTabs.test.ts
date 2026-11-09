// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const goto = vi.fn();
vi.mock('$app/navigation', () => ({ goto: (href: string) => goto(href) }));

import PiiTabs from './PiiTabs.svelte';

afterEach(() => {
	cleanup();
	goto.mockClear();
});

describe('PiiTabs', () => {
	it('names both pages', () => {
		const { getByRole } = render(PiiTabs, { props: { active: 'rules' } });
		expect(getByRole('tab', { name: 'Rules' })).toBeTruthy();
		expect(getByRole('tab', { name: 'Unmasked reads' })).toBeTruthy();
	});

	it('marks the page that is on screen', () => {
		const { getByRole } = render(PiiTabs, { props: { active: 'reads' } });
		expect(getByRole('tab', { name: 'Unmasked reads' }).getAttribute('aria-selected')).toBe('true');
		expect(getByRole('tab', { name: 'Rules' }).getAttribute('aria-selected')).toBe('false');
	});

	it.each([
		['Unmasked reads', '/admin/settings/pii/reads', 'rules'],
		['Rules', '/admin/settings/pii', 'reads'],
	] as const)('opens %s at its own address', async (label, href, active) => {
		const { getByRole } = render(PiiTabs, { props: { active } });
		getByRole('tab', { name: label }).click();
		await Promise.resolve();
		expect(goto).toHaveBeenCalledWith(href);
	});
});
