// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';

import ImageZoom from './ImageZoom.svelte';

/*
 * jsdom lays nothing out, so every box measures zero. The frame is given a
 * 400 by 300 box, which fits a 1600 by 1200 picture at a quarter of its size.
 */
beforeEach(() => {
	vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
		left: 0,
		top: 0,
		width: 400,
		height: 300,
		right: 400,
		bottom: 300,
		x: 0,
		y: 0,
		toJSON: () => ({}),
	});
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

function setup() {
	const result = render(ImageZoom, { props: { src: '/files/harbor.jpg', alt: 'Harbor', naturalWidth: 1600, naturalHeight: 1200 } });
	const frame = screen.getByRole('application');
	const shown = () => screen.getByRole('slider', { name: 'Zoom level' }).getAttribute('aria-valuetext');
	return { ...result, frame, shown };
}

describe('ImageZoom', () => {
	it('opens fitted to the frame and says the scale it shows', () => {
		const { frame, shown } = setup();
		expect(shown()).toBe('25%');
		expect(frame.getAttribute('aria-label')).toContain('Harbor, shown at 25%.');
		expect((screen.getByRole('button', { name: /Fit/ }) as HTMLButtonElement).disabled).toBe(true);
	});

	it('zooms in and out a step at a time', async () => {
		const { shown } = setup();
		await fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
		expect(shown()).toBe('31%');
		await fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
		expect(shown()).toBe('25%');
	});

	it('shows actual size and returns to the fit', async () => {
		const { shown } = setup();
		await fireEvent.click(screen.getByRole('button', { name: '100%' }));
		expect(shown()).toBe('100%');
		await fireEvent.click(screen.getByRole('button', { name: /Fit/ }));
		expect(shown()).toBe('25%');
	});

	it('answers the keyboard while the frame has focus', async () => {
		const { frame, shown } = setup();
		await fireEvent.keyDown(frame, { key: '1' });
		expect(shown()).toBe('100%');
		await fireEvent.keyDown(frame, { key: '-' });
		expect(shown()).toBe('80%');
		await fireEvent.keyDown(frame, { key: '0' });
		expect(shown()).toBe('25%');
	});

	it('toggles between the fit and actual size on a double click', async () => {
		const { frame, shown } = setup();
		await fireEvent.dblClick(frame, { clientX: 200, clientY: 150 });
		expect(shown()).toBe('100%');
		await fireEvent.dblClick(frame, { clientX: 200, clientY: 150 });
		expect(shown()).toBe('25%');
	});

	it('zooms toward the cursor on the wheel and keeps the page from scrolling', async () => {
		const { frame, shown } = setup();
		const wheel = new WheelEvent('wheel', { deltaY: -400, clientX: 100, clientY: 100, cancelable: true, bubbles: true });
		frame.dispatchEvent(wheel);
		await tick();
		expect(wheel.defaultPrevented).toBe(true);
		expect(Number(shown()?.replace('%', ''))).toBeGreaterThan(25);
	});

	it('eases a step to its new view, and follows the wheel directly', async () => {
		const { frame } = setup();
		const img = () => frame.querySelector('img') as HTMLImageElement;
		const eased = () => ['transition-transform', 'duration-base', 'ease-move'].every((c) => img().classList.contains(c));
		expect(eased()).toBe(false);
		await fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
		expect(eased()).toBe(true);
		frame.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, clientX: 100, clientY: 100, cancelable: true, bubbles: true }));
		await tick();
		expect(eased()).toBe(false);
		await fireEvent.dblClick(frame, { clientX: 200, clientY: 150 });
		expect(eased()).toBe(true);
		await fireEvent.input(screen.getByRole('slider', { name: 'Zoom level' }), { target: { value: '500' } });
		expect(eased()).toBe(false);
	});
});
