// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));
vi.mock('$app/state', () => ({ page: { url: new URL('http://localhost/admin/observability/errors') } }));

import ErrorsPage from './+page.svelte';
import type { ErrorAlert } from '#lib/api/error-tracking.ts';

afterEach(cleanup);

function alert(over: Partial<ErrorAlert> = {}): ErrorAlert {
	return {
		id: 'a1',
		fingerprint: 'fp',
		error_code_id: 'c1',
		source_file: 'store.go',
		source_line: 12,
		message_sample: 'connection refused',
		error_count: 3,
		first_seen: '2026-09-01T00:00:00Z',
		last_seen: '2026-09-02T00:00:00Z',
		acknowledged: true,
		acknowledged_by: 'ana',
		created_at: '2026-09-01T00:00:00Z',
		status: 'open',
		assigned_to: '',
		...over,
	};
}

function setup(over: Record<string, unknown> = {}, form: Record<string, unknown> | null = null) {
	return render(ErrorsPage, {
		props: {
			data: {
				alerts: [alert()],
				codes: [],
				total: 1,
				limit: 50,
				offset: 0,
				gate: { state: 'ok' },
				status: '',
				events: { data: [], total: 0, hiddenOlder: 0, windowDays: null },
				...over,
			},
			form,
		} as never,
	});
}

describe('a status that matches nothing', () => {
	it('says no failure matches and offers to clear the filter', () => {
		const { getByRole } = setup({ alerts: [], total: 0, status: 'ignored' });
		expect(document.body.textContent).toContain('No failures match these filters');
		expect(getByRole('link', { name: 'Clear filters' }).getAttribute('href')).toBe('/admin/observability/errors');
	});
});

function actionsOf(row: Element): string[] {
	return [...row.querySelectorAll('input[name="action"]')].map((i) => (i as HTMLInputElement).value);
}

describe('failure triage', () => {
	it('offers resolve and ignore on an open failure', () => {
		const { container } = setup();
		expect(actionsOf(container.querySelector('[data-testid="failure-row"]')!)).toEqual(['resolve', 'ignore']);
	});

	it.each(['resolved', 'ignored'])('offers reopen on a %s failure', (status) => {
		const { container } = setup({ alerts: [alert({ status })] });
		const row = container.querySelector('[data-testid="failure-row"]')!;
		expect(row.getAttribute('data-status')).toBe(status);
		expect(actionsOf(row)).toEqual(['reopen']);
	});

	it('reads a failure from a plugin without triage as open', () => {
		const { container } = setup({ alerts: [alert({ status: undefined })] });
		expect(container.querySelector('[data-testid="failure-row"]')?.getAttribute('data-status')).toBe('open');
	});

	it('names who a failure is assigned to', () => {
		const { container } = setup({ alerts: [alert({ assigned_to: 'ana@example.com' })] });
		expect(container.querySelector('[data-testid="assignee"]')?.textContent).toContain('ana@example.com');
	});

	it('assigns in a one-field prompt that starts from the current assignee', async () => {
		const { container, getByRole } = setup({ alerts: [alert({ assigned_to: 'ana' })] });
		await fireEvent.click(getByRole('button', { name: 'Assign this failure' }));
		const dialog = container.ownerDocument.querySelector('[role="dialog"]') as HTMLElement;
		expect((dialog.querySelector('#alert-assignee') as HTMLInputElement).value).toBe('ana');
	});
});

describe('recent events', () => {
	it('ends the list with the older events the plugin left out', () => {
		const { container } = setup({ events: { data: [], total: 0, hiddenOlder: 12, windowDays: 30 } });
		const row = container.querySelector('[data-testid="older-hidden"]')?.textContent ?? '';
		expect(row).toContain('12 older events');
		expect(row).toContain('the last 30 days');
	});

	it('shows no such row when nothing was left out', () => {
		const { container } = setup();
		expect(container.querySelector('[data-testid="older-hidden"]')).toBeNull();
	});

	it('says a failed read failed', () => {
		const { container } = setup({ events: null });
		expect(container.textContent).toContain('Could not load recent events.');
	});
});

describe('the tiles', () => {
	const tile = (container: HTMLElement, label: string) =>
		[...container.querySelectorAll('p')].find((p) => p.textContent?.trim() === label)?.nextElementSibling?.textContent?.trim();

	// The count of distinct failures was the length of the page, so a list of
	// three hundred read as fifty.
	it('counts every failure the plugin tracks, not the rows on this page', () => {
		const { container } = setup({ alerts: [alert(), alert({ id: 'a2' })], total: 300 });
		expect(tile(container, 'Distinct failures tracked')).toBe('300');
		expect(container.textContent).toContain('of the 2 on this page');
	});

	it('states the counts plainly when every failure is on the page', () => {
		const { container } = setup();
		expect(tile(container, 'Distinct failures tracked')).toBe('1');
		expect(container.textContent).not.toContain('on this page');
	});
});

describe('which surface says a failure', () => {
	const dialog = (container: HTMLElement) => container.ownerDocument.querySelector('[role="dialog"]') as HTMLElement;

	// A failed acknowledge or triage was said inside the next Assign prompt.
	it('says a failed triage on the page and not in the Assign prompt', async () => {
		const { container, getByRole } = setup({}, { error: 'Could not change the alert status. Try again.' });
		expect(container.textContent).toContain('Could not change the alert status. Try again.');
		await fireEvent.click(getByRole('button', { name: 'Assign this failure' }));
		expect(dialog(container).textContent).not.toContain('Could not change');
	});

	it('says a failed assign inside the Assign prompt', async () => {
		const { container, getByRole } = setup({}, { error: 'Could not assign the alert. Try again.', drawer: 'assign' });
		await fireEvent.click(getByRole('button', { name: 'Assign this failure' }));
		expect(dialog(container).textContent).toContain('Could not assign the alert. Try again.');
	});
});
