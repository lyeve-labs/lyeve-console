import type { GoroutineSnapshot } from '#lib/api/goroutine-engine.ts';

export type { GoroutineSnapshot };

/** The runtime's own count, which is the one that says what the process holds. */
export function goroutineCount(snapshot: GoroutineSnapshot | null | undefined): number | null {
	const n = snapshot?.runtime_total ?? snapshot?.total;
	return typeof n === 'number' && Number.isFinite(n) ? n : null;
}
