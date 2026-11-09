// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EmailTrigger } from '$lib/api/email-triggers';

type Submit = (input: { cancel: () => void; formData: FormData }) => Promise<unknown>;
const forms = vi.hoisted(() => ({ submits: new Map<HTMLFormElement, unknown>() }));
vi.mock('$app/forms', () => ({
	enhance: (form: HTMLFormElement, submit: unknown) => {
		forms.submits.set(form, submit);
		return { destroy() {} };
	},
}));
const kit = vi.hoisted(() => ({ confirm: vi.fn(async () => true) }));
vi.mock('@lyeve-labs/ui-kit', async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	confirm: kit.confirm,
}));

/**
 * Submit the form a row's delete button sits in, and return the question it
 * asked, what the form sends and whether the submit went ahead.
 */
async function pressDelete(button: HTMLElement, field: string) {
	const form = button.closest('form') as HTMLFormElement;
	const cancel = vi.fn();
	kit.confirm.mockClear();
	await (forms.submits.get(form) as Submit)({ cancel, formData: new FormData(form) });
	return {
		action: form.getAttribute('action'),
		title: String((kit.confirm.mock.calls[0] as unknown[] | undefined)?.[0] ?? ''),
		sent: String(new FormData(form).get(field) ?? ''),
		sentOff: !cancel.mock.calls.length,
	};
}


import TriggersPage from './+page.svelte';

afterEach(cleanup);

const trigger: EmailTrigger = {
	id: 'tr1',
	name: 'Order confirmation',
	event: 'after_create',
	schema: 'orders',
	template_key: 'order-confirmed',
	to_static: ['ops@example.test'],
	to_field: 'email',
	locale: '',
	enabled: true,
	updated_at: '2026-10-01T00:00:00Z',
};

const template = { id: 't1', key: 'order-confirmed', subject: 'Thanks', status: 'active' };

function props(over: Record<string, unknown> = {}, form: unknown = null) {
	return {
		data: {
			user: { roles: ['admin'] },
			triggers: { ok: true, value: { triggers: [trigger], events: ['after_create'] } },
			templates: { ok: true, value: [template] },
			schemas: { ok: true, value: ['orders'] },
			...over,
		} as never,
		form: form as never,
	};
}

describe('email triggers without the license for writes', () => {
	const refused = { kind: 'feature', feature: 'Trigger Studio', plugin: 'email', upgradeUrl: '' };

	it('disables New and Edit with the reason, and keeps Delete', () => {
		render(TriggersPage, { props: props({ writeRefusal: refused }) });
		const create = screen.getAllByRole('button', { name: /new trigger/i })[0] as HTMLButtonElement;
		expect(create.disabled).toBe(true);
		expect((screen.getByRole('button', { name: 'Edit Order confirmation' }) as HTMLButtonElement).disabled).toBe(true);
		expect((screen.getByRole('button', { name: 'Delete Order confirmation' }) as HTMLButtonElement).disabled).toBe(false);
		expect(document.body.textContent).toContain('Creating or editing a trigger is not enabled on this engine.');
		expect(document.body.textContent).not.toContain('Trigger Studio');
	});

	it('leaves New and Edit live when the license allows them', () => {
		render(TriggersPage, { props: props({ writeRefusal: null }) });
		expect((screen.getByRole('button', { name: 'Edit Order confirmation' }) as HTMLButtonElement).disabled).toBe(false);
	});
});

describe('email triggers page', () => {
	it('says a failed template read failed rather than that the tenant has none', () => {
		render(TriggersPage, {
			props: props({ templates: { ok: false, gate: { state: 'error', message: 'Could not load email templates.' } } }),
		});
		expect(screen.getByText('Could not load email templates.')).toBeTruthy();
		expect(screen.queryByText('No active template')).toBeNull();
	});

	it('says the tenant has no active template when the read answered with none, and offers no create', () => {
		render(TriggersPage, {
			props: props({
				triggers: { ok: true, value: { triggers: [], events: [] } },
				templates: { ok: true, value: [{ ...template, status: 'draft' }] },
			}),
		});
		expect(screen.getByText('No active template')).toBeTruthy();
		expect(screen.getByText('No triggers yet')).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'New trigger' })).toBeNull();
	});

	it('offers no create while the templates could not be read', () => {
		render(TriggersPage, {
			props: props({ templates: { ok: false, gate: { state: 'error', message: 'Could not load email templates.' } } }),
		});
		expect(screen.queryByRole('button', { name: 'New trigger' })).toBeNull();
	});

	it('shows the stored schema and template when editing after their reads failed', async () => {
		render(TriggersPage, {
			props: props({
				templates: { ok: false, gate: { state: 'unavailable' } },
				schemas: { ok: false, gate: { state: 'unavailable' } },
			}),
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Edit Order confirmation' }));
		const form = document.body.querySelector('form#trigger-form') as HTMLFormElement;
		expect((form.querySelector('input[name="schema"]') as HTMLInputElement).value).toBe('orders');
		expect((form.querySelector('input[name="template_key"]') as HTMLInputElement).value).toBe('order-confirmed');
		expect(form.querySelector('#trigger-schema')?.textContent).toContain('orders');
		expect(form.querySelector('#trigger-template')?.textContent).toContain('order-confirmed');
	});

	it('says a failed trigger read failed and offers no create', () => {
		const { container } = render(TriggersPage, {
			props: props({ triggers: { ok: false, gate: { state: 'unavailable' } } }),
		});
		expect(container.textContent).toContain('so email triggers did not load');
		expect(screen.queryByText('No triggers yet')).toBeNull();
		expect(screen.queryByRole('button', { name: 'New trigger' })).toBeNull();
	});

	it('keeps the first-run state with its create for a read that answered with none', () => {
		render(TriggersPage, { props: props({ triggers: { ok: true, value: { triggers: [], events: [] } } }) });
		expect(screen.getByText('No triggers yet')).toBeTruthy();
		expect(screen.getAllByRole('button', { name: 'New trigger' })).toHaveLength(2);
	});
});

describe('email trigger drawer', () => {
	const drawerText = () => document.body.querySelector('form#trigger-form')?.textContent ?? '';

	it('shows a refused save inside the open drawer', async () => {
		const { rerender } = render(TriggersPage, { props: props() });
		await fireEvent.click(screen.getByRole('button', { name: 'New trigger' }));
		await rerender(props({}, { action: 'save', error: 'Could not save the trigger. Try again.' }));
		expect(drawerText()).toContain('Could not save the trigger. Try again.');
	});

	it('shows the license a refused save needs inside the open drawer', async () => {
		const { rerender } = render(TriggersPage, { props: props() });
		await fireEvent.click(screen.getByRole('button', { name: 'New trigger' }));
		const refused = { kind: 'feature', feature: 'Trigger Studio', plugin: 'email', upgradeUrl: '' };
		await rerender(props({}, { action: 'save', error: 'This needs Trigger Studio.', refused }));
		expect(drawerText()).toContain('Not enabled on this engine');
		expect(drawerText()).not.toContain('This needs Trigger Studio.');
	});

	it('shows a failed delete above the list and leaves a newly opened drawer clean', async () => {
		const failed = 'Could not delete the trigger. Try again.';
		const { container } = render(TriggersPage, { props: props({}, { action: 'delete', error: failed }) });
		expect(container.textContent).toContain(failed);
		await fireEvent.click(screen.getByRole('button', { name: 'New trigger' }));
		expect(drawerText()).not.toContain(failed);
	});
});

describe('email trigger delete', () => {
	it('names the trigger and sends its id', async () => {
		render(TriggersPage, { props: props() });
		const out = await pressDelete(screen.getByRole('button', { name: 'Delete Order confirmation' }), 'id');
		expect(out.action).toBe('?/delete');
		expect(out.title).toBe('Delete trigger Order confirmation?');
		expect(out.sent).toBe('tr1');
		expect(out.sentOff).toBe(true);
	});
});

describe('email trigger pickers', () => {
	it('lets the schema and the template be searched', async () => {
		render(TriggersPage, { props: props() });
		await fireEvent.click(screen.getByRole('button', { name: 'New trigger' }));
		await fireEvent.click(document.body.querySelector('#trigger-schema') as HTMLElement);
		expect(screen.getByRole('combobox', { name: 'Search In' })).toBeTruthy();
	});
});
