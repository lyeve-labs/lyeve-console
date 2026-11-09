// @vitest-environment jsdom
import { render, cleanup, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import RefusalsPage from './+page.svelte';

afterEach(cleanup);

function said(c: HTMLElement): string {
	return (c.textContent ?? '').replace(/\s+/g, ' ');
}

const props = (over: Record<string, unknown> = {}) => ({
	data: {
		gate: { state: 'ok' },
		hours: 24,
		addresses: {
			ok: true,
			value: {
				licensed: true,
				limits: { entries: { limit: 500, current: 1 } },
				rules: [{ id: 'd1', cidr: '203.0.113.0/24', list: 'deny', note: '', created_at: '2026-10-01T00:00:00Z' }],
			},
		},
		history: {
			ok: true,
			value: {
				hours: 24,
				total_refused: 7,
				minutes: [
					{ minute: '2026-10-06T10:00:00Z', rule_id: 'd1', kind: 'deny', endpoint: 'GET /api/v1/content', refused: 4 },
					{ minute: '2026-10-06T10:01:00Z', rule_id: 'd1', kind: 'deny', endpoint: 'GET /api/v1/content', refused: 3 },
				],
			},
		},
		...over,
	} as never,
});

describe('refusal history', () => {
	it('carries the strip with this tab marked', () => {
		render(RefusalsPage, { props: props() });
		expect(screen.getByRole('tab', { name: 'Refusal history' }).getAttribute('aria-selected')).toBe('true');
		expect(screen.getByRole('tab', { name: 'Limits' })).toBeTruthy();
	});

	it('sums the refusal minutes per entry, named by the range it denied', () => {
		const { container } = render(RefusalsPage, { props: props() });
		const table = screen.getByRole('region', { name: 'Refusals by rule' });
		expect(table.textContent).toContain('Deny list');
		expect(table.textContent).toContain('203.0.113.0/24');
		expect(table.textContent).toContain('7');
		expect(said(container)).toContain('7 requests refused');
	});

	it('shows the route when the address lists could not be read', () => {
		render(RefusalsPage, { props: props({ addresses: { ok: false, gate: { state: 'unavailable' } } }) });
		expect(screen.getByRole('region', { name: 'Refusals by rule' }).textContent).toContain('GET /api/v1/content');
	});

	it('shows a locked history as not enabled', () => {
		const { container } = render(RefusalsPage, {
			props: props({ history: { ok: false, gate: { state: 'locked', upgradeUrl: '' } } }),
		});
		expect(said(container)).toContain('Not enabled on this engine');
		expect(said(container)).not.toContain('requests refused');
	});

	it('says no request was refused in an empty window', () => {
		render(RefusalsPage, { props: props({ history: { ok: true, value: { hours: 24, total_refused: 0, minutes: [] } } }) });
		expect(screen.getByText('No refused requests')).toBeTruthy();
	});
});

describe('the history window', () => {
	it('marks the window the address named on the first render, as links', () => {
		render(RefusalsPage, { props: props({ hours: 168 }) });
		const group = screen.getByRole('group', { name: 'Window' });
		const current = group.querySelector('[aria-current="page"]');
		expect(current?.textContent).toContain('Last week');
		expect(current?.getAttribute('href')).toBe('?hours=168');
		expect(group.querySelectorAll('a[href^="?hours="]')).toHaveLength(3);
	});
});
