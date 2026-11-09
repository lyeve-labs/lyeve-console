import { afterEach, describe, expect, it, vi } from 'vitest';
import { clampWidth, readAside, safeStorage, writeAside, type AsideBounds } from './aside';

const PALETTE: AsideBounds = { width: 240, min: 180, max: 480 };
const INSPECTOR: AsideBounds = { width: 320, min: 240, max: 640 };
const KEY = 'lyeve-aside-probe';

function memory(seed: Record<string, string> = {}) {
	const map = new Map(Object.entries(seed));
	return {
		getItem: (k: string) => map.get(k) ?? null,
		setItem: (k: string, v: string) => void map.set(k, v),
		map,
	};
}

const refusing = {
	getItem: () => {
		throw new Error('refused');
	},
	setItem: () => {
		throw new Error('refused');
	},
};

describe('aside width and lock', () => {
	it('clamps a width to the bounds and rounds it', () => {
		expect(clampWidth(PALETTE, 10)).toBe(PALETTE.min);
		expect(clampWidth(PALETTE, 9999)).toBe(PALETTE.max);
		expect(clampWidth(INSPECTOR, 300.4)).toBe(300);
	});

	it('falls back to the default width, unlocked, when nothing or garbage is stored', () => {
		expect(readAside(memory(), KEY, INSPECTOR)).toEqual({ width: INSPECTOR.width, locked: false });
		expect(readAside(memory({ [KEY]: 'not json' }), KEY, INSPECTOR)).toEqual({ width: INSPECTOR.width, locked: false });
		expect(readAside(memory({ [KEY]: '{"width":"wide","locked":"yes"}' }), KEY, INSPECTOR)).toEqual({
			width: INSPECTOR.width,
			locked: false,
		});
		expect(readAside(refusing, KEY, PALETTE)).toEqual({ width: PALETTE.width, locked: false });
		expect(readAside(null, KEY, PALETTE)).toEqual({ width: PALETTE.width, locked: false });
	});

	it('reads back a written width and lock, clamped, under its own key', () => {
		const s = memory();
		writeAside(s, KEY, PALETTE, { width: 2000, locked: true });
		expect(JSON.parse(s.map.get(KEY) ?? '')).toEqual({ width: PALETTE.max, locked: true });
		expect(readAside(s, KEY, PALETTE)).toEqual({ width: PALETTE.max, locked: true });
		expect(readAside(s, 'another-key', INSPECTOR).width).toBe(INSPECTOR.width);
		expect(() => writeAside(refusing, KEY, PALETTE, { width: 300, locked: false })).not.toThrow();
	});
});

describe('safeStorage', () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it('hands back the browser storage when it can be reached', () => {
		const stored = memory();
		vi.stubGlobal('localStorage', stored);
		expect(safeStorage()).toBe(stored);
	});

	it('answers null where there is no storage or reaching it throws', () => {
		vi.stubGlobal('localStorage', undefined);
		expect(safeStorage()).toBeNull();
		vi.spyOn(globalThis, 'localStorage', 'get').mockImplementation(() => {
			throw new DOMException('blocked', 'SecurityError');
		});
		expect(safeStorage()).toBeNull();
	});
});
