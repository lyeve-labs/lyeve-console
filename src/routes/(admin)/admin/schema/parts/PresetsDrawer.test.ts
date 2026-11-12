// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SubmitFunction } from '@sveltejs/kit';

const forms = vi.hoisted(() => ({ handlers: new Map<string, SubmitFunction>() }));
vi.mock('$app/forms', () => ({
	enhance: (el: HTMLFormElement, fn?: SubmitFunction) => {
		// Each card posts its own id, so a card's handler is keyed by it and no
		// case depends on the order the cards registered in.
		const id = el.querySelector<HTMLInputElement>('input[name="id"]')?.value;
		const action = el.getAttribute('action') ?? '';
		if (fn) forms.handlers.set(id ? `${action}#${id}` : action, fn);
		return { destroy() {} };
	},
}));
const kit = vi.hoisted(() => ({ confirm: vi.fn(async (_title: string, _body: string, _opts?: unknown) => true) }));
vi.mock('@lyeve-labs/ui-kit', async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>();
	return { ...actual, confirm: kit.confirm };
});

import PresetsDrawer from './PresetsDrawer.svelte';

afterEach(cleanup);
beforeEach(() => {
	forms.handlers.clear();
	kit.confirm.mockClear();
	HTMLFormElement.prototype.requestSubmit = vi.fn();
});

const presets = [
	{ id: 'notes', name: 'Notes', description: 'Short notes.', schemas: [{ name: 'notes' }, { name: 'note_tags' }] },
	{ id: 'mine', name: 'Mine', description: 'Kept by the tenant.', source: 'saved', source_url: 'https://example.com/p.json', schemas: [{ name: 'mine' }] },
];

function setup(props: Record<string, unknown> = {}) {
	return render(PresetsDrawer, {
		props: { open: true, presets, presetsGate: null, canWrite: true, canSavePresets: true, applyFailure: null, deleteFailure: '', ...props } as never,
	});
}

async function answer(action: string, result: unknown) {
	const submit = forms.handlers.get(action) as SubmitFunction;
	const after = (await submit({} as never)) as (a: unknown) => Promise<void>;
	await after({ result, update: async () => {}, formElement: document.createElement('form') });
}

describe('PresetsDrawer', () => {
	it('lists what each preset creates and posts its id from its own card', () => {
		setup();
		const created = screen.getByRole('list', { name: 'Content types Notes creates' });
		expect([...created.querySelectorAll('code')].map((c) => c.textContent)).toEqual(['notes', 'note_tags']);
		const form = screen.getAllByRole('button', { name: 'Create' })[0].closest('form') as HTMLFormElement;
		expect(form.getAttribute('action')).toBe('?/preset');
		expect(new FormData(form).get('id')).toBe('notes');
	});

	it('shows an apply failure under the card it names and nowhere else', () => {
		setup({ applyFailure: { preset: 'notes', error: 'schema notes already exists' } });
		const [notes, mine] = [...screen.getByTestId('preset-gallery').children];
		expect(notes.textContent).toContain('schema notes already exists');
		expect(mine.textContent).not.toContain('already exists');
	});

	it('shows a delete failure above the gallery rather than on a card', () => {
		setup({ deleteFailure: 'The preset could not be deleted.' });
		const message = screen.getByText('The preset could not be deleted.');
		expect(screen.getByTestId('preset-gallery').contains(message)).toBe(false);
	});

	it('asks before deleting a saved preset by its name, then posts its id', async () => {
		setup();
		await fireEvent.click(screen.getByRole('button', { name: 'Delete the preset Mine' }));
		await waitFor(() => expect(HTMLFormElement.prototype.requestSubmit).toHaveBeenCalled());
		expect(kit.confirm.mock.calls[0][0]).toBe('Delete the preset Mine?');
		const form = document.querySelector('form[action="?/deletePreset"]') as HTMLFormElement;
		expect(new FormData(form).get('id')).toBe('mine');
	});

	it('marks the card busy and holds the others while it creates', async () => {
		setup();
		const submit = forms.handlers.get('?/preset#mine') as SubmitFunction;
		await submit({} as never);
		const [notes, mine] = screen.getAllByRole('button', { name: 'Create' }) as HTMLButtonElement[];
		expect(notes.disabled).toBe(true);
		expect(notes.getAttribute('aria-busy')).toBeNull();
		expect(mine.getAttribute('aria-busy')).toBe('true');
	});

	it('closes once a preset is created and stays open on a refusal', async () => {
		setup();
		await answer('?/preset#notes', { type: 'failure', data: { error: 'exists' } });
		expect(screen.getByTestId('preset-gallery')).toBeTruthy();
		await answer('?/preset#notes', { type: 'success', data: { created: ['notes'] } });
		await waitFor(() => expect(screen.queryByTestId('preset-gallery')).toBeNull());
	});

	it('shows a failed save inside the save form', async () => {
		setup();
		await answer('?/savePreset', { type: 'failure', data: { saveError: 'The document is not a preset.' } });
		const message = screen.getByText('The document is not a preset.');
		expect(message.closest('form')?.getAttribute('action')).toBe('?/savePreset');
	});

	it('says custom presets are not licensed, and offers no delete to a reader', () => {
		setup({ canSavePresets: false, canWrite: false });
		expect(screen.queryByTestId('preset-save-locked')).toBeNull();
		expect(screen.queryByRole('button', { name: 'Delete the preset Mine' })).toBeNull();
		cleanup();
		setup({ canSavePresets: false });
		expect(screen.getByTestId('preset-save-locked')).toBeTruthy();
	});

	it('says why the gallery is empty when the presets could not be read', () => {
		setup({ presets: [], presetsGate: { state: 'unavailable' } });
		expect(screen.getByText(/so presets did not load/)).toBeTruthy();
		expect(screen.queryByText('No presets')).toBeNull();
	});
});
