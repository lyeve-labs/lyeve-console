// @vitest-environment jsdom
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

// enhance keeps each form's submit handler, so a case can run the one a
// row's delete would run.
const forms = vi.hoisted(() => ({ submits: new Map<HTMLFormElement, (input: unknown) => unknown>() }));
vi.mock('$app/forms', () => ({
	enhance: (node: HTMLFormElement, submit: (input: unknown) => unknown) => {
		forms.submits.set(node, submit);
		return { destroy: () => forms.submits.delete(node) };
	},
}));
const kit = vi.hoisted(() => ({ confirm: vi.fn(async () => true) }));
vi.mock('@lyeve-labs/ui-kit', async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	confirm: kit.confirm,
}));

import PersistedPage from './+page.svelte';

afterEach(cleanup);

const props = (over: Record<string, unknown> = {}, form: unknown = null) => ({
	data: {
		gate: { state: 'ok' },
		persisted: { ok: true, value: [] },
		persistedTotal: 0,
		limit: 50,
		offset: 0,
		...over,
	} as never,
	form: form as never,
});

describe('Persisted queries', () => {
	it('says a failed read failed rather than that there are none, and offers no create', () => {
		const { container, queryByText, queryByRole } = render(PersistedPage, {
			props: props({ persisted: { ok: false, gate: { state: 'forbidden' } } }),
		});
		expect(container.textContent).toContain('Your role cannot open persisted queries');
		expect(queryByText('No persisted queries yet')).toBeNull();
		expect(queryByRole('button', { name: 'New persisted query' })).toBeNull();
	});

	it('offers the create from the first-run state', () => {
		const { getByText, getAllByRole } = render(PersistedPage, { props: props() });
		expect(getByText('No persisted queries yet')).toBeTruthy();
		expect(getAllByRole('button', { name: 'New persisted query' })).toHaveLength(2);
	});
});

describe('the register drawer', () => {
	const drawerText = () => document.body.querySelector('form#persisted-form')?.textContent ?? '';
	const query = { query_hash: 'abc123', query: '{ posts { id } }', operation_name: 'Posts', description: '', enabled: true, auto_registered: false };

	it('shows a refused register inside the open drawer', async () => {
		const { getAllByRole, rerender } = render(PersistedPage, { props: props() });
		await fireEvent.click(getAllByRole('button', { name: 'New persisted query' })[0]);
		await rerender(props({}, { action: 'register', error: 'Could not register the query. Try again.' }));
		expect(drawerText()).toContain('Could not register the query. Try again.');
	});

	it('shows a failed delete above the list and leaves a newly opened drawer clean', async () => {
		const failed = 'Could not delete the query. Try again.';
		const { container, getByRole } = render(PersistedPage, {
			props: props({ persisted: { ok: true, value: [query] } }, { action: 'delete', error: failed }),
		});
		expect(container.textContent).toContain(failed);
		await fireEvent.click(getByRole('button', { name: 'New persisted query' }));
		expect(drawerText()).not.toContain(failed);
	});
});

describe('persisted query delete', () => {
	it('names the query and sends its hash', async () => {
		const query = { query_hash: 'abc123', query: '{ posts { id } }', operation_name: 'Posts', description: '', enabled: true, auto_registered: false };
		const { getByRole } = render(PersistedPage, { props: props({ persisted: { ok: true, value: [query] } }) });
		const form = getByRole('button', { name: 'Delete Posts' }).closest('form') as HTMLFormElement;
		expect(new FormData(form).get('hash')).toBe('abc123');
		await forms.submits.get(form)?.({ cancel: vi.fn(), formData: new FormData(form) });
		expect(kit.confirm).toHaveBeenCalledWith(
			'Delete persisted query Posts?',
			'Clients that send only its hash will be refused.',
			{ confirmLabel: 'Delete' },
		);
	});
});

describe('a persisted query list past one page', () => {
	const query = { query_hash: 'abc123def456', operation_name: 'Landing', query: '{ x }', description: '', enabled: true };

	it('pages through the rest rather than leaving them out', () => {
		const { container } = render(PersistedPage, { props: props({ persisted: { ok: true, value: [query] }, persistedTotal: 340 }) });
		const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
		expect(hrefs).toContain('/admin/settings/graphql/persisted?limit=50&offset=50');
		expect(container.textContent).not.toContain('Showing the first');
	});

	it('offers no other page when the list is whole', () => {
		const { container } = render(PersistedPage, { props: props({ persisted: { ok: true, value: [query] }, persistedTotal: 1 }) });
		const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? '');
		expect(hrefs.filter((h) => h.includes('offset='))).toEqual([]);
	});
});

describe('the persisted queries tab', () => {
	it('marks its own tab and says the plugin is absent rather than offering a create', () => {
		const { getByRole, container, queryByRole } = render(PersistedPage, {
			props: props({ gate: { state: 'absent' }, persisted: { ok: false, gate: { state: 'absent' } } }),
		});
		expect(getByRole('tab', { name: 'Persisted queries' }).getAttribute('aria-selected')).toBe('true');
		expect(container.textContent).toContain('GraphQL is not included in this build.');
		expect(queryByRole('button', { name: 'New persisted query' })).toBeNull();
	});
});
