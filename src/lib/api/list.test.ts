import { describe, it, expect } from 'vitest';
import { query, readAll, totalOf } from './list';

describe('totalOf', () => {
	it('prefers the envelope count over the page length', () => {
		expect(totalOf({ data: [1, 2], limit: 2, offset: 0, total_count: 97 })).toBe(97);
	});

	it('falls back to the array length for a bare array', () => {
		expect(totalOf([1, 2, 3])).toBe(3);
	});

	it('falls back to the data length when the count is absent', () => {
		expect(totalOf({ data: [1, 2] })).toBe(2);
	});

	it('reports zero for an empty or absent result', () => {
		expect(totalOf(null)).toBe(0);
		expect(totalOf(undefined)).toBe(0);
		expect(totalOf({ data: null })).toBe(0);
		expect(totalOf([])).toBe(0);
	});
});

describe('query', () => {
	it('keeps the order given and leaves out an empty or undefined value', () => {
		expect(query({ limit: 50, offset: 0, status: '', q: undefined, kind: 'a b' })).toBe('?limit=50&offset=0&kind=a+b');
	});

	it('is empty when nothing is left', () => {
		expect(query({ status: '', q: undefined })).toBe('');
	});
});

describe('readAll', () => {
	const pages = (sizes: number[], total: number | null = null) => {
		const asked: number[] = [];
		const read = async (limit: number, offset: number) => {
			asked.push(offset);
			const n = sizes[offset / limit] ?? 0;
			return { rows: Array.from({ length: n }, (_, i) => offset + i), total };
		};
		return { asked, read };
	};

	it('stops at a short page', async () => {
		const { asked, read } = pages([2, 2, 1]);
		expect((await readAll(read, 2)).rows).toEqual([0, 1, 2, 3, 4]);
		expect(asked).toEqual([0, 2, 4]);
	});

	it('stops at the stated total without asking for the empty page after it', async () => {
		const { asked, read } = pages([2, 2, 2], 4);
		expect(await readAll(read, 2)).toEqual({ rows: [0, 1, 2, 3], total: 4 });
		expect(asked).toEqual([0, 2]);
	});

	it('asks for no page that starts at the cap', async () => {
		const { asked, read } = pages([2, 2, 2, 2]);
		await readAll(read, 2, 4);
		expect(asked).toEqual([0, 2]);
	});

	it('stops once the rows read are enough', async () => {
		const { asked, read } = pages([2, 2, 2]);
		await readAll(read, 2, Infinity, (rows) => rows.includes(3));
		expect(asked).toEqual([0, 2]);
	});
});
