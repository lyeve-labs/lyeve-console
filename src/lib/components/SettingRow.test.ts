// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActionResult, SubmitFunction } from '$app/forms';
import { tick } from 'svelte';
import SettingRow from './SettingRow.svelte';

// enhance hands back the row's submit function, so a test can hold a save in
// flight and then finish it.
const forms = vi.hoisted(() => ({ submit: null as SubmitFunction | null }));
vi.mock('$app/forms', () => ({
	enhance: (_el: HTMLFormElement, fn?: SubmitFunction) => {
		if (fn) forms.submit = fn;
		return { destroy() {} };
	},
}));

afterEach(cleanup);

const base = { id: 'set-SMTP_HOST', name: 'SMTP_HOST', label: 'host', saved: 'Saved.' };

/*
 * Save is a statement that something changed, so it stays disabled until the draft differs from
 * what is stored, and comes back when the draft returns to it.
 */
describe('SettingRow', () => {
	it('keeps Save disabled until the value differs from the stored one', async () => {
		const { container } = render(SettingRow, { props: { ...base, value: 'mail.example' } });
		const input = container.querySelector<HTMLInputElement>('input[name="value"]')!;
		const save = container.querySelector<HTMLButtonElement>('button[type="submit"]')!;

		expect(input.value).toBe('mail.example');
		expect(save.disabled).toBe(true);
		await fireEvent.input(input, { target: { value: 'smtp.example' } });
		expect(save.disabled).toBe(false);
		await fireEvent.input(input, { target: { value: 'mail.example' } });
		expect(save.disabled).toBe(true);
	});

	it('treats anything typed into a secret as a change, since the stored value never returns', async () => {
		const { container } = render(SettingRow, {
			props: { ...base, name: 'SMTP_PASS', secret: true, value: null },
		});
		const input = container.querySelector<HTMLInputElement>('input[name="value"]')!;
		const save = container.querySelector<HTMLButtonElement>('button[type="submit"]')!;

		expect(input.value).toBe('');
		expect(save.disabled).toBe(true);
		await fireEvent.input(input, { target: { value: 'hunter2' } });
		expect(save.disabled).toBe(false);
		expect(container.querySelector('input[name="secret"]')?.getAttribute('value')).toBe('true');
	});

	it('posts the key it stands for and shows only its own outcome', () => {
		const own = render(SettingRow, {
			props: { ...base, value: 'x', result: { key: 'SMTP_HOST', success: true } },
		});
		expect(own.container.querySelector('input[name="key"]')?.getAttribute('value')).toBe('SMTP_HOST');
		expect(own.container.textContent).toContain('Saved.');

		const other = render(SettingRow, {
			props: { ...base, value: 'x', result: { key: 'SMTP_PORT', error: 'refused' } },
		});
		expect(other.container.textContent).not.toContain('refused');
	});

	/*
	 * Orca speaks none of a region marked as a status, and no screen reader
	 * announces a region that arrives holding its text, so the outcome lands
	 * in a region that was on the page and empty before the save.
	 */
	it('announces its own save from a live region mounted empty', async () => {
		const view = render(SettingRow, { props: { ...base, value: 'x' } });
		const live = view.getByTestId('setting-saved-SMTP_HOST');
		expect(live.tagName).toBe('DIV');
		expect(live.getAttribute('aria-live')).toBe('polite');
		expect(live.getAttribute('aria-atomic')).toBe('true');
		expect(live.hasAttribute('role')).toBe(false);
		expect(live.textContent).toBe('');

		await view.rerender({ result: { key: 'SMTP_HOST', success: true } });

		expect(view.getByTestId('setting-saved-SMTP_HOST')).toBe(live);
		expect(live.textContent).toBe('Saved.');
		expect(view.container.querySelector('[role="status"]')).toBeNull();
		// The region is the message a sighted reader sees, so nothing hides it
		// from a screen reader and nothing repeats it.
		expect(live.hasAttribute('aria-hidden')).toBe(false);
		expect(live.className).toContain('empty:sr-only');
		expect(view.getAllByText('Saved.')).toHaveLength(1);
	});

	/*
	 * A second save of the same row leaves the same sentence in place, and a
	 * region whose text does not change says nothing. It empties while the save
	 * is in flight, so the sentence arrives again.
	 */
	it('announces a second save of the same row again', async () => {
		const view = render(SettingRow, { props: { ...base, value: 'x', result: { key: 'SMTP_HOST', success: true } } });
		const live = view.getByTestId('setting-saved-SMTP_HOST');
		expect(live.textContent).toBe('Saved.');

		const finish = (await forms.submit!({} as never)) as (arg: {
			result: ActionResult;
			update: () => Promise<void>;
		}) => Promise<void>;
		await tick();
		expect(live.textContent).toBe('');

		await finish({ result: { type: 'success', status: 200, location: '/admin/settings' }, update: async () => {} });
		await view.rerender({ result: { key: 'SMTP_HOST', success: true } });
		expect(view.getByTestId('setting-saved-SMTP_HOST')).toBe(live);
		expect(live.textContent).toBe('Saved.');
	});
});
