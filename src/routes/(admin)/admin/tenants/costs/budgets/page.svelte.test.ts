// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PageData } from './$types';

// enhance keeps each form's submit handler, so a case can run the one a
// delete would run and read the question it asks.
const forms = vi.hoisted(() => ({ submits: new Map<HTMLFormElement, (input: unknown) => unknown>() }));
vi.mock('$app/forms', () => ({
	enhance: (node: HTMLFormElement, submit: (input: unknown) => unknown) => {
		forms.submits.set(node, submit);
		return { destroy: () => forms.submits.delete(node) };
	},
}));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

const kit = vi.hoisted(() => ({ confirm: vi.fn(async () => false) }));
vi.mock('@lyeve-labs/ui-kit', async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>();
	return { ...actual, confirm: kit.confirm };
});

import BudgetsPage from './+page.svelte';

afterEach(cleanup);

const budgets = [
	{
		id: 'b1',
		name: 'Storage cap',
		resource_type: 'storage',
		period: 'monthly',
		amount: '10.00',
		currency: 'USD',
		alert_thresholds: [50, 80, 100],
		current_spend: '9.00',
		period_start: '2026-09-01T00:00:00Z',
		period_end: '2026-10-01T00:00:00Z',
	},
];

function data(overrides: Record<string, unknown> = {}): PageData {
	return { enabled: true, upgradeUrl: '', budgets: { ok: true, value: budgets }, ...overrides } as unknown as PageData;
}

describe('tenant cost budgets page', () => {
	it('lists the budgets under the strip and offers a new one', () => {
		render(BudgetsPage, { props: { data: data(), form: null } });
		expect(screen.getByRole('tab', { name: 'Budgets' }).getAttribute('aria-selected')).toBe('true');
		expect(screen.getByText('Beta')).toBeTruthy();
		expect(screen.getByTestId('budget-row').textContent).toContain('50%, 80%, 100%');
		expect(screen.getByTestId('budget-row').textContent).toContain('2026-09-01 to 2026-09-30');
		expect(screen.getByRole('button', { name: 'Delete Storage cap' })).toBeTruthy();
		expect(screen.getByRole('button', { name: /New budget/ })).toHaveProperty('disabled', false);
	});

	it('shows only that the feature is not enabled when the ledger refused, and no control', () => {
		render(BudgetsPage, {
			props: { data: data({ enabled: false, budgets: { ok: false, gate: { state: 'locked', upgradeUrl: '' } } }), form: null },
		});
		expect(screen.getByTestId('not-enabled').textContent).toContain('Not enabled on this engine.');
		expect(screen.queryByRole('region', { name: 'Budgets' })).toBeNull();
		expect(screen.queryByRole('button', { name: /New budget/ })).toBeNull();
	});

	it('says a saved budget was saved', async () => {
		render(BudgetsPage, { props: { data: data(), form: { action: 'createBudget', saved: true } as never } });
		expect(await screen.findByText('Budgets saved.')).toBeTruthy();
	});
});

/*
 * Both forms on the page share one action result. The budget drawer showed
 * nothing of a failed create, and a failed delete is no failure of the next
 * budget opened.
 */
describe('the budget drawer and the failures of other actions', () => {
	const drawerText = () => document.body.querySelector('form#budget-form')?.textContent ?? '';

	it('leaves a newly opened budget drawer clean after a failed delete', async () => {
		render(BudgetsPage, { props: { data: data(), form: { action: 'deleteBudget', error: 'Could not delete the budget. Try again.', locked: false } as never } });
		expect(screen.getAllByText('Could not delete the budget. Try again.')).toHaveLength(1);
		await fireEvent.click(screen.getAllByRole('button', { name: /New budget/ })[0]);
		expect(drawerText()).not.toContain('Could not delete the budget. Try again.');
	});

	it('keeps the warn tone of a refusal for a ledger that is not enabled', async () => {
		const { rerender } = render(BudgetsPage, { props: { data: data(), form: null } });
		await fireEvent.click(screen.getAllByRole('button', { name: /New budget/ })[0]);
		await rerender({
			data: data(),
			form: { action: 'createBudget', error: 'The cost ledger is not enabled on this engine.', locked: true } as never,
		});
		const form = document.body.querySelector('form#budget-form') as HTMLFormElement;
		const alert = [...form.querySelectorAll('[role="alert"], [role="status"], div')].find(
			(el) => el.textContent?.trim() === 'The cost ledger is not enabled on this engine.' && el.className.includes('warn'),
		);
		expect(alert).toBeTruthy();
		expect(form.textContent).toContain('The cost ledger is not enabled on this engine.');
	});

	it('shows a failed create inside the open drawer, first in its form', async () => {
		const { rerender } = render(BudgetsPage, { props: { data: data(), form: null } });
		await fireEvent.click(screen.getAllByRole('button', { name: /New budget/ })[0]);
		await rerender({ data: data(), form: { action: 'createBudget', error: 'The amount is a decimal.', locked: false } as never });
		const form = document.body.querySelector('form#budget-form') as HTMLFormElement;
		expect(form.firstElementChild?.textContent).toContain('The amount is a decimal.');
	});
});

describe('the budget controls', () => {
	it('picks the period from a segmented control that posts it', async () => {
		render(BudgetsPage, { props: { data: data(), form: null } });
		await fireEvent.click(screen.getAllByRole('button', { name: /New budget/ })[0]);
		expect(screen.getByRole('radiogroup', { name: 'Period' })).toBeTruthy();
		const form = document.body.querySelector('form#budget-form') as HTMLFormElement;
		expect(new FormData(form).get('period')).toBe('monthly');
	});

	it('names the budget in the delete confirmation and posts its id', async () => {
		render(BudgetsPage, { props: { data: data(), form: null } });
		const form = screen.getByRole('button', { name: 'Delete Storage cap' }).closest('form') as HTMLFormElement;
		expect(form.getAttribute('action')).toBe('?/deleteBudget');
		expect(new FormData(form).get('id')).toBe('b1');
		const cancel = vi.fn();
		await forms.submits.get(form)?.({ cancel });
		expect(kit.confirm).toHaveBeenCalledWith('Delete budget Storage cap?', expect.any(String), { confirmLabel: 'Delete' });
		expect(cancel).toHaveBeenCalled();
	});
});
