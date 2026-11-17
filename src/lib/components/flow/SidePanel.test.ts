// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRawSnippet } from 'svelte';
import SidePanel from './SidePanel.svelte';
import { PANEL, PANEL_KEY } from '#lib/flow/prefs.ts';

afterEach(cleanup);
beforeEach(() => localStorage.clear());

const body = createRawSnippet(() => ({ render: () => '<p>body</p>' }));

function setup(props: Partial<{ name: 'palette' | 'inspector'; side: 'start' | 'end'; open: boolean; overlay: boolean }> = {}) {
	const name = props.name ?? 'palette';
	const result = render(SidePanel, {
		props: { name, label: name === 'palette' ? 'Palette' : 'Inspector', side: props.side ?? 'start', open: props.open ?? true, overlay: props.overlay ?? false, children: body },
	});
	const aside = result.getByTestId(`panel-${name}`);
	const widthOf = () => aside.style.getPropertyValue('--panel-w');
	return { ...result, aside, widthOf, handle: () => result.queryByTestId(`panel-${name}-handle`) };
}

describe('SidePanel', () => {
	it('opens at the panel default, or at the remembered width and lock', () => {
		expect(setup().widthOf()).toBe(`${PANEL.palette.width}px`);
		cleanup();
		localStorage.setItem(PANEL_KEY.inspector, JSON.stringify({ width: 400, locked: true }));
		const { widthOf, handle, getByRole } = setup({ name: 'inspector', side: 'end' });
		expect(widthOf()).toBe('400px');
		expect(handle()).toBeNull();
		expect(getByRole('button', { name: 'Unlock Inspector width' }).getAttribute('aria-pressed')).toBe('true');
	});

	it('resizes by dragging the inner edge, in the direction that grows the panel, and remembers the width on release', async () => {
		const start = setup({ name: 'palette', side: 'start' });
		const h = start.handle() as HTMLElement;
		await fireEvent.pointerDown(h, { button: 0, clientX: 240, pointerId: 1 });
		await fireEvent.pointerMove(h, { clientX: 300, pointerId: 1 });
		expect(start.widthOf()).toBe('300px');
		await fireEvent.pointerUp(h, { clientX: 300, pointerId: 1 });
		expect(JSON.parse(localStorage.getItem(PANEL_KEY.palette) ?? '')).toEqual({ width: 300, locked: false });
		cleanup();

		// An end panel grows leftwards: a pointer moving left makes it wider.
		const end = setup({ name: 'inspector', side: 'end' });
		const e = end.handle() as HTMLElement;
		await fireEvent.pointerDown(e, { button: 0, clientX: 900, pointerId: 1 });
		await fireEvent.pointerMove(e, { clientX: 840, pointerId: 1 });
		expect(end.widthOf()).toBe('380px');
	});

	it('never goes under the minimum or over the maximum', async () => {
		const { handle, widthOf } = setup();
		const h = handle() as HTMLElement;
		await fireEvent.pointerDown(h, { button: 0, clientX: 240, pointerId: 1 });
		await fireEvent.pointerMove(h, { clientX: -500, pointerId: 1 });
		expect(widthOf()).toBe(`${PANEL.palette.min}px`);
		await fireEvent.pointerMove(h, { clientX: 5000, pointerId: 1 });
		expect(widthOf()).toBe(`${PANEL.palette.max}px`);
		expect(h.getAttribute('aria-valuemin')).toBe(String(PANEL.palette.min));
		expect(h.getAttribute('aria-valuemax')).toBe(String(PANEL.palette.max));
	});

	it('nudges by a step from the keyboard, more with Shift, and writes each step', async () => {
		const { handle, widthOf } = setup();
		const h = handle() as HTMLElement;
		await fireEvent.keyDown(h, { key: 'ArrowRight' });
		expect(widthOf()).toBe('264px');
		await fireEvent.keyDown(h, { key: 'ArrowLeft', shiftKey: true });
		expect(widthOf()).toBe('184px');
		expect(JSON.parse(localStorage.getItem(PANEL_KEY.palette) ?? '').width).toBe(184);
		expect(h.getAttribute('aria-valuenow')).toBe('184');
	});

	it('locks the width: the handle goes, the lock is remembered, and collapse still works', async () => {
		const { getByRole, handle, aside } = setup();
		await fireEvent.click(getByRole('button', { name: 'Lock Palette width' }));
		expect(handle()).toBeNull();
		expect(JSON.parse(localStorage.getItem(PANEL_KEY.palette) ?? '')).toEqual({ width: PANEL.palette.width, locked: true });
		await fireEvent.click(getByRole('button', { name: 'Collapse Palette' }));
		expect(aside.getAttribute('data-open')).toBe('false');
		expect(aside.className).toContain('xl:w-8');
		await fireEvent.click(getByRole('button', { name: 'Unlock Palette width' }));
		expect(JSON.parse(localStorage.getItem(PANEL_KEY.palette) ?? '').locked).toBe(false);
	});

	it('collapses to a strip that carries the name and the way back, and expands from it', async () => {
		const { getByRole, getByTestId, aside, getByText } = setup({ name: 'inspector', side: 'end', open: false });
		expect(aside.className).toContain('xl:w-8');
		const strip = getByTestId('panel-inspector-strip');
		expect(strip.textContent).toContain('Inspector');
		expect(strip.className).toContain('xl:flex');
		await fireEvent.click(getByRole('button', { name: 'Expand Inspector' }));
		expect(aside.getAttribute('data-open')).toBe('true');
		expect(aside.className).not.toContain('xl:w-8');
		expect(getByText('body')).toBeTruthy();
	});

	it('is the toolbar overlay below xl:, invisible until asked for', () => {
		expect(setup().aside.className).toMatch(/(^|\s)invisible(\s|$)/);
		cleanup();
		const { aside } = setup({ overlay: true });
		expect(aside.className).not.toMatch(/(^|\s)invisible(\s|$)/);
		expect(aside.className).toContain('xl:visible');
	});
});
