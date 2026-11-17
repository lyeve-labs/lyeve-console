import { describe, expect, it } from 'vitest';
import { goroutineCount } from '#lib/server/goroutines.ts';

/*
 * The endpoint answers the runtime count alone when no tracker is wired, and
 * the tracker's snapshot beside it otherwise. The runtime's own figure is
 * the one that says what the process holds.
 */
describe('goroutineCount', () => {
	it('prefers the runtime total to the tracker total', () => {
		expect(goroutineCount({ total: 12, runtime_total: 40 })).toBe(40);
		expect(goroutineCount({ total: 12 })).toBe(12);
	});

	it('reports nothing for an answer with no number', () => {
		expect(goroutineCount({ total: Number.NaN })).toBeNull();
		expect(goroutineCount({} as never)).toBeNull();
	});
});
