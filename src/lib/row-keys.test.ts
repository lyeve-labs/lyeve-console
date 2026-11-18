import { describe, expect, it } from 'vitest';
import { rowKeys, withRow, withRowsSwapped, withoutRow } from './row-keys';

describe('row keys', () => {
	it('keys each row by its position until a row is added or removed', () => {
		expect(rowKeys(undefined, 3)).toEqual([0, 1, 2]);
	});

	it('keeps the keys of the rows that stay when one is removed', () => {
		const keys = withoutRow(rowKeys(undefined, 3), 0);
		expect(rowKeys(keys, 2)).toEqual([1, 2]);
	});

	it('gives an added row a key no other row holds, even after a removal', () => {
		const keys = withRow(withoutRow([0, 1, 2], 2));
		expect(new Set(keys).size).toBe(3);
		expect(keys.slice(0, 2)).toEqual([0, 1]);
		expect(keys[2]).toBeLessThan(0);
		expect(withRow(keys).at(-1)).not.toBe(keys[2]);
	});

	it('swaps two keys with their rows and leaves the list it was given alone', () => {
		const keys = [0, 1, 2];
		expect(withRowsSwapped(keys, 0, 1)).toEqual([1, 0, 2]);
		expect(keys).toEqual([0, 1, 2]);
	});

	it('falls back to positions when the list changed length some other way', () => {
		expect(rowKeys([4, 7], 3)).toEqual([0, 1, 2]);
	});
});
