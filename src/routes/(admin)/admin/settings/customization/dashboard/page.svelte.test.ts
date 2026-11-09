// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));

import EditorPage from './+page.svelte';
import { outlineSkips } from '$lib/test-outline';

afterEach(cleanup);

function mount(widgets: unknown[] = [], custom = false, running: string[] = ['content', 'media', 'audit']) {
	render(EditorPage, {
		props: {
			data: {
				layout: { entitled: true, custom, widgets, updated_at: custom ? '2026-09-26T10:00:00Z' : null },
				schemas: ['posts', 'authors'],
				schemasGate: { state: 'ok' },
				plugins: { state: 'named', running, withheld: [] },
				user: { roles: ['admin'] },
				gate: { state: 'ok' },
				entitled: true,
				pages: [],
				homePage: '',
			},
			form: null,
		} as never,
	});
}

describe('dashboard editor page', () => {
	it('is marked beta and says the stock dashboard is showing', () => {
		mount();
		expect(screen.getByText('Beta')).toBeTruthy();
		expect(screen.getByTestId('layout-state').textContent).toMatch(/stock dashboard/);
	});

	// A stored widget omits its empty fields, and binding a kit input to
	// undefined throws during the mount.
	it('opens a stored layout whose widgets omit their empty fields', () => {
		expect(() =>
			mount(
				[
					{ id: 'a', type: 'latest_entries', limit: 5 },
					{ id: 'b', type: 'text', body: 'Hi' },
					{ id: 'c', type: 'links', links: [{ label: 'Docs', url: 'https://d.e' }] },
				],
				true,
			),
		).not.toThrow();
		expect(screen.getAllByLabelText('Heading')).toHaveLength(3);
		expect(screen.getByTestId('layout-state').textContent).toMatch(/3\s+widgets/);
	});

	it('offers only the widgets whose plugin runs', () => {
		mount();
		expect(screen.getByRole('button', { name: 'Add latest entries' })).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Add API usage' })).toBeNull();
	});

	it('adds, reorders and removes widgets', async () => {
		mount();
		await fireEvent.click(screen.getByRole('button', { name: 'Add media usage' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Add text' }));
		expect(screen.getByText('1. Media usage')).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Move widget 2 up' }));
		expect(screen.getByText('1. Text')).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Remove widget 1' }));
		expect(screen.queryByText('1. Text')).toBeNull();
		expect(screen.getByText('1. Media usage')).toBeTruthy();
	});

	it('starts from a layout close to the stock dashboard', async () => {
		mount();
		await fireEvent.click(screen.getByRole('button', { name: /Start from the stock layout/ }));
		expect(screen.getByText('1. Entry counts')).toBeTruthy();
		expect(screen.getAllByRole('button', { name: /^Remove widget/ }).length).toBeGreaterThan(3);
	});
});

describe('dashboard widget controls', () => {
	function mountWith(widgets: unknown[], schemasRead: boolean | 'forbidden' = true, schemas = ['posts', 'authors']) {
		return render(EditorPage, {
			props: {
				data: {
					layout: { entitled: true, custom: true, widgets, updated_at: null },
					schemas,
					schemasGate: schemasRead === 'forbidden' ? { state: 'forbidden' } : schemasRead ? { state: 'ok' } : { state: 'error', message: 'Could not load content types. Widgets keep the content types they already use.' },
					plugins: { state: 'named', running: ['content', 'media', 'audit'], withheld: [] },
					user: { roles: ['admin'] },
					gate: { state: 'ok' },
					entitled: true,
					pages: [],
					homePage: '',
				},
				form: null,
			} as never,
		});
	}

	it('picks the status from a segmented control and the counted schemas from a searchable list', () => {
		const { container } = mountWith([
			{ id: 'a', type: 'latest_entries', limit: 5, status: 'draft' },
			{ id: 'b', type: 'entry_counts', schemas: ['posts'] },
		]);
		expect(screen.getByRole('radiogroup', { name: 'Status' })).toBeTruthy();
		expect(screen.getByRole('radio', { name: 'Draft' }).getAttribute('aria-checked')).toBe('true');
		expect(container.querySelector('#widget-a-status')).toBeNull();
		expect(container.querySelector('#widget-b-schemas')).toBeTruthy();
		expect(container.querySelectorAll('input[type="checkbox"]').length).toBe(6);
	});

	it('names the schema list in lower case inside the role refusal', () => {
		const { container } = mountWith([], 'forbidden', []);
		expect(container.textContent).toContain('Your role cannot open the content type list.');
	});

	it('keeps the schemas a widget names on screen when the schema list was not read', () => {
		const { container } = mountWith([{ id: 'b', type: 'entry_counts', schemas: ['orders'] }], false, []);
		expect(container.textContent).toContain('Could not load content types');
		expect(container.textContent).not.toContain('No content types to count yet');
		expect(container.querySelector('#widget-b-schemas')?.closest('div')?.parentElement?.textContent).toContain('orders');
	});
});

const welcome = { slug: 'welcome', title: 'Welcome', roles: [], position: 0 };

function tab(over: Record<string, unknown> = {}, form: unknown = null) {
	return {
		data: {
			layout: { entitled: true, custom: false, widgets: [], updated_at: null },
			schemas: ['posts'],
			schemasGate: { state: 'ok' },
			plugins: { state: 'named', running: ['content', 'media', 'audit'], withheld: [] },
			user: { roles: ['admin'] },
			gate: { state: 'ok' },
			entitled: true,
			pages: [welcome],
			homePage: '',
			...over,
		},
		form,
	} as never;
}

// The page above the dashboard moved here from the customization page, so
// the dashboard and what leads it are chosen in one place.
describe('the page above the dashboard', () => {
	it('offers the tenant pages above the widgets', () => {
		const { container } = render(EditorPage, { props: tab() });
		const select = container.querySelector('#home-page');
		expect(select).toBeTruthy();
		const widgets = screen.getByRole('heading', { name: 'Widgets' });
		expect(select!.compareDocumentPosition(widgets) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
	});

	it('points at the Pages tab while there is no page to choose', () => {
		const { container } = render(EditorPage, { props: tab({ pages: [] }) });
		expect(container.querySelector('#home-page')).toBeNull();
		expect(container.textContent).toContain('Create one under Pages first.');
	});

	it('shows a failed save beside its own form, not over the widgets', () => {
		const { container } = render(EditorPage, { props: tab({}, { pagesError: 'Could not save the dashboard page. Try again.' }) });
		const alert = screen.getByText('Could not save the dashboard page. Try again.');
		const following = (a: Node, b: Node) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
		expect(following(screen.getByRole('tablist'), alert)).toBe(true);
		expect(following(alert, container.querySelector('#home-page')!)).toBe(true);
	});

	// Saving the page above the dashboard reruns the load, which used to copy
	// the stored layout over the widgets being edited.
	it('keeps unsaved widgets when the page above the dashboard is saved', async () => {
		const { rerender } = render(EditorPage, { props: tab() });
		await fireEvent.click(screen.getByRole('button', { name: 'Add text' }));
		expect(screen.getByText('1. Text')).toBeTruthy();
		await rerender(tab({ homePage: 'welcome' }, { homeSaved: true }));
		expect(screen.getByText('1. Text')).toBeTruthy();
	});
});

describe('the dashboard tab when customization is closed', () => {
	it('says the engine did not answer rather than that customization is not enabled', () => {
		const { container } = render(EditorPage, { props: tab({ gate: { state: 'unavailable' }, entitled: false }) });
		expect(container.textContent).toContain('so customization did not load');
		expect(screen.queryByRole('heading', { name: 'Widgets' })).toBeNull();
	});

	it('steps its headings down one level at a time while the feature is not enabled', () => {
		const { container } = render(EditorPage, { props: tab({ entitled: false }) });
		expect(container.querySelector('[data-testid="not-enabled"]')).toBeTruthy();
		expect(outlineSkips(container)).toEqual([]);
	});
});
