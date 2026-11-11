// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Entitlements } from '$lib/entitlements';
import type { ValidationError } from '$lib/api/flows';
import { blockedFlow, fixtureFlow } from '$lib/flow/fixtures';
import { BLOCKED_TEXT } from '$lib/flow/blocked';

// enhance keeps each form's submit handler, so a case can run the one a
// delete would run and read the question it asks.
const forms = vi.hoisted(() => ({ submits: new Map<HTMLFormElement, (input: unknown) => unknown>() }));
vi.mock('$app/forms', () => ({
	enhance: (node: HTMLFormElement, submit: (input: unknown) => unknown) => {
		forms.submits.set(node, submit);
		return { destroy: () => forms.submits.delete(node) };
	},
}));

// Delete asks through the kit's confirm dialog, which renders through a
// container the layout mounts and this test does not. The call is captured.
const kit = vi.hoisted(() => ({ confirm: vi.fn(async () => false) }));
vi.mock('@lyeve-labs/ui-kit', async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	confirm: kit.confirm,
}));

import FlowsPage from './+page.svelte';

beforeEach(() => {
	kit.confirm.mockReset();
	kit.confirm.mockResolvedValue(false);
});

afterEach(cleanup);

const licensed: Entitlements = { plan: 'example', state: 'active', features: ['flow'], tenant_quota: 1 };

function setup(overrides: Record<string, unknown> = {}, entitlements = licensed, form: unknown = null) {
	return render(FlowsPage, {
		props: {
			data: {
				flows: [],
				limit: 50,
				offset: 0,
				total: null,
				hasMore: false,
				status: '',
				q: '',
				locked: false,
				gate: { state: 'ok' },
				user: { roles: ['admin'] },
				entitlements,
				...overrides,
			},
			form,
		} as never,
	});
}

describe('flows list page', () => {
	it('lists each flow with its status, trigger, version and last run', () => {
		const active = {
			...fixtureFlow,
			id: 'f2',
			slug: 'active_one',
			name: 'Active one',
			status: 'active' as const,
			version: 3,
			last_run: { id: 'r1', status: 'succeeded' as const, started_at: new Date(Date.now() - 120_000).toISOString(), duration_ms: 40 },
		};
		const { container, getByText } = setup({ flows: [fixtureFlow, active] });
		expect(getByText('Beta')).toBeTruthy();
		const rows = container.querySelectorAll('tbody tr');
		expect(rows).toHaveLength(2);
		expect(rows[0].textContent).toContain('draft');
		expect(rows[0].textContent).toContain('API');
		expect(rows[0].textContent).toContain('unpublished');
		expect(rows[0].textContent).toContain('never');
		expect(rows[1].textContent).toContain('v3');
		expect(rows[1].textContent).toContain('succeeded');
		expect(rows[1].textContent).toContain('2 minutes ago');
		expect((getByText('Active one') as HTMLAnchorElement).getAttribute('href')).toBe('/admin/flows/f2');
	});

	it('offers no templates on an empty list: the editor asks that once there is a canvas', () => {
		const { getByText, container } = setup();
		expect(getByText('No flows yet')).toBeTruthy();
		expect(container.querySelector('[data-testid="flow-templates"]')).toBeNull();
		expect(container.textContent).not.toContain('Nightly sheet export');
	});

	// Each mode changes what an import does to an existing flow, so each says so.
	it('offers the import modes as choices that each say what they do', async () => {
		const { getByText, container } = setup();
		await fireEvent.click(getByText('Import'));
		const form = container.ownerDocument.querySelector('#flow-import-form') as HTMLElement;
		const radios = form.querySelectorAll('input[type="radio"][name="mode"]');
		expect(radios).toHaveLength(2);
		expect(form.textContent).toContain('Its published version runs until you publish again.');
	});

	it('asks for a name and a slug and nothing else', async () => {
		const { getAllByText, container } = setup();
		await fireEvent.click(getAllByText('New flow')[0]);
		const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
		expect(dialog.textContent).toContain('New flow');
		expect(dialog.textContent).not.toContain('Start from');
		expect(dialog.querySelector('#create-from')).toBeNull();
		const form = dialog.querySelector('form[action="?/create"]') as HTMLFormElement;
		expect([...new FormData(form).keys()].sort()).toEqual(['name', 'slug']);
		expect(dialog.querySelectorAll('input:not([type="hidden"])')).toHaveLength(2);
	});

	it('derives the slug from the name until the slug is edited', async () => {
		const { getAllByText, container } = setup();
		await fireEvent.click(getAllByText('New flow')[0]);
		const name = container.querySelector('#create-name') as HTMLInputElement;
		await fireEvent.input(name, { target: { value: 'Orders With Shipments' } });
		const slug = container.querySelector('#create-slug') as HTMLInputElement;
		expect(slug.value).toBe('orders-with-shipments');
	});

	it('asks before deleting and names the flow', async () => {
		const { getByTitle } = setup({ flows: [fixtureFlow] });
		const form = getByTitle('Delete').closest('form') as HTMLFormElement;
		expect(form.getAttribute('action')).toBe('?/delete');
		expect(new FormData(form).get('id')).toBe('f1');

		const cancel = vi.fn();
		await forms.submits.get(form)?.({ cancel });
		// The title asks the question and names the flow. The body says what the
		// delete takes with it.
		expect(kit.confirm).toHaveBeenCalledWith(
			`Delete flow ${fixtureFlow.name}?`,
			expect.stringContaining('run history'),
			{ confirmLabel: 'Delete' },
		);
		expect(cancel).toHaveBeenCalled();

		kit.confirm.mockResolvedValue(true);
		cancel.mockClear();
		const formData = new FormData(form);
		await forms.submits.get(form)?.({ cancel, formData });
		expect(cancel).not.toHaveBeenCalled();
		// The agreed post carries the answer the delete action requires.
		expect(formData.get('confirmed')).toBe('yes');
	});

	it('renders the not-enabled state when the engine answered 402, and nothing to create', () => {
		const locked = setup({ locked: true });
		expect(locked.getByTestId('not-enabled')).toBeTruthy();
		expect(locked.queryByText('New flow')).toBeNull();
	});

	it('shows a failed load as an alert and not as an empty tenant, with nothing to create', () => {
		const { container, queryByText } = setup({ gate: { state: 'error', message: 'Flows could not be read from the engine.' } });
		expect(container.textContent).toContain('Flows could not be read from the engine.');
		expect(queryByText('No flows yet')).toBeNull();
		expect(queryByText('New flow')).toBeNull();
		expect(queryByText('Import')).toBeNull();
		expect(container.querySelector('[data-testid="flow-templates"]')).toBeNull();
	});

	// A role refusal is not an outage, so it offers no reload and no create.
	it('says the role cannot read flows, with nothing to create, filter or reload', () => {
		const { container, queryByText } = setup({ gate: { state: 'forbidden' } });
		expect(container.textContent).toContain('Your role cannot open flows.');
		expect(container.textContent).not.toContain('Reload');
		expect(queryByText('Try again')).toBeNull();
		expect(queryByText('New flow')).toBeNull();
		expect(queryByText('Import')).toBeNull();
		expect(container.querySelector('[data-testid="flow-filters"]')).toBeNull();
	});

	it('links the datasources and the variables only for an admin, whose routes they are', () => {
		const editor = setup({ user: { roles: ['editor'] } });
		expect(editor.container.querySelector('a[href="/admin/flows/datasources"]')).toBeNull();
		expect(editor.container.querySelector('a[href="/admin/flows/variables"]')).toBeNull();
		cleanup();
		const admin = setup();
		expect(admin.container.querySelector('a[href="/admin/flows/datasources"]')).not.toBeNull();
	});

	it('filters by status and search through query parameters', () => {
		const { getByTestId, getByRole } = setup({ status: 'active', q: 'orders', flows: [fixtureFlow] });
		const form = getByTestId('flow-filters') as HTMLFormElement;
		expect(form.getAttribute('method')).toBe('GET');
		expect((form.querySelector('input[name="status"]') as HTMLInputElement).value).toBe('active');
		expect((form.querySelector('input[name="q"]') as HTMLInputElement).value).toBe('orders');
		expect(getByRole('link', { name: 'Active' }).getAttribute('aria-current')).toBe('page');
	});

	it('has no Search button and no Clear link beside the search', () => {
		const { getByTestId, queryByRole } = setup({ status: 'active', q: 'orders', flows: [fixtureFlow] });
		const form = getByTestId('flow-filters');
		expect(form.querySelector('button[type="submit"]')).toBeNull();
		expect(queryByRole('link', { name: 'Clear' })).toBeNull();
	});

	it('offers to clear the filters when nothing matches', () => {
		const { getByRole } = setup({ status: 'active', q: 'orders' });
		expect(getByRole('link', { name: 'Clear filters' }).getAttribute('href')).toBe('/admin/flows');
	});

	it('links each status with the search kept, so one click lands on it', () => {
		// A radio that submits from its change handler runs before the hidden
		// status field re-renders, so a click would post the status it is
		// leaving.
		const { getByRole } = setup({ status: 'draft', q: 'sync', flows: [fixtureFlow] });
		const href = (name: string) => getByRole('link', { name }).getAttribute('href');
		expect(href('All')).toBe('/admin/flows?q=sync');
		expect(href('Active')).toBe('/admin/flows?status=active&q=sync');
		expect(href('Disabled')).toBe('/admin/flows?status=disabled&q=sync');
		expect(getByRole('link', { name: 'Draft' }).getAttribute('aria-current')).toBe('page');
	});

	it('offers blocked in the status filter and draws a blocked flow in the warn tone with the reason on hover', () => {
		const { getByRole, container } = setup({ flows: [fixtureFlow, blockedFlow] });
		expect(getByRole('link', { name: 'Blocked' })).toBeTruthy();
		const rows = container.querySelectorAll('tbody tr');
		const pill = rows[1].querySelector('td:nth-child(3) [class*="rounded-full"]') as HTMLElement;
		expect(pill.textContent?.trim()).toBe('blocked');
		expect(pill.className).toContain('warn');
		expect(pill.className).not.toContain('danger');
		expect(rows[1].querySelector('[role="tooltip"]')?.textContent?.trim()).toBe(BLOCKED_TEXT);
		expect(rows[0].querySelector('[role="tooltip"]')).toBeNull();
		expect(rows[1].textContent).toContain('v2');
	});

	it('keeps the filter row on one height with the search named for the screen reader only', () => {
		const { getByTestId, getByLabelText, getByRole } = setup({ flows: [fixtureFlow] });
		const form = getByTestId('flow-filters');
		const search = getByLabelText('Search flows') as HTMLInputElement;
		expect(search.getAttribute('placeholder')).toBe('Name or slug');
		const label = form.querySelector('label[for="flow-search"]') as HTMLElement;
		expect(label.className).toContain('sr-only');
		// Five statuses are chips that wrap rather than a strip that overflows.
		expect(getByRole('group', { name: 'Status' }).querySelectorAll('a')).toHaveLength(5);
		expect(form.querySelector('[role="toolbar"]')?.className).toContain('items-center');
	});

	it('puts a level 2 heading between the title and the first-run empty state', () => {
		const { container } = setup({ flows: [] });
		const levels = [...container.querySelectorAll('h1, h2, h3')].map((h) => Number(h.tagName.slice(1)));
		expect(levels.some((level, i) => level > (i === 0 ? 1 : levels[i - 1]) + 1)).toBe(false);
		expect(levels).toContain(3);
	});

	it('lists the validation errors a create returned inside the create drawer', async () => {
		const data = { flows: [], limit: 50, offset: 0, total: null, hasMore: false, status: '', q: '', locked: false, gate: { state: 'ok' }, user: { roles: ['admin'] }, entitlements: licensed };
		const { container, getAllByText, rerender } = render(FlowsPage, { props: { data, form: null } as never });
		await fireEvent.click(getAllByText('New flow')[0]);
		await rerender({
			data,
			form: {
				action: 'create',
				error: 'Fix the problems in the definition.',
				errors: [
					{ node_id: 'join', path: '/config/left_key', message: 'required' },
					{ path: '/settings/timeout', message: 'not a duration' },
				] satisfies ValidationError[],
			},
		} as never);
		const drawer = container.ownerDocument.querySelector('#flow-create-form') as HTMLElement;
		expect(drawer.textContent).toContain('Fix the problems in the definition.');
		expect(drawer.textContent).toContain('join /config/left_key: required');
		expect(drawer.textContent).toContain('/settings/timeout: not a duration');
		expect(drawer.textContent).not.toContain('undefined');
	});

	it('puts a taken slug at the slug field inside the create drawer', async () => {
		const data = { flows: [], limit: 50, offset: 0, total: null, hasMore: false, status: '', q: '', locked: false, gate: { state: 'ok' }, user: { roles: ['admin'] }, entitlements: licensed };
		const { container, getAllByText, rerender } = render(FlowsPage, { props: { data, form: null } as never });
		await fireEvent.click(getAllByText('New flow')[0]);
		await rerender({ data, form: { action: 'create', error: 'Another flow already uses this slug. Choose another.', field: 'slug' } } as never);
		const slug = container.ownerDocument.querySelector('#create-slug') as HTMLInputElement;
		expect(slug.getAttribute('aria-invalid')).toBe('true');
		const described = (slug.getAttribute('aria-describedby') ?? '').split(' ').map((id) => container.ownerDocument.getElementById(id)?.textContent ?? '');
		expect(described.join(' ')).toContain('Another flow already uses this slug');
	});

	// The drawers and the row's delete share one form result.
	it('shows a failed delete on the page and not in a drawer opened after it', async () => {
		const { container, getAllByText, getByText } = setup({ flows: [fixtureFlow] }, licensed, { action: 'delete', error: 'Could not delete the flow. Try again.' });
		expect(container.textContent).toContain('Could not delete the flow. Try again.');

		await fireEvent.click(getAllByText('New flow')[0]);
		expect((container.ownerDocument.querySelector('#flow-create-form') as HTMLElement).textContent).not.toContain('Could not delete the flow. Try again.');

		await fireEvent.click(getByText('Import'));
		expect((container.ownerDocument.querySelector('#flow-import-form') as HTMLElement).textContent).not.toContain('Could not delete the flow. Try again.');
	});

	it('keeps a failed import out of the page behind the drawer', () => {
		const { container } = setup({}, licensed, { action: 'import', error: 'Paste a definition or choose a file.' });
		expect(container.textContent).not.toContain('Paste a definition or choose a file.');
	});
});

describe('flows list row links', () => {
	it('carry the live filter so the editor can hand it back', () => {
		const { container } = setup({ flows: [fixtureFlow], status: 'draft', q: 'sync' });
		const link = container.querySelector(`tbody a[href^="/admin/flows/${fixtureFlow.id}"]`);
		expect(link?.getAttribute('href')).toBe(`/admin/flows/${fixtureFlow.id}?status=draft&q=sync`);
	});

	it('stay a clean path when nothing is filtered', () => {
		const { container } = setup({ flows: [fixtureFlow] });
		const link = container.querySelector(`tbody a[href^="/admin/flows/${fixtureFlow.id}"]`);
		expect(link?.getAttribute('href')).toBe(`/admin/flows/${fixtureFlow.id}`);
	});
});

describe('flows list page ceiling', () => {
	// The ceiling refuses a create, so it shows in the drawer that asked.
	it('shows the refusal with the limit the plugin sent inside the create drawer', async () => {
		const { container, getAllByText, rerender } = setup();
		await fireEvent.click(getAllByText('New flow')[0]);
		await rerender({
			data: { flows: [], limit: 50, offset: 0, total: null, hasMore: false, status: '', q: '', locked: false, gate: { state: 'ok' }, user: { roles: ['admin'] }, entitlements: licensed },
			form: { action: 'create', error: '7 of 7 flows are in use, the most this instance keeps. A license that allows more lifts the limit. Deleting one also makes room.', refusal: { nodeIds: [], limit: 7, current: 7, upgradeUrl: '' } },
		} as never);
		const drawer = container.ownerDocument.querySelector('#flow-create-form') as HTMLElement;
		expect(drawer.textContent).toContain('7 of 7 flows are in use');
	});

	it('links where the plugin says more flows are bought, named by what it opens, in a new tab', async () => {
		const link = 'https://shop.example.com/pricing?skus=example-pro&utm_campaign=flow.flows';
		const { container, getAllByText, rerender } = setup();
		await fireEvent.click(getAllByText('New flow')[0]);
		await rerender({
			data: { flows: [], limit: 50, offset: 0, total: null, hasMore: false, status: '', q: '', locked: false, gate: { state: 'ok' }, user: { roles: ['admin'] }, entitlements: licensed },
			form: { action: 'create', error: '7 of 7 flows are in use, the most this instance keeps. A license that allows more lifts the limit. Deleting one also makes room.', refusal: { nodeIds: [], limit: 7, current: 7, upgradeUrl: link } },
		} as never);
		const drawer = container.ownerDocument.querySelector('#flow-create-form') as HTMLElement;
		const a = drawer.querySelector(`a[href="${link}"]`) as HTMLAnchorElement;
		expect(a.textContent).toBe('View the add-on');
		expect(a.getAttribute('target')).toBe('_blank');
		expect(a.getAttribute('rel')).toBe('noopener noreferrer');
		// One line of small text, so it takes the touch hit area.
		expect(a.classList.contains('hit-area') && a.classList.contains('relative')).toBe(true);
	});
});

describe('flows list page role grants', () => {
	it('hides create and import when the list says the caller may not create', () => {
		const { queryByText } = setup({ flows: [fixtureFlow], canCreate: false });
		expect(queryByText('New flow')).toBeNull();
		expect(queryByText('Import')).toBeNull();
	});

	it('draws delete only on the flows whose actions carry it', () => {
		const other = { ...fixtureFlow, id: 'f2', slug: 'send-receipt', name: 'Send receipt', actions: ['read', 'delete'] };
		const { getByLabelText, queryByLabelText } = setup({ flows: [{ ...fixtureFlow, actions: ['read', 'update'] }, other] });
		expect(getByLabelText('Delete Send receipt')).toBeTruthy();
		expect(queryByLabelText(`Delete ${fixtureFlow.name}`)).toBeNull();
	});

	it('draws everything when the engine carries no grants', () => {
		const { getAllByText, getByTitle } = setup({ flows: [fixtureFlow] });
		expect(getAllByText('New flow').length).toBeGreaterThan(0);
		expect(getByTitle('Delete')).toBeTruthy();
	});

	it('renders a 403 inline as a role refusal', () => {
		const { container } = render(FlowsPage, {
			props: {
				data: { flows: [], limit: 50, offset: 0, total: null, hasMore: false, status: '', q: '', locked: false, gate: { state: 'ok' }, user: { roles: ['admin'] }, entitlements: licensed, canCreate: true },
				form: { action: 'delete', error: 'permission denied: delete on flows', forbidden: true },
			} as never,
		});
		expect(container.textContent).toContain('Your role cannot do that');
		expect(container.textContent).toContain('delete on flows');
	});
});

describe('flow name link', () => {
	// The name is the only way to open a flow, and its link is 17px tall.
	it('gives the link that opens a flow a touch hit area', () => {
		const { getByText } = setup({ flows: [fixtureFlow] });
		const link = getByText(fixtureFlow.name).closest('a') as HTMLElement;
		expect(link.className).toContain('relative');
		expect(link.className).toContain('hit-area');
	});

	describe('search as you type', () => {
		let submit: ReturnType<typeof vi.spyOn>;
		beforeEach(() => {
			vi.useFakeTimers();
			submit = vi.spyOn(HTMLFormElement.prototype, 'requestSubmit').mockImplementation(function (this: HTMLFormElement) {
				this.dispatchEvent(new Event('submit', { cancelable: true }));
			});
		});
		afterEach(() => {
			submit.mockRestore();
			vi.useRealTimers();
		});

		const field = (container: HTMLElement) => container.querySelector('input[name="q"]') as HTMLInputElement;
		const type = async (input: HTMLInputElement, value: string) => {
			input.value = value;
			await fireEvent.input(input);
		};

		it('loads once typing pauses, keeping focus, the history entry and the scroll', async () => {
			const { container, getByTestId } = setup({ flows: [fixtureFlow] });
			const form = getByTestId('flow-filters');
			expect(form.hasAttribute('data-sveltekit-keepfocus')).toBe(true);
			expect(form.hasAttribute('data-sveltekit-replacestate')).toBe(true);
			expect(form.hasAttribute('data-sveltekit-noscroll')).toBe(true);
			await type(field(container), 'o');
			await type(field(container), 'or');
			await vi.advanceTimersByTimeAsync(299);
			expect(submit).not.toHaveBeenCalled();
			await vi.advanceTimersByTimeAsync(1);
			expect(submit).toHaveBeenCalledTimes(1);
		});

		it('loads nothing for the query already on screen', async () => {
			const { container } = setup({ q: 'orders', flows: [fixtureFlow] });
			await type(field(container), 'orders ');
			await vi.advanceTimersByTimeAsync(300);
			expect(submit).not.toHaveBeenCalled();
		});

		it('loads the empty query at once when the field is cleared, and keeps focus in it', async () => {
			const { container, getByRole } = setup({ q: 'orders', flows: [fixtureFlow] });
			await fireEvent.click(getByRole('button', { name: 'Clear search' }));
			await vi.advanceTimersByTimeAsync(0);
			expect(submit).toHaveBeenCalledTimes(1);
			expect(field(container).value).toBe('');
			expect(document.activeElement).toBe(field(container));
		});

		it('drops the wait when Enter submits', async () => {
			const { container, getByTestId } = setup({ flows: [fixtureFlow] });
			await type(field(container), 'ord');
			await fireEvent.submit(getByTestId('flow-filters'));
			await vi.advanceTimersByTimeAsync(300);
			expect(submit).not.toHaveBeenCalled();
		});

		it('keeps what was typed while its own load ran, and follows a load from elsewhere', async () => {
			const view = setup({ flows: [fixtureFlow] });
			await type(field(view.container), 'ord');
			await vi.advanceTimersByTimeAsync(300);
			await type(field(view.container), 'orde');
			const data = (q: string) => ({
				flows: [fixtureFlow], limit: 50, offset: 0, total: null, hasMore: false, status: '', q,
				locked: false, gate: { state: 'ok' }, user: { roles: ['admin'] }, entitlements: licensed,
			});
			await view.rerender({ data: data('ord'), form: null } as never);
			expect(field(view.container).value).toBe('orde');
			await view.rerender({ data: data('sync'), form: null } as never);
			expect(field(view.container).value).toBe('sync');
		});
	});
});

