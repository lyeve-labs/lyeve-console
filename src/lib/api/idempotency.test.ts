import { describe, expect, it } from 'vitest';
import {
	ABANDONED_AFTER_SECONDS,
	abandoned,
	ageLabel,
	ageSeconds,
	keyLabel,
	keyTone,
	replaysServed,
	stuck,
	type IdempotencyKey,
} from './idempotency';

const NOW = new Date('2026-09-23T12:00:00Z');

function key(over: Partial<IdempotencyKey> = {}): IdempotencyKey {
	return {
		key: 'k1',
		method: 'POST',
		path: '/api/v1/orders',
		completed: true,
		replay_count: 0,
		created_at: '2026-09-23T11:59:59Z',
		...over,
	};
}

describe('keys that never finished', () => {
	// A key is recorded before the handler finishes. One still open minutes
	// later is a process that died mid-write, and it refuses every retry of
	// that key until it expires.
	it('separates a request in flight from one that died', () => {
		const inFlight = key({ completed: false, created_at: '2026-09-23T11:59:59Z' });
		const dead = key({ key: 'k2', completed: false, created_at: '2026-09-23T11:50:00Z' });

		expect(stuck([inFlight, dead])).toHaveLength(2);
		expect(abandoned([inFlight, dead], NOW).map((k) => k.key)).toEqual(['k2']);
	});

	it('calls a completed key stored, whatever its age', () => {
		const old = key({ created_at: '2026-01-01T00:00:00Z' });
		expect(abandoned([old], NOW)).toEqual([]);
		expect(keyLabel(old, NOW)).toBe('Stored');
		expect(keyTone(old, NOW)).toBe('success');
	});

	it('marks a dead key apart from one that is merely open', () => {
		const inFlight = key({ completed: false, created_at: '2026-09-23T11:59:59Z' });
		const dead = key({ completed: false, created_at: '2026-09-23T11:50:00Z' });
		expect(keyLabel(inFlight, NOW)).toBe('In flight');
		expect(keyTone(inFlight, NOW)).toBe('warn');
		expect(keyLabel(dead, NOW)).toBe('Never finished');
		expect(keyTone(dead, NOW)).toBe('danger');
	});

	it('uses a threshold longer than any handler this engine runs', () => {
		expect(ABANDONED_AFTER_SECONDS).toBeGreaterThanOrEqual(60);
	});
});

describe('ages', () => {
	it('counts from when the key was recorded', () => {
		expect(ageSeconds(key({ created_at: '2026-09-23T11:59:00Z' }), NOW)).toBe(60);
	});

	it('never reports a negative age or throws on rubbish', () => {
		expect(ageSeconds(key({ created_at: '2026-09-23T12:05:00Z' }), NOW)).toBe(0);
		expect(ageSeconds(key({ created_at: 'not a date' }), NOW)).toBe(0);
	});

	it('reads an age in the largest unit that fits', () => {
		expect(ageLabel(30)).toBe('30s');
		expect(ageLabel(600)).toBe('10m');
		expect(ageLabel(7200)).toBe('2h');
		expect(ageLabel(172800)).toBe('2d');
	});
});

describe('replays', () => {
	it('counts every request answered without running the handler', () => {
		expect(replaysServed([key({ replay_count: 2 }), key({ key: 'k2', replay_count: 3 })])).toBe(5);
		expect(replaysServed([])).toBe(0);
	});
});
