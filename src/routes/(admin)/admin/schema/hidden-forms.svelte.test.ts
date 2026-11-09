// @vitest-environment jsdom
import { render, cleanup, fireEvent, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SubmitFunction } from '@sveltejs/kit';
import type { PageData } from './$types';

// Each form's submit function, by its action, so a case can play the round trip.
const forms = vi.hoisted(() => ({ handlers: new Map<string, SubmitFunction>() }));
vi.mock('$app/forms', () => ({
	enhance: (el: HTMLFormElement, fn?: SubmitFunction) => {
		if (fn) forms.handlers.set(el.getAttribute('action') ?? '', fn);
		return { destroy() {} };
	},
}));
const nav = vi.hoisted(() => ({ invalidate: vi.fn(async (_dep: string) => {}), invalidateAll: vi.fn(async () => {}) }));
vi.mock('$app/navigation', () => ({ beforeNavigate: vi.fn(), goto: vi.fn(async () => {}), invalidateAll: nav.invalidateAll, invalidate: nav.invalidate }));
const state = vi.hoisted(() => ({ page: { url: new URL('http://localhost/admin/schema') } }));
vi.mock('$app/state', () => state);
vi.mock('$lib/canvas/schema', () => ({ SchemaCanvas: null, hasSchemaCanvas: false }));

const kit = vi.hoisted(() => ({ confirm: vi.fn(async (_title: string, _body: string, _opts?: unknown) => false) }));
vi.mock('@lyeve-labs/ui-kit', async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>();
	return { ...actual, confirm: kit.confirm };
});

import SchemaPage from './+page.svelte';

afterEach(cleanup);
beforeEach(() => {
	forms.handlers.clear();
	nav.invalidate.mockClear();
	nav.invalidateAll.mockReset();
	kit.confirm.mockReset();
	kit.confirm.mockResolvedValue(false);
	// The page submits its hidden forms itself. The test plays each round
	// trip through the captured submit function instead.
	HTMLFormElement.prototype.requestSubmit = vi.fn();
});

function data(overrides: Record<string, unknown> = {}): PageData {
	return {
		schemas: [{ name: 'posts', display_name: 'Posts', fields: [{ id: 'f1', name: 'title', field_type: 'text', required: false, unique: false, indexed: false }] }],
		rowCounts: {},
		presets: [],
		presetsGate: null,
		canWrite: true,
		isSuperAdmin: true,
		loadGate: null,
		...overrides,
	} as unknown as PageData;
}

/** Runs one captured submit with the result the action answered. */
async function play(action: string, result: unknown) {
	const submit = forms.handlers.get(action);
	if (!submit) throw new Error(`no form for ${action}`);
	const after = (await submit({ formData: new FormData(), cancel() {} } as never)) as (a: unknown) => Promise<void>;
	await after({ result, update: async () => {} });
}

describe('schema confirmations with a row count nobody read', () => {
	it('says the count is unknown when deleting rather than calling the table empty', async () => {
		render(SchemaPage, { props: { data: data(), form: null } });
		await fireEvent.click(screen.getByRole('button', { name: 'Posts' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Delete schema posts' }));

		await waitFor(() => expect(kit.confirm).toHaveBeenCalled());
		const [title, body] = kit.confirm.mock.calls[0] ?? [];
		expect(title).toBe('Delete schema posts?');
		expect(body).toContain('every row in it');
		expect(body).toContain('Could not count the rows');
		expect(body).toContain('cannot be undone');
	});

	it('names the count it did read', async () => {
		render(SchemaPage, { props: { data: data({ rowCounts: { posts: 7 } }), form: null } });
		await new Promise((r) => setTimeout(r, 0));
		await fireEvent.click(screen.getByRole('button', { name: 'Posts' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Delete schema posts' }));

		await waitFor(() => expect(kit.confirm).toHaveBeenCalled());
		expect(kit.confirm.mock.calls[0]?.[1]).toContain('all 7 rows');
	});

	it('says the count is unknown before applying queued drops', async () => {
		render(SchemaPage, { props: { data: data(), form: null } });
		await fireEvent.click(screen.getByRole('button', { name: 'Posts' }));
		await fireEvent.click(screen.getByRole('tab', { name: /History/ }));
		await play('?/history', { type: 'success', data: { name: 'posts', entries: [], pending: 2, limit: 200 } });

		await fireEvent.click(await screen.findByRole('button', { name: 'Apply' }));
		await waitFor(() => expect(kit.confirm).toHaveBeenCalled());
		const body = kit.confirm.mock.calls[0]?.[1] ?? '';
		expect(body).toContain('Could not count the rows');
		expect(body).not.toContain('has 0 rows');
	});
});

describe('schema history', () => {
	it('draws placeholders while the history is read', async () => {
		render(SchemaPage, { props: { data: data(), form: null } });
		await fireEvent.click(screen.getByRole('button', { name: 'Posts' }));
		await fireEvent.click(screen.getByRole('tab', { name: /History/ }));
		const submit = forms.handlers.get('?/history') as SubmitFunction;
		await submit({ formData: new FormData(), cancel() {} } as never);

		expect(await screen.findByTestId('schema-history-loading')).toBeTruthy();
	});

	it('offers to read a failed history again', async () => {
		render(SchemaPage, { props: { data: data(), form: null } });
		await fireEvent.click(screen.getByRole('button', { name: 'Posts' }));
		await fireEvent.click(screen.getByRole('tab', { name: /History/ }));
		await play('?/history', { type: 'failure', data: { error: 'The engine did not answer.' } });

		expect(await screen.findByText('Could not load the history')).toBeTruthy();
		expect(screen.queryByText('No history for this table yet.')).toBeNull();
		const asked = vi.mocked(HTMLFormElement.prototype.requestSubmit).mock.calls.length;
		await fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
		expect(vi.mocked(HTMLFormElement.prototype.requestSubmit).mock.calls.length).toBe(asked + 1);
	});

	it('keeps a failed apply on screen after the history is read again', async () => {
		render(SchemaPage, { props: { data: data(), form: null } });
		await fireEvent.click(screen.getByRole('button', { name: 'Posts' }));
		await fireEvent.click(screen.getByRole('tab', { name: /History/ }));
		await play('?/history', { type: 'success', data: { name: 'posts', entries: [], pending: 1, limit: 200 } });

		await play('?/applyPending', { type: 'failure', data: { error: 'The queued changes could not be applied.' } });
		// The page reads the history again after an apply, and that read starts clean.
		const submit = forms.handlers.get('?/history') as SubmitFunction;
		await submit({ formData: new FormData(), cancel() {} } as never);

		expect(await screen.findByText('The queued changes could not be applied.')).toBeTruthy();
	});
});

/*
 * The header's pending count is the shell's data, which SvelteKit keeps across
 * a client-side navigation. A save can queue a drop and an apply runs them, so
 * each has to tell the shell to read the count again.
 */
describe('the header count after a write', () => {
	it('reads the count again after a save', async () => {
		render(SchemaPage, { props: { data: data(), form: null } });
		await fireEvent.click(screen.getByRole('button', { name: 'Posts' }));
		const stored = data().schemas[0];

		await play('?/save', { type: 'success', data: { saved: stored } });

		expect(nav.invalidate).toHaveBeenCalledWith('app:migrations');
	});

	it('reads the count again after the queued changes are applied', async () => {
		render(SchemaPage, { props: { data: data(), form: null } });
		await fireEvent.click(screen.getByRole('button', { name: 'Posts' }));
		await fireEvent.click(screen.getByRole('tab', { name: /History/ }));
		await play('?/history', { type: 'success', data: { name: 'posts', entries: [], pending: 1, limit: 200 } });

		await play('?/applyPending', { type: 'success', data: { applied: 1 } });

		expect(nav.invalidate).toHaveBeenCalledWith('app:migrations');
	});

	// Deleting the last definition of a table clears its queued rows from the log.
	it('reads the count again after a delete', async () => {
		render(SchemaPage, { props: { data: data(), form: null } });
		await fireEvent.click(screen.getByRole('button', { name: 'Posts' }));

		await play('?/delete', { type: 'success', data: { deleted: 'posts' } });

		expect(nav.invalidate).toHaveBeenCalledWith('app:migrations');
	});

	it('reads the count again after an apply that failed part way', async () => {
		render(SchemaPage, { props: { data: data(), form: null } });
		await fireEvent.click(screen.getByRole('button', { name: 'Posts' }));
		await fireEvent.click(screen.getByRole('tab', { name: /History/ }));
		await play('?/history', { type: 'success', data: { name: 'posts', entries: [], pending: 2, limit: 200 } });

		await play('?/applyPending', { type: 'failure', data: { error: 'The queued changes could not be applied.' } });

		expect(nav.invalidate).toHaveBeenCalledWith('app:migrations');
	});
});

describe('schema import failure', () => {
	it('shows the failure at the top of the form, above the fields', async () => {
		render(SchemaPage, { props: { data: data(), form: null } });
		await fireEvent.click(screen.getByRole('button', { name: 'Import and export' }));
		await fireEvent.click(screen.getByRole('menuitem', { name: /^Import$/ }));
		await play('?/import', { type: 'failure', data: { error: 'The file is not YAML.' } });

		const message = await screen.findByText('The file is not YAML.');
		const form = message.closest('form') as HTMLFormElement;
		expect(form.getAttribute('action')).toBe('?/import');
		const firstField = form.querySelector('#import-source, [id^="import-source"]') as HTMLElement;
		expect(message.compareDocumentPosition(firstField) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
	});
});

describe('a content type that changed since it was opened', () => {
	const versioned = (version: string, fields: { name: string }[]) => ({
		name: 'posts',
		display_name: 'Posts',
		version,
		fields: fields.map((f) => ({ ...f, field_type: 'text', required: false, unique: false, indexed: false })),
	});
	const sentVersion = () => (document.querySelector('form[action="?/save"] input[name="version"]') as HTMLInputElement).value;

	it('sends the version it opened, and takes the one a rename stored', async () => {
		render(SchemaPage, { props: { data: data({ schemas: [versioned('v1', [{ name: 'title' }])] }), form: null } });
		await fireEvent.click(screen.getByRole('button', { name: 'Posts' }));
		expect(sentVersion()).toBe('v1');

		await play('?/save', { type: 'failure', data: { error: 'Could not save the schema. Try again.', renamed: [{ from: 'title', to: 'headline' }], version: 'v2' } });

		await waitFor(() => expect(sentVersion()).toBe('v2'));
		expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull();
	});

	it('offers to reload it, and opens it as the engine holds it now', async () => {
		const view = render(SchemaPage, { props: { data: data({ schemas: [versioned('v1', [{ name: 'title' }])] }), form: null } });
		await fireEvent.click(screen.getByRole('button', { name: 'Posts' }));
		nav.invalidateAll.mockImplementation(async () => {
			await view.rerender({ data: data({ schemas: [versioned('v2', [{ name: 'title' }, { name: 'summary' }])] }), form: null });
		});

		await play('?/save', { type: 'failure', data: { error: 'Someone changed this schema after you opened it. Reload it to see the latest version, then make your change again.', stale: true, renamed: [] } });
		expect(await screen.findByText('Someone changed this schema after you opened it. Reload it to see the latest version, then make your change again.')).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Reload' }));

		await waitFor(() => expect(sentVersion()).toBe('v2'));
		expect(nav.invalidateAll).toHaveBeenCalledOnce();
		expect(screen.getByDisplayValue('summary')).toBeTruthy();
		expect(screen.queryByTestId('save-error')).toBeNull();
	});
});
