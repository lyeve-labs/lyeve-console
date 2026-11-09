/**
 * The idempotency plugin's admin routes.
 *
 * A key is one client-supplied request identifier and the response that was
 * stored against it. A replay is a second request carrying the same key: the
 * stored response is returned and the handler never runs, which is the point.
 *
 * The number worth reading is in-flight. A key is recorded before the handler
 * finishes and completed afterwards, so an in-flight key is either a request
 * happening right now or one whose process died mid-handler. The second kind
 * blocks every retry of that key until it expires, and nothing else in the
 * product reports it.
 */
import type { StatusTone } from '@lyeve-labs/ui-kit';
import type { HttpClient } from '@lyeve-labs/client';
import type { ListEnvelope } from './list';

const KEYS_URL = '/api/admin/idempotency';
const STATS_URL = '/api/admin/idempotency/stats';

export interface IdempotencyKey {
	key: string;
	method: string;
	path: string;
	completed: boolean;
	replay_count: number;
	created_at: string;
}

export interface IdempotencyStats {
	total: number;
	completed: number;
	in_flight: number;
}

export async function readStats(client: HttpClient): Promise<IdempotencyStats> {
	return client.get<IdempotencyStats>(STATS_URL);
}

export async function listKeys(
	client: HttpClient,
	limit: number,
	offset: number
): Promise<ListEnvelope<IdempotencyKey>> {
	return client.get<ListEnvelope<IdempotencyKey>>(`${KEYS_URL}?limit=${limit}&offset=${offset}`);
}

/** Drops one key so the next request carrying it runs the handler again. */
export async function releaseKey(client: HttpClient, key: string): Promise<void> {
	await client.delete(`${KEYS_URL}/${encodeURIComponent(key)}`);
}

/**
 * Keys recorded but never completed.
 *
 * Either a request in flight this second, or one whose process died between
 * recording the key and storing the response. The second kind refuses every
 * retry of that key until it expires, which reads to the caller as the write
 * having been accepted when it never happened.
 */
export function stuck(keys: readonly IdempotencyKey[]): IdempotencyKey[] {
	return keys.filter((k) => !k.completed);
}

/**
 * How long a key has been held, in seconds.
 *
 * The age is what separates the two kinds of in-flight key: a request takes
 * milliseconds, so a key minutes old is one nobody is going to complete.
 */
export function ageSeconds(key: IdempotencyKey, now: Date = new Date()): number {
	const at = Date.parse(key.created_at);
	if (Number.isNaN(at)) return 0;
	return Math.max(0, Math.round((now.getTime() - at) / 1000));
}

/**
 * The age past which an incomplete key is a leftover rather than a request in
 * progress.
 *
 * Sixty seconds, which is far longer than any handler this engine runs and
 * short enough that a genuine leftover is found the same day.
 */
export const ABANDONED_AFTER_SECONDS = 60;

export function abandoned(
	keys: readonly IdempotencyKey[],
	now: Date = new Date()
): IdempotencyKey[] {
	return stuck(keys).filter((k) => ageSeconds(k, now) > ABANDONED_AFTER_SECONDS);
}

/** Requests answered from a stored response rather than by running again. */
export function replaysServed(keys: readonly IdempotencyKey[]): number {
	return keys.reduce((sum, k) => sum + (k.replay_count ?? 0), 0);
}

export function keyTone(
	key: IdempotencyKey,
	now: Date = new Date()
): StatusTone {
	if (key.completed) return 'success';
	return ageSeconds(key, now) > ABANDONED_AFTER_SECONDS ? 'danger' : 'warn';
}

export function keyLabel(key: IdempotencyKey, now: Date = new Date()): string {
	if (key.completed) return 'Stored';
	return ageSeconds(key, now) > ABANDONED_AFTER_SECONDS ? 'Never finished' : 'In flight';
}

/** An age a person reads. */
export function ageLabel(seconds: number): string {
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h`;
	return `${Math.floor(hours / 24)}d`;
}
