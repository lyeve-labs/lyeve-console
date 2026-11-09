// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

const goto = vi.fn();
vi.mock('$app/navigation', () => ({ goto: (href: string) => goto(href) }));

import TelemetryTabs from './TelemetryTabs.svelte';

afterEach(() => {
	cleanup();
	goto.mockClear();
});

describe('TelemetryTabs', () => {
	it('names both telemetry pages', () => {
		const { getAllByRole } = render(TelemetryTabs, { props: { active: 'metrics' } });
		expect(getAllByRole('tab').map((t) => t.textContent?.trim())).toEqual(['Metrics', 'Export']);
	});

	it('marks the page that is on screen', () => {
		const { getByRole } = render(TelemetryTabs, { props: { active: 'export' } });
		expect(getByRole('tab', { name: 'Export' }).getAttribute('aria-selected')).toBe('true');
		expect(getByRole('tab', { name: 'Metrics' }).getAttribute('aria-selected')).toBe('false');
	});

	it.each([
		['Metrics', '/admin/observability/telemetry'],
		['Export', '/admin/observability/telemetry/export'],
	])('navigates to the %s page rather than swapping a panel', async (label, href) => {
		const { getByRole } = render(TelemetryTabs, { props: { active: 'metrics' } });
		getByRole('tab', { name: label }).click();
		await Promise.resolve();
		expect(goto).toHaveBeenCalledWith(href);
	});
});
