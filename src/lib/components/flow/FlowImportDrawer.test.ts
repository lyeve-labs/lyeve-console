// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import FlowImportDrawer, { type ImportFailure } from './FlowImportDrawer.svelte';

type After = (o: { result: { type: string }; update: (o?: unknown) => Promise<void> }) => Promise<void>;
type Submit = () => Promise<After>;

const forms = vi.hoisted(() => ({ submit: null as Submit | null }));
vi.mock('$app/forms', () => ({
	enhance: (_form: HTMLFormElement, submit: Submit) => {
		forms.submit = submit;
		return { destroy() {} };
	},
}));

afterEach(cleanup);
beforeEach(() => {
	forms.submit = null;
});

function setup(failure: ImportFailure | null = null, enableLink: { href: string; label?: string } | null = null) {
	return render(FlowImportDrawer, { props: { open: true, slug: 'orders_sync', failure, enableLink } });
}

const importForm = () => document.body.querySelector('#flow-import-form') as HTMLFormElement;

describe('FlowImportDrawer', () => {
	it('posts the file or the text to the import action on the flow slug', () => {
		setup();
		const form = importForm();
		expect(form.getAttribute('action')).toBe('?/import');
		expect(form.getAttribute('enctype')).toBe('multipart/form-data');
		expect(new FormData(form).get('slug')).toBe('orders_sync');
		expect(form.querySelector('input[type="file"][name="file"]')).toBeTruthy();
		expect(form.querySelector('textarea[name="text"]')).toBeTruthy();
	});

	it('shows the import failure first in the form', () => {
		setup({ error: 'Paste a definition or choose a file.', refusal: null, refused: false });
		expect(importForm().firstElementChild?.textContent).toContain('Paste a definition or choose a file.');
		expect(importForm().querySelector('a')).toBeNull();
	});

	it('names the way to raise the limit for a refused import', () => {
		setup({ error: '7 of 7 flows are in use.', refusal: { nodeIds: [], limit: 7, current: 7, upgradeUrl: '' }, refused: true }, { href: '/admin/settings/license' });
		const link = importForm().querySelector('a[href="/admin/settings/license"]') as HTMLElement;
		expect(link.textContent).toBe('How to raise the limit');
		// One line of small text, so it takes the touch hit area.
		expect(link.classList.contains('hit-area') && link.classList.contains('relative')).toBe(true);
	});

	it('closes on success and stays open on a failure', async () => {
		setup();
		const update = vi.fn(async () => {});
		await (await (forms.submit as Submit)())({ result: { type: 'failure' }, update });
		await tick();
		expect(importForm()).toBeTruthy();
		await (await (forms.submit as Submit)())({ result: { type: 'success' }, update });
		await tick();
		await vi.waitFor(() => expect(document.body.querySelector('#flow-import-form')).toBeNull());
	});

	it('closes from Cancel', async () => {
		const { getByRole } = setup();
		await fireEvent.click(getByRole('button', { name: 'Cancel' }));
		await vi.waitFor(() => expect(document.body.querySelector('#flow-import-form')).toBeNull());
	});
});
