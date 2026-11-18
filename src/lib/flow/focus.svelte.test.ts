// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SHELL_KEY } from '#lib/shell.svelte.ts';
import FocusHost from './focus-host.test.svelte';

/** A travel the shell started, which ends when the test says so. */
function travel(property: string) {
	let end!: () => void;
	const finished = new Promise<void>((done) => (end = done));
	return { animation: { transitionProperty: property, finished }, end };
}

const settle = () => new Promise((done) => setTimeout(done, 0));

type Travel = { transitionProperty: string; finished: Promise<void> };
/** What moves inside the shell's frame, which holds the sidebar, the header row and the page. */
let running: Travel[] = [];
/** What moves elsewhere in the document, such as a panel in an overlay. */
let outside: Travel[] = [];
let frame: HTMLElement;

beforeEach(() => {
	localStorage.clear();
	running = [];
	outside = [];
	frame = document.createElement('div');
	frame.innerHTML = '<div><aside data-testid="app-sidebar"></aside></div><main id="content"></main>';
	document.body.append(frame);
	Object.assign(frame, { getAnimations: (options?: { subtree?: boolean }) => (options?.subtree ? running : []) });
	(document as { getAnimations?: () => unknown[] }).getAnimations = () => [...running, ...outside];
});
afterEach(() => {
	cleanup();
	frame.remove();
	delete (document as { getAnimations?: unknown }).getAnimations;
});

function mount() {
	const refit = vi.fn();
	render(FocusHost, { props: { refit }, context: new Map([[SHELL_KEY, { focus: false }]]) });
	return refit;
}

describe('focus mode', () => {
	it('fits the canvas once the sidebar has finished its travel, not on its first frame', async () => {
		const refit = mount();
		await settle();
		refit.mockClear();

		const sidebar = travel('width');
		running = [sidebar.animation];
		await fireEvent.click(screen.getByRole('button', { name: 'Focus' }));
		await settle();
		expect(refit).not.toHaveBeenCalled();

		sidebar.end();
		await settle();
		expect(refit).toHaveBeenCalledTimes(1);
	});

	it('fits at once when nothing in the shell moves', async () => {
		const refit = mount();
		await settle();
		refit.mockClear();
		running = [travel('opacity').animation];
		await fireEvent.click(screen.getByRole('button', { name: 'Focus' }));
		await settle();
		expect(refit).toHaveBeenCalledTimes(1);
	});

	it('waits for the shell alone, not for a width travel elsewhere in the document', async () => {
		const refit = mount();
		await settle();
		refit.mockClear();
		outside = [travel('width').animation];
		await fireEvent.click(screen.getByRole('button', { name: 'Focus' }));
		await settle();
		expect(refit).toHaveBeenCalledTimes(1);
	});

	it('fits once, after the last travel, when it is toggled again mid travel', async () => {
		const refit = mount();
		await settle();
		refit.mockClear();
		const first = travel('width');
		running = [first.animation];
		await fireEvent.click(screen.getByRole('button', { name: 'Focus' }));
		const second = travel('grid-template-rows');
		running = [second.animation];
		await fireEvent.click(screen.getByRole('button', { name: 'Focus' }));
		first.end();
		await settle();
		expect(refit).not.toHaveBeenCalled();
		second.end();
		await settle();
		expect(refit).toHaveBeenCalledTimes(1);
	});
});
