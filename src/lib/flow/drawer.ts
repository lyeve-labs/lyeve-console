/**
 * The bottom drawer's height, remembered per viewer. Browser storage can be
 * absent or throw (a private window, cleared site data), so every read and
 * write is guarded and the drawer falls back to its default.
 */

export const DRAWER_HEIGHT_KEY = 'lyeve-flow-drawer-height';
export const DRAWER_DEFAULT = 288;
export const DRAWER_MIN = 160;

/** The tallest the drawer may be: the canvas keeps at least this much of the window. */
export const CANVAS_MIN = 240;

export function clampDrawerHeight(height: number, windowHeight: number): number {
	const max = Math.max(DRAWER_MIN, windowHeight - CANVAS_MIN);
	return Math.round(Math.min(max, Math.max(DRAWER_MIN, height)));
}

export function readDrawerHeight(storage: Pick<Storage, 'getItem'> | null | undefined, windowHeight: number): number {
	try {
		const raw = storage?.getItem(DRAWER_HEIGHT_KEY);
		const n = raw === null || raw === undefined ? NaN : Number(raw);
		return Number.isFinite(n) ? clampDrawerHeight(n, windowHeight) : clampDrawerHeight(DRAWER_DEFAULT, windowHeight);
	} catch {
		return clampDrawerHeight(DRAWER_DEFAULT, windowHeight);
	}
}

export function writeDrawerHeight(storage: Pick<Storage, 'setItem'> | null | undefined, height: number): void {
	try {
		storage?.setItem(DRAWER_HEIGHT_KEY, String(Math.round(height)));
	} catch {
		// Storage refused: the height lasts the session and nothing else.
	}
}
