// @vitest-environment jsdom
import { render, cleanup, fireEvent, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageData } from './$types';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));
vi.mock('$app/navigation', () => ({ beforeNavigate: vi.fn(), goto: vi.fn(async () => {}), invalidateAll: vi.fn(async () => {}) }));
const state = vi.hoisted(() => ({ page: { url: new URL('http://localhost/admin/schema') } }));
vi.mock('$app/state', () => state);

// A diagram that draws nothing. The page only needs a canvas to switch to,
// and the editor it draws beside it is the page's own.
vi.mock('$lib/canvas/schema', () => ({
	SchemaCanvas: () => ({ reveal() {} }),
	hasSchemaCanvas: true,
}));

import SchemaPage from './+page.svelte';

afterEach(cleanup);
beforeEach(() => {
	// The history section reads itself through a hidden form when it opens.
	HTMLFormElement.prototype.requestSubmit = vi.fn();
});

function data(extra: Record<string, unknown>[] = []): PageData {
	return {
		schemas: [
			{
				name: 'posts',
				display_name: 'Posts',
				fields: [{ id: 'f-title', name: 'title', field_type: 'text', required: false, unique: false, indexed: false, localized: true }],
			},
			{ name: 'authors', display_name: 'Authors', fields: [] },
			...extra,
		],
		rowCounts: {},
		presets: [],
		presetsGate: null,
		canWrite: true,
		isSuperAdmin: true,
		loadGate: null,
		canvas: { licensed: true, positions: {} },
		canvasGate: null,
	} as unknown as PageData;
}

async function pickType(field: string, type: string) {
	await fireEvent.click(screen.getByRole('combobox', { name: `Type, ${field}` }));
	await fireEvent.click(screen.getByRole('option', { name: type }));
}

// The History tab is left chosen, so each side checks it first, then reads
// the edits on the Definition tab and goes back to History for the next.
async function survived() {
	expect(screen.getByRole('tab', { name: /History/ }).getAttribute('aria-selected')).toBe('true');
	await fireEvent.click(screen.getByRole('tab', { name: 'Definition' }));
	expect((screen.getByLabelText('Display name') as HTMLInputElement).value).toBe('Articles');
	expect(screen.getByText(/No longer translated per locale\./)).toBeTruthy();
	expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(false);
	expect(screen.getByTestId('schema-status').textContent).toContain('Unsaved changes');
	await fireEvent.click(screen.getByRole('tab', { name: /History/ }));
}

describe('schema builder view switch', () => {
	it('keeps the edits, the cleared-translation note, undo and the open history across the list and the canvas', async () => {
		const { rerender } = render(SchemaPage, { props: { data: data(), form: null } });
		await fireEvent.click(screen.getByRole('button', { name: 'Posts' }));

		await fireEvent.input(screen.getByLabelText('Display name'), { target: { value: 'Articles' } });
		await pickType('title', 'number');
		await fireEvent.click(screen.getByRole('tab', { name: /History/ }));
		await survived();

		// The editor is drawn again inside the canvas panel.
		await fireEvent.click(screen.getByRole('radio', { name: 'Canvas' }));
		expect(screen.getByTestId('schema-canvas-panel')).toBeTruthy();
		await survived();

		await fireEvent.click(screen.getByRole('radio', { name: 'List' }));
		expect(screen.queryByTestId('schema-canvas-panel')).toBeNull();
		await survived();

		// A load that reruns, as after a preset, replaces the list and not the edit.
		await rerender({ data: data([{ name: 'tags', display_name: 'Tags', fields: [] }]), form: null });
		expect(screen.getByRole('button', { name: 'Tags' })).toBeTruthy();
		await survived();
		// One case walks the whole round trip, so it gets more than the default
		// five seconds. Alone it takes under one, but a full suite on a loaded
		// machine has pushed it past the default.
	}, 20_000);
});

describe('schema builder canvas that could not be read', () => {
	it('says the layout read failed instead of that the license leaves the canvas out', async () => {
		const d = { ...data(), canvas: { licensed: false, positions: {} }, canvasGate: { state: 'unavailable' } } as unknown as PageData;
		render(SchemaPage, { props: { data: d, form: null } });
		await fireEvent.click(screen.getByRole('radio', { name: 'Canvas' }));
		expect(screen.getByTestId('schema-canvas-unread').textContent).toContain('is unavailable');
		expect(screen.queryByTestId('schema-canvas-locked')).toBeNull();
	});

	it('tells an editor the role cannot open the canvas', async () => {
		const d = { ...data(), canWrite: false, canvas: { licensed: false, positions: {} }, canvasGate: { state: 'forbidden' } } as unknown as PageData;
		render(SchemaPage, { props: { data: d, form: null } });
		await fireEvent.click(screen.getByRole('radio', { name: 'Canvas' }));
		expect(screen.getByTestId('schema-canvas-unread').textContent).toContain('Your role cannot open');
	});
});

describe('schema builder list that could not be read', () => {
	it('prints no count beside the list', () => {
		const d = { ...data(), schemas: [], loadGate: { state: 'unavailable' } } as unknown as PageData;
		render(SchemaPage, { props: { data: d, form: null } });
		expect(screen.getByTestId('schema-list').textContent).not.toMatch(/\b0\b/);
	});
});

