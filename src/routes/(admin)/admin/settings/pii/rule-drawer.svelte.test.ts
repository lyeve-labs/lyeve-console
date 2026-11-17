// @vitest-environment jsdom
import { render, cleanup, fireEvent, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SubmitFunction } from '$app/forms';

vi.mock('$app/navigation', () => ({ refreshAll: vi.fn(async () => {}) }));

/*
 * The rule form's submit function decides whether the drawer closes. It is
 * captured here and driven with each kind of result, which is what the
 * browser hands it after the action answers.
 */
const forms = vi.hoisted(() => ({ submits: new Map<string, SubmitFunction>() }));
vi.mock('$app/forms', () => ({
	enhance: (el: HTMLFormElement, fn?: SubmitFunction) => {
		if (fn) forms.submits.set(el.getAttribute('action') ?? '', fn);
		return { destroy: () => {} };
	},
}));

import PiiPage from './+page.svelte';

beforeEach(() => forms.submits.clear());
afterEach(cleanup);

const data = {
	rules: { presets: [], mask_tags: {}, custom: [] },
	entries: [],
	total: 0,
	limit: 50,
	offset: 0,
	gate: { state: 'ok' },
	logFailed: false,
};

async function submitNewRule(result: { type: string }) {
	render(PiiPage, { props: { data: data as never, form: null as never } });
	await fireEvent.click(screen.getAllByRole('button', { name: /new rule/i })[0]);
	await tick();
	const submit = forms.submits.get('?/create');
	expect(submit).toBeTypeOf('function');
	const after = (await submit?.({} as never)) as (opts: unknown) => Promise<void>;
	await after({ result, update: vi.fn(async () => {}) });
	await tick();
}

describe('PII rule drawer after a save', () => {
	it('stays open when the save is refused', async () => {
		await submitNewRule({ type: 'failure' });
		expect(document.querySelector('form[action="?/create"]')).not.toBeNull();
	});

	it('closes when the save succeeds', async () => {
		await submitNewRule({ type: 'success' });
		expect(document.querySelector('form[action="?/create"]')).toBeNull();
	});
});

/*
 * A snippet declared inside the form is a child of the form rather than a
 * prop of the drawer, so the drawer once rendered no button to save with.
 */
describe('PII rule drawer footer', () => {
	it('offers Create in the drawer, and it submits the rule form', async () => {
		render(PiiPage, { props: { data: data as never, form: null as never } });
		await fireEvent.click(screen.getAllByRole('button', { name: /new rule/i })[0]);
		await tick();
		await fireEvent.input(screen.getByLabelText(/^Name/), { target: { value: 'card' } });
		await fireEvent.input(screen.getByLabelText(/^Pattern/), { target: { value: '\\d{16}' } });
		await fireEvent.input(screen.getByLabelText(/^Replaced with/), { target: { value: '[card]' } });
		const ruleForm = document.querySelector<HTMLFormElement>('form[action="?/create"]');
		const create = screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement;
		expect(create.form).toBe(ruleForm);
		const submitted = vi.fn((e: Event) => e.preventDefault());
		ruleForm?.addEventListener('submit', submitted);
		await fireEvent.click(create);
		expect(submitted).toHaveBeenCalledTimes(1);
	});

	it('offers Save when a rule is edited', async () => {
		const rule = { id: 'r1', name: 'card', description: '', pattern: '\\d{16}', replacement: '[card]', priority: 100, enabled: false };
		render(PiiPage, { props: { data: { ...data, rules: { ...data.rules, custom: [rule] } } as never, form: null as never } });
		await fireEvent.click(screen.getByRole('button', { name: /^Edit/ }));
		await tick();
		const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
		expect(save.form).toBe(document.querySelector('form[action="?/update"]'));
	});
});
