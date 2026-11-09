import { describe, expect, it } from 'vitest';
import {
	circuitState,
	circuitTone,
	fullness,
	hitRate,
	tagsOf,
	trippedProviders,
	underPressure,
	type CacheEntry,
	type CacheProvider,
	type CacheStats,
} from './cache';

function stats(over: Partial<CacheStats> = {}): CacheStats {
	return {
		hits: 900,
		misses: 100,
		sets: 100,
		deletes: 0,
		flushes: 0,
		evictions: 0,
		entries: 500,
		max_size: 1000,
		...over,
	};
}

function provider(over: Partial<CacheProvider> = {}): CacheProvider {
	return { name: 'redis', kind: 'redis', priority: 1, enabled: true, ...over };
}

describe('the hit rate', () => {
	it('reads as a percentage of lookups', () => {
		expect(hitRate(stats())).toBe(90);
		expect(hitRate(stats({ hits: 1, misses: 2 }))).toBe(33.3);
	});

	// A fresh process has hit none of nothing. Reporting 0% reads as a cache
	// that is not working, which is the opposite of what it means.
	it('reports nothing rather than zero when nothing was looked up', () => {
		expect(hitRate(stats({ hits: 0, misses: 0 }))).toBeNull();
		expect(hitRate(null)).toBeNull();
	});
});

describe('a cache under pressure', () => {
	// Evictions mean entries left before their TTL because the store filled.
	// A capacity problem dressed as a working cache: the rate falls, nothing
	// errors.
	it('separates evicting from merely expiring', () => {
		expect(underPressure(stats({ evictions: 12 }))).toBe(true);
		expect(underPressure(stats())).toBe(false);
		expect(underPressure(null)).toBe(false);
	});

	it('reports fullness only where a ceiling is set', () => {
		expect(fullness(stats())).toBe(0.5);
		expect(fullness(stats({ max_size: 0 }))).toBeNull();
		expect(fullness(null)).toBeNull();
	});
});

describe('the circuit breaker', () => {
	// The reading the stats hide: a lower-priority provider picks up, so the
	// hit rate stays plausible while a backend is entirely out of service.
	it('finds providers that are cut out', () => {
		const providers = [provider(), provider({ name: 'memory', circuit_state: 'open' })];
		expect(trippedProviders(providers).map((p) => p.name)).toEqual(['memory']);
	});

	it('reads every spelling of the state, and says when there is none', () => {
		expect(circuitState(provider({ circuit_state: 'OPEN' }))).toBe('open');
		expect(circuitState(provider({ circuit_state: 'half_open' }))).toBe('half-open');
		expect(circuitState(provider({ circuit_state: 'closed' }))).toBe('closed');
		expect(circuitState(provider())).toBe('unknown');
	});

	// Not reported is not healthy, and coloring it green would hide a
	// provider nobody is measuring.
	it('never paints an unreported circuit as healthy', () => {
		expect(circuitTone('unknown')).toBe('neutral');
		expect(circuitTone('closed')).toBe('success');
		expect(circuitTone('open')).toBe('danger');
		expect(circuitTone('half-open')).toBe('warn');
	});
});

describe('entries', () => {
	it('collects every tag in use, sorted and without repeats', () => {
		const entries: CacheEntry[] = [
			{ key: 'a', size: 1, expires_at: '', created_at: '', ttl_mode: 'ttl', tags: ['posts', 'home'] },
			{ key: 'b', size: 1, expires_at: '', created_at: '', ttl_mode: 'ttl', tags: ['posts'] },
			{ key: 'c', size: 1, expires_at: '', created_at: '', ttl_mode: 'ttl', tags: null },
		];
		expect(tagsOf(entries)).toEqual(['home', 'posts']);
	});
});
