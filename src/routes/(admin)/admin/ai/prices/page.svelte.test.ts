// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActionResult, SubmitFunction } from '@sveltejs/kit';
import { tick } from 'svelte';
import Page from './+page.svelte';
import { fixturePrice, fixtureSettings } from '$lib/components/ai/test-support/fixtures';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
// enhance hands back each form's submit function by its action, so a test can
// drive a save without the router a real submission needs in jsdom.
const forms = vi.hoisted(() => ({ submits: new Map<string, SubmitFunction>() }));
vi.mock('$app/forms', () => ({
	enhance: (el: HTMLFormElement, fn?: SubmitFunction) => {
		if (fn) forms.submits.set(el.getAttribute('action') ?? '', fn);
		return { destroy() {} };
	},
}));

afterEach(() => {
	cleanup();
	forms.submits.clear();
});

function setup(overrides: Record<string, unknown> = {}, form: unknown = null) {
	return render(Page, {
		props: {
			data: { gate: { state: 'ok' }, prices: [fixturePrice], aiSettings: fixtureSettings, aiLayoutGate: { state: 'ok' }, isSuperAdmin: true, ...overrides },
			form,
		} as never,
	});
}

/** Opens the drawer, starts a save through its form, and returns what finishes it. */
async function startSave() {
	if (!forms.submits.has('?/save')) await fireEvent.click(screen.getAllByRole('button', { name: /new price/i })[0]);
	const submit = forms.submits.get('?/save')!;
	const callback = (await submit({ cancel() {} } as never)) as (opts: {
		result: ActionResult;
		update: () => Promise<void>;
	}) => Promise<void>;
	return (result: ActionResult = { type: 'success', status: 200, data: { key: 'openai/gpt-4o', saved: true } }) =>
		callback({ result, update: async () => {} });
}

async function saveOnce() {
	const finish = await startSave();
	await finish();
}

describe('AI prices page', () => {
	it('edits a row in the drawer, keyed by its kind and model, and offers Save', async () => {
		const { container, getByLabelText } = setup();
		const row = container.querySelector('tbody tr') as HTMLElement;
		expect(row.textContent).toContain('OpenAI');
		expect(row.textContent).toContain('gpt-4o');
		await fireEvent.click(getByLabelText('Edit price for gpt-4o'));
		const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
		const form = dialog.querySelector('form[action="?/save"]') as HTMLFormElement;
		expect((form.querySelector('input[name="kind"]') as HTMLInputElement).value).toBe('openai');
		expect((form.querySelector('input[name="model"]') as HTMLInputElement).value).toBe('gpt-4o');
		expect((form.querySelector('input[name="output_per_1k"]') as HTMLInputElement).valueAsNumber).toBe(0.01);
		expect(dialog.querySelector('button[type="submit"]')?.textContent?.trim()).toBe('Save');
	});

	it('creates in the drawer from the header, and offers Create', async () => {
		const { container, getAllByRole } = setup();
		await fireEvent.click(getAllByRole('button', { name: /new price/i })[0]);
		const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
		expect(dialog.querySelector('input[name="model"]')).toBeTruthy();
		expect(dialog.querySelector('button[type="submit"]')?.textContent?.trim()).toBe('Create');
		// The four kinds are a list of radios with a sentence each, so the long
		// labels stay inside a phone-width drawer.
		const radios = dialog.querySelectorAll<HTMLInputElement>('input[type="radio"][name="kind"]');
		expect(radios).toHaveLength(4);
		expect([...radios].find((r) => r.checked)?.value).toBe('openai');
		expect(dialog.textContent).toContain('Any server that speaks the OpenAI API');
	});

	it('asks before it deletes, then posts the row key', async () => {
		const { container, getByLabelText } = setup();
		const form = container.querySelector('form[action="?/delete"]') as HTMLFormElement;
		expect(container.querySelector('tbody form')).toBeNull();
		expect((form.querySelector('input[name="model"]') as HTMLInputElement).value).toBe('');
		expect(getByLabelText('Delete price for gpt-4o')).toBeTruthy();
	});

	it('reads only for a tenant admin', () => {
		const { container, queryByRole } = setup({ isSuperAdmin: false });
		expect(container.querySelector('tbody button')).toBeNull();
		expect(container.querySelector('tbody tr')?.textContent).toContain('$0.0025');
		expect(queryByRole('button', { name: /new price/i })).toBeNull();
	});

	it('matches a saved result to its row', () => {
		const saved = setup({}, { key: 'openai/gpt-4o', saved: true });
		const row = saved.container.querySelector('tbody tr') as HTMLElement;
		expect(row.textContent).toContain('Saved.');
		// The row's copy is what ties the sentence to its model, so a screen
		// reader browsing the table finds it there.
		expect(row.querySelector('[aria-hidden="true"]')?.textContent ?? '').not.toContain('Saved.');
	});

	/*
	 * Orca speaks none of a region marked as a status, and a new price's row
	 * arrives holding its "Saved.", so the sentence is spoken from a region
	 * that was on the page and empty before the save.
	 */
	it('announces a save from a live region mounted empty', async () => {
		const view = setup();
		const live = view.getByTestId('price-saved');
		expect(live.tagName).toBe('DIV');
		expect(live.getAttribute('aria-live')).toBe('polite');
		expect(live.getAttribute('aria-atomic')).toBe('true');
		expect(live.hasAttribute('role')).toBe(false);
		expect(live.textContent).toBe('');

		await saveOnce();

		expect(view.getByTestId('price-saved')).toBe(live);
		expect(live.textContent).toBe('Saved.');
		expect(view.container.querySelector('[role="status"]')).toBeNull();
	});

	// The same sentence left in place says nothing, so a second save empties the
	// region while it runs and fills it again.
	it('announces a second save again', async () => {
		const view = setup();
		const live = view.getByTestId('price-saved');
		await saveOnce();
		expect(live.textContent).toBe('Saved.');

		const finish = await startSave();
		await tick();
		expect(live.textContent).toBe('');
		await finish();
		expect(live.textContent).toBe('Saved.');
	});

	// A failed save keeps the drawer open beside its message and says nothing here.
	it('announces nothing for a failed save', async () => {
		const view = setup();
		const finish = await startSave();
		await finish({ type: 'failure', status: 400, data: { action: 'save', error: 'Enter a model.' } });
		expect(view.getByTestId('price-saved').textContent).toBe('');
	});

	it('shows a failed delete on the page and not in the drawer opened after it', async () => {
		const { container, getByText, getAllByRole } = setup({}, { action: 'delete', key: 'openai/gpt-4o', error: 'Could not delete the price. Try again.' });
		expect(getByText('Could not delete the price. Try again.')).toBeTruthy();
		await fireEvent.click(getAllByRole('button', { name: /new price/i })[0]);
		const form = container.querySelector('#price-form') as HTMLElement;
		expect(form.textContent).not.toContain('Could not delete the price. Try again.');
	});

	it('shows a failed save inside the open drawer and not on the page behind it', async () => {
		const { container, getAllByRole, rerender } = setup();
		await fireEvent.click(getAllByRole('button', { name: /new price/i })[0]);
		await rerender({ form: { action: 'save', key: 'openai/', error: 'Enter a model.' } } as never);
		expect((container.querySelector('#price-form') as HTMLElement).textContent).toContain('Enter a model.');
		expect(document.body.textContent?.split('Enter a model.').length).toBe(2);
	});

	it('offers no new price while the layout says AI is off, even with a list answered', () => {
		const { queryByRole } = setup({ aiLayoutGate: { state: 'off' } });
		expect(queryByRole('button', { name: /new price/i })).toBeNull();
	});

	it('paints the empty state and the off state', () => {
		const empty = setup({ prices: [] });
		expect(empty.getByText('No prices yet')).toBeTruthy();
		cleanup();
		const off = setup({ gate: { state: 'off' }, prices: [] });
		expect(off.getByText('AI is switched off for this tenant')).toBeTruthy();
		expect(off.queryByRole('button', { name: /new price/i })).toBeNull();
	});
});

describe('AI prices table', () => {
	// The timestamp wrapped to four lines in a 42px column.
	it('keeps the updated time on one line', () => {
		const { container } = setup();
		const row = container.querySelector('tbody tr') as HTMLElement;
		const updated = [...row.querySelectorAll('td')][5];
		expect(updated.getAttribute('data-cell')).toBe('nowrap');
	});
});
