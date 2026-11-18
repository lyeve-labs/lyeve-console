// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRawSnippet } from 'svelte';
import EditorDrawer from './EditorDrawer.svelte';
import { DRAWER_HEIGHT_KEY } from '#lib/flow/drawer.ts';

afterEach(cleanup);
beforeEach(() => {
	localStorage.clear();
	vi.stubGlobal('innerHeight', 900);
});

const body = createRawSnippet(() => ({ render: () => '<p>body</p>' }));

function setup() {
	const result = render(EditorDrawer, {
		props: { active: 'test', items: [{ id: 'test', label: 'Test' }], onchange: vi.fn(), children: body },
	});
	const drawer = result.getByTestId('editor-drawer');
	const handle = result.getByTestId('drawer-handle');
	return { ...result, drawer, handle };
}

describe('EditorDrawer', () => {
	it('marks a focused handle in the full brand color', () => {
		const { handle } = setup();
		expect(handle.classList).toContain('focus-visible:bg-brand');
		expect(handle.classList).not.toContain('focus-visible:bg-brand/40');
	});

	it('opens at the remembered height', () => {
		localStorage.setItem(DRAWER_HEIGHT_KEY, '400');
		const { drawer } = setup();
		expect(drawer.style.height).toBe('400px');
	});

	it('resizes by dragging the top edge and remembers the height on release', async () => {
		const { drawer, handle } = setup();
		expect(drawer.style.height).toBe('288px');
		await fireEvent.pointerDown(handle, { button: 0, clientY: 600, pointerId: 1 });
		await fireEvent.pointerMove(handle, { clientY: 500, pointerId: 1 });
		expect(drawer.style.height).toBe('388px');
		await fireEvent.pointerUp(handle, { clientY: 500, pointerId: 1 });
		expect(localStorage.getItem(DRAWER_HEIGHT_KEY)).toBe('388');
	});

	it('never shrinks below the minimum or grows over the canvas', async () => {
		const { drawer, handle } = setup();
		await fireEvent.pointerDown(handle, { button: 0, clientY: 600, pointerId: 1 });
		await fireEvent.pointerMove(handle, { clientY: 900, pointerId: 1 });
		expect(drawer.style.height).toBe('160px');
		await fireEvent.pointerMove(handle, { clientY: 0, pointerId: 1 });
		expect(drawer.style.height).toBe('660px');
	});

	it('resizes from the keyboard', async () => {
		const { drawer, handle } = setup();
		await fireEvent.keyDown(handle, { key: 'ArrowUp' });
		expect(drawer.style.height).toBe('312px');
		await fireEvent.keyDown(handle, { key: 'ArrowDown', shiftKey: true });
		expect(drawer.style.height).toBe('232px');
		expect(localStorage.getItem(DRAWER_HEIGHT_KEY)).toBe('232');
	});

	it('survives storage that throws', () => {
		const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
			throw new Error('denied');
		});
		const { drawer } = setup();
		expect(drawer.style.height).toBe('288px');
		spy.mockRestore();
	});
});
