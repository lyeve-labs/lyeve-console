// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRawSnippet } from 'svelte';
import EditorDrawer from './EditorDrawer.svelte';
import { CANVAS_MIN, DRAWER_HEIGHT_KEY } from '#lib/flow/drawer.ts';
import { watchTransitions } from '#lib/transitions.test-support.ts';

// jsdom lays out nothing, so the tab row reports the height a browser gives it.
const TAB_ROW = 41;

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});
beforeEach(() => {
	localStorage.clear();
	vi.stubGlobal('innerHeight', 900);
	vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
		return this.dataset.testid === 'editor-drawer-tabs' ? TAB_ROW : 0;
	});
});

const body = createRawSnippet(() => ({ render: () => '<p>body</p>' }));

function setup() {
	const result = render(EditorDrawer, {
		props: { active: 'test', items: [{ id: 'test', label: 'Test' }], onchange: vi.fn(), children: body },
	});
	const drawer = result.getByTestId('editor-drawer');
	const handle = result.getByTestId('drawer-handle');
	const bodyHeight = () => parseFloat(result.getByTestId('editor-drawer-body').style.height);
	// The remembered height is the whole drawer's: the tab row and the body under it.
	const height = () => TAB_ROW + bodyHeight();
	return { ...result, drawer, handle, height, bodyHeight };
}

describe('EditorDrawer', () => {
	it('eases the handle color on hover rather than switching it in a frame', () => {
		const { handle } = setup();
		expect(handle.classList).toContain('transition-colors');
	});

	it('turns one chevron on the movement rung as it shuts and opens', async () => {
		const { getByRole } = setup();
		const toggle = getByRole('button', { name: 'Collapse drawer' });
		const chevron = toggle.querySelector('svg') as SVGElement;
		expect(chevron.classList).toContain('transition-transform');
		expect(chevron.classList).toContain('duration-base');
		expect(chevron.classList).toContain('rotate-180');
		await fireEvent.click(toggle);
		expect(toggle.querySelector('svg')).toBe(chevron);
		expect(chevron.classList).not.toContain('rotate-180');
	});

	it('closes and opens its body on the collapse row, so the drawer moves as one', async () => {
		const { getByRole, getByTestId } = setup();
		const row = getByTestId('editor-drawer-body').parentElement!.parentElement!;
		expect(row.classList).toContain('grid');
		const watch = watchTransitions();
		try {
			await fireEvent.click(getByRole('button', { name: 'Collapse drawer' }));
			expect(watch.left).toContain(row);
			watch.clear();
			await fireEvent.click(getByRole('button', { name: 'Expand drawer' }));
			expect(watch.entered).toContain(getByTestId('editor-drawer-body').parentElement!.parentElement!);
		} finally {
			watch.stop();
		}
	});

	it('marks a focused handle in the full brand color', () => {
		const { handle } = setup();
		expect(handle.classList).toContain('focus-visible:bg-brand');
		expect(handle.classList).not.toContain('focus-visible:bg-brand/40');
	});

	it('opens at the remembered height, the tab row included', () => {
		localStorage.setItem(DRAWER_HEIGHT_KEY, '400');
		const { bodyHeight } = setup();
		expect(bodyHeight()).toBe(400 - TAB_ROW);
	});

	it('resizes by dragging the top edge and remembers the height on release', async () => {
		const { handle, height } = setup();
		expect(height()).toBe(288);
		await fireEvent.pointerDown(handle, { button: 0, clientY: 600, pointerId: 1 });
		await fireEvent.pointerMove(handle, { clientY: 500, pointerId: 1 });
		expect(height()).toBe(388);
		await fireEvent.pointerUp(handle, { clientY: 500, pointerId: 1 });
		expect(localStorage.getItem(DRAWER_HEIGHT_KEY)).toBe('388');
	});

	it('never shrinks below the minimum or grows over the canvas', async () => {
		const { handle, height } = setup();
		await fireEvent.pointerDown(handle, { button: 0, clientY: 600, pointerId: 1 });
		await fireEvent.pointerMove(handle, { clientY: 900, pointerId: 1 });
		expect(height()).toBe(160);
		await fireEvent.pointerMove(handle, { clientY: 0, pointerId: 1 });
		expect(innerHeight - height()).toBe(CANVAS_MIN);
	});

	it('resizes from the keyboard', async () => {
		const { handle, height } = setup();
		await fireEvent.keyDown(handle, { key: 'ArrowUp' });
		expect(height()).toBe(312);
		await fireEvent.keyDown(handle, { key: 'ArrowDown', shiftKey: true });
		expect(height()).toBe(232);
		expect(localStorage.getItem(DRAWER_HEIGHT_KEY)).toBe('232');
	});

	it('survives storage that throws', () => {
		const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
			throw new Error('denied');
		});
		const { height } = setup();
		expect(height()).toBe(288);
		spy.mockRestore();
	});
});
