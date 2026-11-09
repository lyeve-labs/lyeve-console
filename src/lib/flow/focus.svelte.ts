/**
 * Focus mode: the app's sidebar narrows to its icon rail and the header goes
 * while the editor is open, and the toolbar keeps the way back. The editor
 * owns the toggle and its memory. The layout only hears the ask through the
 * shell context, and leaving the page withdraws it so the next page gets its
 * frame back.
 */

import { tick } from 'svelte';
import { useShell } from '$lib/shell.svelte';
import { readFocus, writeFocus } from './prefs';
import { safeStorage } from '$lib/aside';

/**
 * The editor's focus toggle. Call it while the component initializes, since
 * it reads the shell context and registers effects. `refit` runs once the
 * shell has laid out after a change: the opening fit uses the width the
 * canvas has beside the sidebar and under the header, and focus mode changes
 * both. Under a test there is no shell and no layout, so nothing refits.
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
		tick().then(refit);
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
