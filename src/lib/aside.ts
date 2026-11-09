/**
 * What a resizable aside remembers per viewer: its width and whether the
 * width is locked. Browser storage can be absent or throw (a private window,
 * cleared site data), so every read and write is guarded and the aside falls
 * back to its default. A convenience, not state the server holds.
 */

export interface AsideBounds {
	/** The width the aside opens at until somebody drags it. */
	width: number;
	min: number;
	max: number;
}

export interface AsidePrefs {
	width: number;
	locked: boolean;
}

type Reader = Pick<Storage, 'getItem'> | null | undefined;
type Writer = Pick<Storage, 'setItem'> | null | undefined;

/**
 * The browser's localStorage, or null on the server and wherever reaching it
 * throws, such as a sandboxed frame with site data blocked.
 */
export function safeStorage(): Storage | null {
	try {
		return typeof localStorage === 'undefined' ? null : localStorage;
	} catch {
		return null;
	}
}
export function clampWidth(bounds: Pick<AsideBounds, 'min' | 'max'>, width: number): number {
	return Math.round(Math.min(bounds.max, Math.max(bounds.min, width)));
}

export function readAside(storage: Reader, key: string, bounds: AsideBounds): AsidePrefs {
	const fallback = { width: bounds.width, locked: false };
	try {
		const raw = storage?.getItem(key);
		if (!raw) return fallback;
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed !== 'object' || parsed === null) return fallback;
		const { width, locked } = parsed as Partial<AsidePrefs>;
		return {
			width: typeof width === 'number' && Number.isFinite(width) ? clampWidth(bounds, width) : fallback.width,
			locked: locked === true,
		};
	} catch {
		return fallback;
	}
}

export function writeAside(storage: Writer, key: string, bounds: AsideBounds, prefs: AsidePrefs): void {
	try {
		storage?.setItem(key, JSON.stringify({ width: clampWidth(bounds, prefs.width), locked: prefs.locked }));
	} catch {
		// Storage refused: the width lasts the page and nothing else.
	}
}
