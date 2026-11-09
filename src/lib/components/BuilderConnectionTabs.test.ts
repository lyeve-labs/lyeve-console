// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const goto = vi.fn();
vi.mock('$app/navigation', () => ({ goto: (href: string) => goto(href) }));

import BuilderConnectionTabs from './BuilderConnectionTabs.svelte';

afterEach(() => {
	cleanup();
	goto.mockClear();
});

describe('BuilderConnectionTabs', () => {
	it('names both pages for an owner', () => {
		const { getByRole } = render(BuilderConnectionTabs, { props: { active: 'connections', owner: true } });
		expect(getByRole('tab', { name: 'Connections' })).toBeTruthy();
		expect(getByRole('tab', { name: 'Builder settings' })).toBeTruthy();
	});

	it('marks the page that is on screen', () => {
		const { getByRole } = render(BuilderConnectionTabs, { props: { active: 'builder', owner: true } });
		expect(getByRole('tab', { name: 'Builder settings' }).getAttribute('aria-selected')).toBe('true');
		expect(getByRole('tab', { name: 'Connections' }).getAttribute('aria-selected')).toBe('false');
	});

	it.each([
		['Builder settings', '/admin/settings/connected-editors/builder', 'connections'],
		['Connections', '/admin/settings/connected-editors', 'builder'],
	] as const)('opens %s at its own address', async (label, href, active) => {
		const { getByRole } = render(BuilderConnectionTabs, { props: { active, owner: true } });
		getByRole('tab', { name: label }).click();
		await Promise.resolve();
		expect(goto).toHaveBeenCalledWith(href);
	});

	// The settings page refuses a person below owner, so a strip would offer a
	// page that only answers with a refusal, beside one tab of nothing to switch.
	it('draws no strip for a person below owner', () => {
		const { queryByRole } = render(BuilderConnectionTabs, { props: { active: 'connections', owner: false } });
		expect(queryByRole('tablist')).toBeNull();
		expect(queryByRole('tab')).toBeNull();
	});
});
