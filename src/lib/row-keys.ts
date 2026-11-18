/**
 * Keys for the rows of a list stored as plain values, such as the columns of
 * an inline table or the entries of a map, so the markup of a row stays with
 * it when a row above it goes and its exit plays on the row that left.
 *
 * Until a row is added or removed here, a row's key is its position, which a
 * change of value never moves. When the list's length changes some other
 * way, such as a load or an undo, the positions take over again.
 */
let added = 0;

/** The keys for a list of `length` rows, given the ones kept since the last add or remove. */
export function rowKeys(kept: readonly number[] | undefined, length: number): number[] {
	return kept?.length === length ? [...kept] : Array.from({ length }, (_, i) => i);
}

/** The keys once the row at `index` is removed. */
export function withoutRow(keys: readonly number[], index: number): number[] {
	return keys.filter((_, i) => i !== index);
}

/** The keys once a row is added at the end. A new key is negative, so it never meets a position. */
export function withRow(keys: readonly number[]): number[] {
	return [...keys, --added];
}

/** The keys once the rows at `i` and `j` trade places. */
export function withRowsSwapped(keys: readonly number[], i: number, j: number): number[] {
	const next = [...keys];
	[next[i], next[j]] = [next[j], next[i]];
	return next;
}
