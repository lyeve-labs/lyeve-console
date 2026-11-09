/**
 * Readers for the parts of an engine answer typed `unknown`. Each one takes
 * the shape it reads and falls back when the value is something else, so a
 * field the engine left out or sent in another type never reaches a page as
 * `undefined` or `NaN`.
 */

/** An object's fields, or none for anything that is not a plain object. */
export function record(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** A string as sent, or `fallback`. */
export function str(value: unknown, fallback = ''): string {
	return typeof value === 'string' ? value : fallback;
}

/** A string without the space around it, or an empty one. */
export function text(value: unknown): string {
	return typeof value === 'string' ? value.trim() : '';
}

/** A finite number, or `fallback`. */
export function num(value: unknown, fallback = 0): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A finite number, or null when the engine sent none, so a missing count never reads as zero. */
export function count(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** A positive whole number, or 0. */
export function whole(value: unknown): number {
	return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}
