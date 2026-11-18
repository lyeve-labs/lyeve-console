// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
vi.mock('$app/state', () => ({ page: { url: new URL('http://admin.test/admin/flows/f1') } }));

import FlowTemplateGallery from './FlowTemplateGallery.svelte';
import type { Gate } from '#lib/api/gate.ts';
import { fixtureTemplates } from '#lib/flow/fixtures.ts';

type After = (o: { result: { type: string; data?: unknown }; update: (o?: unknown) => Promise<void>; formElement: HTMLFormElement }) => Promise<void>;
type Submit = () => Promise<After>;

// Each form's submit handler is kept so a case can play the action's answer through it.
const forms = vi.hoisted(() => ({ submit: new Map<HTMLFormElement, Submit>() }));
vi.mock('$app/forms', () => ({
	enhance: (form: HTMLFormElement, submit: Submit) => {
		forms.submit.set(form, submit);
		return { destroy() {} };
	},
}));

const kit = vi.hoisted(() => ({ confirm: vi.fn(async () => false), success: vi.fn() }));
vi.mock('@lyeve-labs/ui-kit', async (importOriginal) => {
	const real = await importOriginal<Record<string, unknown>>();
	return { ...real, confirm: kit.confirm, toast: { ...(real.toast as object), success: kit.success } };
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});
beforeEach(() => {
	forms.submit.clear();
	kit.confirm.mockReset();
	kit.confirm.mockResolvedValue(false);
	kit.success.mockReset();
});

const saved = { ...fixtureTemplates[1], source: 'saved' as const };

function setup(props: Partial<{ templates: typeof fixtureTemplates; gate: Gate; canUpdate: boolean; canDelete: boolean }> = {}) {
	const onuse = vi.fn();
	const result = render(FlowTemplateGallery, {
		props: { open: true, templates: fixtureTemplates, flowDocument: '{"slug":"orders_sync"}', canUpdate: true, canDelete: true, onuse, ...props },
	});
	return { ...result, onuse };
}

/** Plays an action's answer through the form's submit handler. */
async function answer(form: HTMLFormElement, result: { type: string; data?: unknown }) {
	const after = await (forms.submit.get(form) as Submit)();
	await after({ result, update: vi.fn(async () => {}), formElement: form });
	await tick();
}

describe('FlowTemplateGallery', () => {
	it('offers one Use per template and hands the picked one to the page', async () => {
		const { getByTestId, onuse } = setup();
		const uses = [...getByTestId('template-gallery').querySelectorAll('button')].filter((b) => b.textContent?.trim() === 'Use');
		expect(uses).toHaveLength(fixtureTemplates.length);
		await fireEvent.click(uses[1]);
		expect(onuse).toHaveBeenCalledWith(fixtureTemplates[1]);
	});

	it('says the engine offered none when the list is empty', () => {
		const { queryByTestId } = setup({ templates: [] });
		expect(queryByTestId('template-gallery')).toBeNull();
		expect(document.body.textContent).toContain('No templates');
	});

	it('draws a failed read as a failure with a retry, never as no templates', () => {
		const { queryByTestId, getByRole } = setup({ templates: [], gate: { state: 'error', message: 'Could not load templates.' } });
		expect(queryByTestId('template-gallery')).toBeNull();
		expect(document.body.textContent).toContain('Could not load templates.');
		expect(document.body.textContent).not.toContain('No templates');
		expect(getByRole('link', { name: 'Try again' }).getAttribute('href')).toBe('/admin/flows/f1');
	});

	it('names the feature in a heading of its own when templates are not enabled', () => {
		const { getByRole } = setup({ templates: [], gate: { state: 'locked', upgradeUrl: '' } });
		expect(getByRole('heading', { name: 'Flow templates' })).toBeTruthy();
	});

	it('posts this flow as a template, and draws no save for a role that cannot update', async () => {
		const { getByText } = setup();
		await fireEvent.click(getByText('Save a template'));
		const own = document.body.querySelector('form[action="?/saveTemplate"]:not([enctype])') as HTMLFormElement;
		expect(new FormData(own).get('document')).toBe('{"slug":"orders_sync"}');
		cleanup();
		setup({ canUpdate: false });
		expect(document.body.textContent).not.toContain('Save a template');
	});

	it('shows a failed save inside the gallery, and a saved one as a toast', async () => {
		const { getByText } = setup();
		await fireEvent.click(getByText('Save a template'));
		const own = document.body.querySelector('form[action="?/saveTemplate"]:not([enctype])') as HTMLFormElement;
		await answer(own, { type: 'failure', data: { templateError: 'The URL answered 404.' } });
		expect(document.body.textContent).toContain('The URL answered 404.');
		await answer(own, { type: 'success', data: { savedTemplate: 'welcome' } });
		expect(kit.success).toHaveBeenCalledWith('Template saved');
		expect(document.body.textContent).not.toContain('The URL answered 404.');
	});

	it('deletes only a saved template, by name, after the reader confirms', async () => {
		const submit = vi.spyOn(HTMLFormElement.prototype, 'requestSubmit').mockImplementation(() => {});
		const { getByRole, queryByRole } = setup({ templates: [fixtureTemplates[0], saved] });
		expect(queryByRole('button', { name: `Delete the template ${fixtureTemplates[0].name}` })).toBeNull();
		await fireEvent.click(getByRole('button', { name: `Delete the template ${saved.name}` }));
		expect(kit.confirm).toHaveBeenCalledWith(`Delete the template ${saved.name}?`, expect.any(String), { confirmLabel: 'Delete' });
		expect(submit).not.toHaveBeenCalled();

		kit.confirm.mockResolvedValue(true);
		await fireEvent.click(getByRole('button', { name: `Delete the template ${saved.name}` }));
		await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
		const del = document.body.querySelector('form[action="?/deleteTemplate"]') as HTMLFormElement;
		expect(new FormData(del).get('id')).toBe(saved.id);
	});

	it('draws no delete for a role that cannot delete', () => {
		const { queryByRole } = setup({ templates: [saved], canDelete: false });
		expect(queryByRole('button', { name: `Delete the template ${saved.name}` })).toBeNull();
	});
});
