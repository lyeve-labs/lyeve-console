/**
 * The editor's per-viewer preferences: focus mode, and the storage keys and
 * bounds the two side panels are given. ResizableAside does the panels' own
 * reading and writing through #lib/aside. SidePanel hands it PANEL and
 * PANEL_KEY from here so both panels agree on their defaults.
 *
 * Browser storage can be absent or throw (a private window, cleared site
 * data), so focus mode is read and written under a guard and falls back to
 * off. Conveniences, not state the server holds.
 */

export const FOCUS_KEY = 'lyeve-flow-focus';

export type PanelName = 'palette' | 'inspector';

export const PANEL_KEY: Record<PanelName, string> = {
	palette: 'lyeve-flow-palette',
	inspector: 'lyeve-flow-inspector',
};

/** Defaults and bounds. */
export const PANEL: Record<PanelName, { width: number; min: number; max: number }> = {
	palette: { width: 240, min: 180, max: 480 },
	inspector: { width: 320, min: 240, max: 640 },
};

type Reader = Pick<Storage, 'getItem'> | null | undefined;
type Writer = Pick<Storage, 'setItem'> | null | undefined;

export function readFocus(storage: Reader): boolean {
	try {
		return storage?.getItem(FOCUS_KEY) === '1';
	} catch {
		return false;
	}
}

export function writeFocus(storage: Writer, focus: boolean): void {
	try {
		storage?.setItem(FOCUS_KEY, focus ? '1' : '0');
	} catch {
		// Storage refused: focus lasts the page and nothing else.
	}
}
