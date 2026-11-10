// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import VariablesPage from './+page.svelte';
import type { Entitlements } from '$lib/entitlements';
import type { Variable } from '$lib/api/flows';

vi.mock('$app/state', () => ({ page: { url: new URL('http://localhost/admin/flows/variables') } }));
// enhance keeps each form's submit handler, so a case can run the one a
// delete would run and read the question it asks.
const forms = vi.hoisted(() => ({
	submits: new Map<HTMLFormElement, (input: unknown) => unknown>(),
	confirm: vi.fn(async () => false),
}));
vi.mock('$app/forms', () => ({
	enhance: (node: HTMLFormElement, submit: (input: unknown) => unknown) => {
		forms.submits.set(node, submit);
		return { destroy: () => forms.submits.delete(node) };
	},
}));
vi.mock('@lyeve-labs/ui-kit', async (original) => ({
	...(await original<typeof import('@lyeve-labs/ui-kit')>()),
	confirm: forms.confirm,
}));

afterEach(cleanup);

const licensed: Entitlements = { plan: 'example', state: 'active', features: ['flow'], tenant_quota: 1 };

const variables: Variable[] = [
	{ key: 'region', value: 'eu', is_secret: false, updated_at: '2026-09-01T00:00:00Z' },
	{ key: 'api_key', is_secret: true, updated_at: '2026-09-01T00:00:00Z' },
];

function setup(rows: Variable[] = variables, form: unknown = null, locked = false, gate: unknown = { state: 'ok' }, roles: string[] = ['super_admin']) {
	return render(VariablesPage, {
		props: { data: { variables: rows, locked, gate, user: { roles }, entitlements: licensed }, form } as never,
	});
}

describe('variables page', () => {
	it('lists values in the clear and masks a secret', () => {
		const { container } = setup();
		const rows = container.querySelectorAll('tbody tr');
		expect(rows).toHaveLength(2);
		expect(rows[0].textContent).toContain('vars.region');
		expect(rows[0].textContent).toContain('eu');
		expect(rows[1].textContent).toContain('********');
		expect(rows[1].textContent).toContain('secret');
	});

	it('creates in a drawer that posts key, value and the secret flag', async () => {
		const { container, getAllByRole } = setup([]);
		expect(container.querySelector('[role="dialog"]')).toBeNull();
		await fireEvent.click(getAllByRole('button', { name: /new variable/i })[0]);
		const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
		const form = dialog.querySelector('form[action="?/put"]') as HTMLFormElement;
		expect(form.querySelector('[name="key"]')).toBeTruthy();
		expect(form.querySelector('[name="value"]')).toBeTruthy();
		expect((form.querySelector('[name="is_secret"]') as HTMLInputElement).value).toBe('false');
		expect(dialog.querySelector('button[type="submit"]')?.textContent?.trim()).toBe('Create');
	});

	it('keeps the typed value when Secret is flipped, in both directions', async () => {
		const { getByLabelText, container, getAllByRole } = setup([]);
		await fireEvent.click(getAllByRole('button', { name: /new variable/i })[0]);
		const form = container.querySelector('form[action="?/put"]') as HTMLFormElement;
		await fireEvent.input(getByLabelText('Value'), { target: { value: 'sk-live-1' } });
		await fireEvent.click(getByLabelText('Secret'));
		let value = form.querySelector('[name="value"]') as HTMLInputElement;
		expect(value.type).toBe('password');
		expect(value.value).toBe('sk-live-1');
		expect((form.querySelector('[name="is_secret"]') as HTMLInputElement).value).toBe('true');
		await fireEvent.click(getByLabelText('Secret'));
		value = form.querySelector('[name="value"]') as HTMLInputElement;
		expect(value.type).toBe('text');
		expect(value.value).toBe('sk-live-1');
	});

	it('keeps a value typed into the edit drawer when its Secret is flipped', async () => {
		const { getByLabelText, container } = setup();
		await fireEvent.click(getByLabelText('Edit region'));
		const form = container.querySelector('form[action="?/put"]') as HTMLFormElement;
		await fireEvent.input(form.querySelector('[name="value"]') as HTMLInputElement, { target: { value: 'us' } });
		await fireEvent.click(form.querySelector('[role="switch"]') as HTMLElement);
		const value = form.querySelector('[name="value"]') as HTMLInputElement;
		expect(value.type).toBe('password');
		expect(value.value).toBe('us');
		expect((form.querySelector('[name="is_secret"]') as HTMLInputElement).value).toBe('true');
	});

	it('edits a plain value in the drawer with the stored value filled in, and offers Save', async () => {
		const { getByLabelText, container } = setup();
		await fireEvent.click(getByLabelText('Edit region'));
		const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
		const form = dialog.querySelector('form[action="?/put"]') as HTMLFormElement;
		expect((form.querySelector('[name="value"]') as HTMLInputElement).value).toBe('eu');
		expect((form.querySelector('[name="existing"]') as HTMLInputElement).value).toBe('true');
		expect((form.querySelector('[name="key"]') as HTMLInputElement).value).toBe('region');
		expect(dialog.querySelector('button[type="submit"]')?.textContent?.trim()).toBe('Save');
	});

	it('edits a secret with an empty write-only field and a hint', async () => {
		const { getByLabelText, container } = setup();
		await fireEvent.click(getByLabelText('Edit api_key'));
		const form = container.querySelector('form[action="?/put"]') as HTMLFormElement;
		const value = form.querySelector('[name="value"]') as HTMLInputElement;
		expect(value.value).toBe('');
		expect(value.type).toBe('password');
		expect(form.textContent).toContain('cannot be read back');
	});

	it('closes the drawer once the write is saved', () => {
		const { container } = setup(variables, { saved: 'region' });
		expect(container.querySelector('[role="dialog"]')).toBeNull();
	});

	it('asks before a row posts its delete', async () => {
		const { getByLabelText } = setup();
		const form = getByLabelText('Delete region').closest('form') as HTMLFormElement;
		expect(form.getAttribute('action')).toBe('?/delete');
		expect(new FormData(form).get('key')).toBe('region');
		const cancel = vi.fn();
		await forms.submits.get(form)?.({ cancel });
		expect(forms.confirm).toHaveBeenCalledWith('Delete variable vars.region?', expect.any(String), { confirmLabel: 'Delete' });
		expect(cancel).toHaveBeenCalled();
	});

	it('shows a failed delete on the page', () => {
		const { container } = setup(variables, { action: 'delete', error: 'Could not delete the variable. Try again.' });
		expect(container.textContent).toContain('Could not delete the variable. Try again.');
	});

	// The drawer and the delete share one form result.
	it('keeps a failed delete out of the drawer opened after it', async () => {
		const { container, getAllByText } = setup(variables, { action: 'delete', error: 'Could not delete the variable. Try again.' });
		await fireEvent.click(getAllByText('New variable')[0]);
		const drawer = container.ownerDocument.querySelector('#variable-form') as HTMLElement;
		expect(drawer.textContent).not.toContain('Could not delete the variable. Try again.');
	});

	it('shows a failed save inside the open drawer', async () => {
		const { container, getAllByText, rerender } = setup();
		await fireEvent.click(getAllByText('New variable')[0]);
		await rerender({
			data: { variables, locked: false, gate: { state: 'ok' }, user: { roles: ['super_admin'] }, entitlements: licensed },
			form: { action: 'put', error: 'value too long', key: 'region' },
		} as never);
		const drawer = container.ownerDocument.querySelector('#variable-form') as HTMLElement;
		expect(drawer.textContent).toContain('value too long');
	});

	it('renders the not-enabled state when locked', () => {
		const { getByTestId } = setup([], null, true);
		expect(getByTestId('not-enabled')).toBeTruthy();
	});

	it('shows a failed load as an alert and not as an empty list', () => {
		const { container, queryByText } = setup([], null, false, { state: 'error', message: 'Variables could not be read from the engine.' });
		expect(container.textContent).toContain('Variables could not be read from the engine.');
		expect(queryByText('No variables yet')).toBeNull();
	});
});

describe('variables search', () => {
	it('searches by the address and says when nothing matches', () => {
		const { container, getByLabelText } = render(VariablesPage, {
			props: { data: { variables: [], total: 0, q: 'zz', limit: 50, offset: 0, locked: false, gate: { state: 'ok' }, user: { roles: ['admin'] }, entitlements: licensed }, form: null } as never,
		});
		const form = container.querySelector('[data-testid="variable-filters"]') as HTMLFormElement;
		expect(form.getAttribute('method')).toBe('GET');
		expect((getByLabelText('Search variables') as HTMLInputElement).value).toBe('zz');
		expect(container.textContent).toContain('No variables match');
		expect(container.textContent).not.toContain('No variables yet');
	});
});

describe('variables page for a role the plugin refuses', () => {
	it('says the role cannot read variables and offers nothing to create', () => {
		const { container, queryByText } = setup([], null, false, { state: 'forbidden' }, ['editor']);
		expect(container.textContent).toContain('Your role cannot open flow variables.');
		expect(container.textContent).not.toContain('Reload');
		expect(queryByText('New variable')).toBeNull();
		expect(queryByText('No variables yet')).toBeNull();
	});

	it('offers nothing to create while the list could not be read', () => {
		const { container, queryByText } = setup([], null, false, { state: 'unavailable' });
		expect(container.textContent).toContain('flow variables did not load');
		expect(queryByText('New variable')).toBeNull();
	});
});

describe('variables search', () => {
	it('searches as you type, with no Search button and no Clear link', () => {
		const { getByTestId, queryByRole } = render(VariablesPage, {
			props: {
				data: { variables, total: 2, q: 'region', locked: false, gate: { state: 'ok' }, user: { roles: ['super_admin'] }, entitlements: licensed },
				form: null,
			} as never,
		});
		const form = getByTestId('variable-filters');
		expect(form.querySelector('button[type="submit"]')).toBeNull();
		expect(form.hasAttribute('data-sveltekit-replacestate')).toBe(true);
		expect(queryByRole('link', { name: 'Clear' })).toBeNull();
	});
});
