import { describe, expect, it } from 'vitest';
import { formatDuration } from './time';

const now = new Date('2026-09-14T12:00:00Z');
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

describe('formatDuration', () => {
	it('is empty for nothing', () => {
		expect(formatDuration(null)).toBe('');
		expect(formatDuration(undefined)).toBe('');
		expect(formatDuration(Number.NaN)).toBe('');
	});

	it.each([
		[0, '0 ms'],
		[12.4, '12 ms'],
		[999, '999 ms'],
		[1000, '1.00 s'],
		[1_440, '1.44 s'],
		[60_000, '1m 00s'],
		[125_000, '2m 05s'],
		[3_600_000, '60m 00s'],
	])('formats %d ms as %s', (ms, text) => {
		expect(formatDuration(ms)).toBe(text);
	});
});
