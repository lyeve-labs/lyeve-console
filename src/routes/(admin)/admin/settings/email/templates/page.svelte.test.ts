// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import TemplatesPage from './+page.svelte';
import type { PageData } from './$types';

// enhance hands each form's submit function over here, so a test can play a
// result back through the one behind the preview.
const forms = vi.hoisted(() => ({ submits: [] as { node: HTMLFormElement; submit: unknown }[] }));
vi.mock('$app/forms', () => ({
	enhance: (node: HTMLFormElement, submit?: unknown) => {
		forms.submits.push({ node, submit });
		return { destroy() {} };
	},
}));
const kit = vi.hoisted(() => ({ confirm: vi.fn(async () => true), toastError: vi.fn() }));
vi.mock('@lyeve-labs/ui-kit', async (importOriginal) => {
	const real = await importOriginal<Record<string, unknown>>();
	return { ...real, confirm: kit.confirm, toast: { ...(real.toast as object), error: kit.toastError } };
});

/**
 * Submit the form a row's delete button sits in, and return the question it
 * asked, what the form sends and whether the submit went ahead.
 */
async function pressDelete(button: HTMLElement, field: string) {
	const form = button.closest('form') as HTMLFormElement;
	const submit = forms.submits.find((s) => s.node === form)?.submit as (input: { cancel: () => void; formData: FormData }) => Promise<unknown>;
	const cancel = vi.fn();
	kit.confirm.mockClear();
	await submit({ cancel, formData: new FormData(form) });
	return {
		action: form.getAttribute('action'),
		title: String((kit.confirm.mock.calls[0] as unknown[] | undefined)?.[0] ?? ''),
		sent: String(new FormData(form).get(field) ?? ''),
		sentOff: !cancel.mock.calls.length,
	};
}


afterEach(cleanup);

const reset = { id: 't1', key: 'password-reset', subject: 'Reset your password', mjml_source: '<mjml>{{.Vars.reset_link}}</mjml>', status: 'active', required: true };
const sale = { id: 't2', key: 'spring-sale', subject: 'Sale', mjml_source: '<mjml/>', status: 'draft', required: false };
const starters = [
	{ key: 'password-reset', subject: 'Reset', mjml_source: '<mjml/>', required: true, link_variable: 'reset_link' },
	{ key: 'welcome', subject: 'Welcome aboard', mjml_source: '<mjml>welcome body</mjml>', required: false },
];

function data(overrides: Record<string, unknown> = {}): PageData {
	return {
		templates: { ok: true, value: [reset, sale] },
		starters: { ok: true, value: starters },
		limits: { limit: 5, current: 2 },
		...overrides,
	} as unknown as PageData;
}

const drawerText = () => document.body.querySelector('form#template-form')?.textContent ?? '';

describe('email templates page', () => {
	it('marks the required templates and offers no delete for them', () => {
		render(TemplatesPage, { props: { data: data(), form: null } });
		expect(screen.getByText('Required')).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Delete password-reset' })).toBeNull();
		expect(screen.getByRole('button', { name: 'Delete spring-sale' })).toBeTruthy();
		expect(screen.getByTestId('template-usage').textContent).toContain('2 of 5 templates');
	});

	it('says every slot is taken and holds the create back at the ceiling', () => {
		render(TemplatesPage, { props: { data: data({ limits: { limit: 5, current: 5 } }), form: null } });
		expect(screen.getByText('Every template slot is in use')).toBeTruthy();
		expect((screen.getByRole('button', { name: 'New template' }) as HTMLButtonElement).disabled).toBe(true);
	});

	it('states no ceiling when the license lifts it', () => {
		render(TemplatesPage, { props: { data: data({ limits: { limit: 0, current: 9 } }), form: null } });
		expect(screen.getByTestId('template-usage').textContent).toContain('9 templates, no limit');
		expect((screen.getByRole('button', { name: 'New template' }) as HTMLButtonElement).disabled).toBe(false);
	});

	it('says the list could not be read rather than drawing a first run', () => {
		render(TemplatesPage, {
			props: { data: data({ templates: { ok: false, gate: { state: 'error', message: 'Could not load email templates.' } } }), form: null },
		});
		expect(screen.getByText('Could not load email templates.')).toBeTruthy();
		expect(screen.queryByText('No templates yet')).toBeNull();
		expect(screen.queryByRole('button', { name: 'New template' })).toBeNull();
	});

	it('offers the create from the first-run state', () => {
		render(TemplatesPage, { props: { data: data({ templates: { ok: true, value: [] } }), form: null } });
		expect(screen.getByText('No templates yet')).toBeTruthy();
		expect(screen.getAllByRole('button', { name: 'New template' })).toHaveLength(2);
	});

	it('tells the author which link a required template has to keep', async () => {
		render(TemplatesPage, { props: { data: data(), form: null } });
		await fireEvent.click(screen.getByRole('button', { name: 'Edit password-reset' }));
		expect(screen.getByText('Required template')).toBeTruthy();
		expect(screen.getByText('{{.Vars.reset_link}}')).toBeTruthy();
	});

	it('shows the ceiling refusal with its numbers inside the open drawer', async () => {
		const { rerender } = render(TemplatesPage, { props: { data: data(), form: null } });
		await fireEvent.click(screen.getByRole('button', { name: 'New template' }));
		await rerender({
			data: data(),
			form: { action: 'save', error: 'x', refused: { kind: 'cap', cap: 'email.templates', limit: 5, current: 5, upgradeUrl: '' } } as never,
		});
		expect(drawerText()).toContain('5 of 5 templates');
	});

	it('shows a refused save inside the open drawer', async () => {
		const { rerender } = render(TemplatesPage, { props: { data: data(), form: null } });
		await fireEvent.click(screen.getByRole('button', { name: 'New template' }));
		await rerender({ data: data(), form: { action: 'save', error: 'A template with that name already exists.' } as never });
		expect(drawerText()).toContain('A template with that name already exists.');
	});

	it('shows a failed delete above the list and leaves a newly opened drawer clean', async () => {
		const failed = 'Could not delete the template. Try again.';
		const { container } = render(TemplatesPage, {
			props: { data: data(), form: { action: 'delete', error: failed } as never },
		});
		expect(container.textContent).toContain(failed);
		await fireEvent.click(screen.getByRole('button', { name: 'New template' }));
		expect(drawerText()).not.toContain(failed);
	});

	it('shows a failed preview above the list rather than in the drawer', async () => {
		const failed = 'Could not render the template.';
		const { container } = render(TemplatesPage, {
			props: { data: data(), form: { action: 'preview', error: failed } as never },
		});
		expect(container.textContent).toContain(failed);
		await fireEvent.click(screen.getByRole('button', { name: 'Edit spring-sale' }));
		expect(drawerText()).not.toContain(failed);
	});
});

describe('email template delete', () => {
	it('names the template and sends its id', async () => {
		render(TemplatesPage, { props: { data: data(), form: null } });
		const out = await pressDelete(screen.getByRole('button', { name: 'Delete spring-sale' }), 'id');
		expect(out.action).toBe('?/delete');
		expect(out.title).toBe('Delete template spring-sale?');
		expect(out.sent).toBe('t2');
		expect(out.sentOff).toBe(true);
	});

	it('offers the ready-made templates in a searchable list', async () => {
		render(TemplatesPage, { props: { data: data(), form: null } });
		await fireEvent.click(screen.getByRole('button', { name: 'New template' }));
		const trigger = document.body.querySelector('#template-starter') as HTMLElement;
		await fireEvent.click(trigger);
		expect(screen.getByRole('combobox', { name: 'Search Start from' })).toBeTruthy();
	});
});

describe('a failed preview', () => {
	it('says so in a toast as well as above the list, and opens no empty preview', async () => {
		render(TemplatesPage, { props: { data: data(), form: null } });
		const entry = forms.submits.find((f) => f.node.getAttribute('action') === '?/preview' && f.node.isConnected);
		const submit = entry?.submit as () => (input: { result: unknown; update: () => Promise<void> }) => Promise<void>;
		kit.toastError.mockClear();
		await submit()({ result: { type: 'failure', status: 400, data: { action: 'preview', error: 'Could not render the template.' } }, update: async () => {} });
		expect(kit.toastError).toHaveBeenCalledWith('Could not render the template.');
		expect(document.body.querySelector('[data-testid="template-preview"]')).toBeNull();
	});
});
