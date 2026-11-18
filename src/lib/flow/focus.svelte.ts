/**
 * Focus mode: the app's sidebar narrows to its icon rail and the header goes
 * while the editor is open, and the toolbar keeps the way back. The editor
 * owns the toggle and its memory. The layout only hears the ask through the
 * shell context, and leaving the page withdraws it so the next page gets its
 * frame back.
 */

import { tick } from 'svelte';
import { useShell } from '#lib/shell.svelte.ts';
import { readFocus, writeFocus } from './prefs';
import { safeStorage } from '#lib/aside.ts';

/** What the shell moves when focus mode changes: the sidebar's width and the header's row. */
const SHELL_TRAVEL = new Set(['width', 'grid-template-rows']);

/**
 * The shell's frame: the nearest element that holds the sidebar and the page,
 * and with them the header row. None on a phone, where the sidebar is not
 * drawn and nothing travels.
 */
function shellFrame(): Element | null {
	const sidebar = document.querySelector('[data-testid="app-sidebar"]');
	let frame = sidebar?.parentElement ?? null;
	while (frame && !frame.querySelector('#content')) frame = frame.parentElement;
	return frame;
}

/**
 * Resolves once the shell has stopped moving after a change. The sidebar and
 * the header travel on the base rung, so a fit taken on the next tick reads a
 * width that is still changing. Asking for the animations computes the new
 * styles first, so the travel this change started is in the list. Only the
 * shell is asked, so a width traveling in an overlay never holds the fit
 * back. With nothing moving it resolves at once.
 */
async function shellSettled(): Promise<void> {
	await tick();
	const frame = shellFrame();
	if (typeof frame?.getAnimations !== 'function') return;
	const moving = frame
		.getAnimations({ subtree: true })
		.filter((a) => SHELL_TRAVEL.has((a as Partial<CSSTransition>).transitionProperty ?? ''));
	await Promise.allSettled(moving.map((a) => a.finished));
}

/**
 * The editor's focus toggle. Call it while the component initializes, since
 * it reads the shell context and registers effects. `refit` runs once the
 * shell has finished moving after a change: the opening fit uses the width
 * the canvas has beside the sidebar and under the header, and focus mode
 * changes both. Under a test there is no shell and no layout, so nothing
 * refits.
 */
export function focusMode(refit: () => void): { on: boolean } {
	const shell = useShell();
	let on = $state(false);
	let restored = false;

	$effect(() => {
		// Read first and unconditionally, as the sidebar's own memory does: an
		// effect that only writes on its first pass never depends on the state
		// and never runs again.
		const value = on;
		if (!restored) {
			restored = true;
			on = readFocus(safeStorage());
			return;
		}
		writeFocus(safeStorage(), value);
	});

	$effect(() => {
		if (shell) shell.focus = on;
	});

	$effect(() => {
		void on;
		if (!shell) return;
		// A second change before the travel ends fits once, after its own.
		let current = true;
		shellSettled().then(() => {
			if (current) refit();
		});
		return () => {
			current = false;
		};
	});

	$effect(() => () => {
		if (shell) shell.focus = false;
	});

	return {
		get on() {
			return on;
		},
		set on(value: boolean) {
			on = value;
		},
	};
}
