/**
 * The cache plugin's admin routes.
 *
 * Two things a reader confuses here, so the module keeps them apart. Stats are
 * cumulative counters for the process: hits, misses, evictions. Providers are
 * the backends behind them, each with a circuit breaker that can be open while
 * the cache as a whole still answers, because a lower-priority provider picks
 * up. A hit rate that looks healthy while a provider's circuit is open is the
 * normal reading and it hides a broken backend.
 *
 * Flushing is the destructive control. It is not a cache-clearing convenience:
 * every flushed key is recomputed on its next request, so a flush at the wrong
 * moment is a thundering herd against the database.
 */
import type { StatusTone } from '@lyeve-labs/ui-kit';
import type { HttpClient } from '@lyeve-labs/client';
import type { ListEnvelope } from './list';
import type { Limit } from './limits';
import { plural } from '$lib/format';

const STATS_URL = '/api/admin/cache/stats';
const PROVIDERS_URL = '/api/admin/cache/providers';
const ENTRIES_URL = '/api/admin/cache/entries';
const FLUSH_URL = '/api/admin/cache/flush';

export interface CacheStats {
	hits: number;
	misses: number;
	sets: number;
	deletes: number;
	flushes: number;
	evictions: number;
	entries: number;
	max_size: number;
}

export interface CircuitConfig {
	max_consecutive_failures: number;
	open_timeout: number;
	half_open_max_successes: number;
	failure_window: number;
	enabled: boolean;
}

export interface CacheProvider {
	name: string;
	kind: string;
	url?: string;
	priority: number;
	default_ttl?: number;
	max_entries?: number;
	circuit?: CircuitConfig;
	enabled: boolean;
	/** Reported by the metrics route rather than the config route. */
	circuit_state?: string;
	hits?: number;
	misses?: number;
}

export interface CacheEntry {
	key: string;
	size: number;
	expires_at: string;
	created_at: string;
	ttl_mode: string;
	tags: string[] | null;
}

export async function readStats(client: HttpClient): Promise<CacheStats> {
	return client.get<CacheStats>(STATS_URL);
}

/**
 * Why a configured provider is not serving. The plugin sends a code and the
 * console says it in its own words, so the response names no capability.
 */
export type InactiveReason = 'provider_limit' | 'networked_unavailable' | 'create_failed' | 'register_failed';

/** A provider the deployment configured that is not running. */
export interface InactiveProvider {
	name: string;
	kind: string;
	priority: number;
	reason: InactiveReason | string;
}

export interface ProvidersRead extends ListEnvelope<CacheProvider> {
	/** Whether this instance runs every configured provider with failover. */
	licensed?: boolean;
	inactive?: InactiveProvider[] | null;
}

export async function listProviders(client: HttpClient): Promise<ProvidersRead> {
	return client.get<ProvidersRead>(PROVIDERS_URL);
}

/** What each reason means to the person reading the list. */
export function inactiveReason(reason: string): string {
	switch (reason) {
		case 'provider_limit':
			return 'Not running. Only one provider runs on this engine.';
		case 'networked_unavailable':
			return 'Not running. Networked cache providers are not enabled on this engine.';
		case 'create_failed':
			return 'Could not start. Check its address and settings in your deployment.';
		case 'register_failed':
			return 'Could not start because another provider already uses its name.';
		default:
			return 'Not running.';
	}
}

/** A response cache rule: a public read route the cache serves, for how long, and what purges it. */
export interface CacheRule {
	id: string;
	pattern: string;
	ttl_seconds: number;
	tags: string[];
	enabled: boolean;
	created_at: string;
	updated_at: string;
}

export type { Limit };

export interface RulesRead {
	data?: CacheRule[] | null;
	total_count?: number;
	licensed?: boolean;
	limits?: { rules?: Limit };
}

const RULES_URL = '/api/admin/cache/rules';

export interface SaveCacheRule {
	pattern: string;
	ttl_seconds: number;
	tags: string[];
	enabled: boolean;
}

export async function listRules(client: HttpClient): Promise<RulesRead> {
	return client.get<RulesRead>(RULES_URL);
}

export async function createRule(client: HttpClient, body: SaveCacheRule): Promise<CacheRule> {
	return client.post<CacheRule>(RULES_URL, body);
}

export async function updateRule(client: HttpClient, id: string, body: SaveCacheRule): Promise<CacheRule> {
	return client.put<CacheRule>(`${RULES_URL}/${encodeURIComponent(id)}`, body);
}

export async function deleteRule(client: HttpClient, id: string): Promise<void> {
	await client.delete(`${RULES_URL}/${encodeURIComponent(id)}`);
}

/** Evicts every response one rule cached, and answers how many went. */
export async function purgeRule(client: HttpClient, id: string): Promise<number> {
	const res = await client.post<{ purged?: number }>(`${RULES_URL}/${encodeURIComponent(id)}/purge`, {});
	return res?.purged ?? 0;
}

/** Evicts the tenant's responses carrying a tag, or all of them with no tag. */
export async function purgeResponses(client: HttpClient, tag: string): Promise<number> {
	const res = await client.post<{ purged?: number }>(`${RULES_URL}/purge`, tag ? { tag } : {});
	return res?.purged ?? 0;
}

/**
 * "4 of 10 rules" when the instance holds a ceiling, and the count alone when
 * it holds none. The numbers come from the plugin's read, never from here.
 */
export function ruleCount(limit: Limit | undefined, shown: number): string {
	const current = limit?.current ?? shown;
	const noun = plural(current, 'rule');
	if (limit && limit.limit !== null) return `${current} of ${limit.limit} rules`;
	return `${current} ${noun}`;
}


/** A rule pattern the plugin accepts: a path under /api/v1/ with no query. */
export function patternIsSound(pattern: string): boolean {
	const p = pattern.trim();
	if (!p.startsWith('/api/v1/') || p.length <= '/api/v1/'.length || p.length > 255) return false;
	if (/[?#\s]/.test(p)) return false;
	const segs = p.replace(/^\/+|\/+$/g, '').split('/');
	return segs.every((s, i) => s !== '' && (s !== '**' || i === segs.length - 1));
}

/** The tags a comma or space separated field names, trimmed and without repeats. */
export function parseTags(raw: string): string[] {
	const seen = new Set<string>();
	for (const t of raw.split(/[\s,]+/)) if (t) seen.add(t);
	return [...seen];
}

/** A tag the plugin accepts: 1 to 64 letters, digits, dots, dashes or underscores. */
export function tagIsSound(tag: string): boolean {
	return /^[A-Za-z0-9_.-]{1,64}$/.test(tag);
}

/** A TTL in the unit a person thinks in. */
export function ttlLabel(seconds: number): string {
	if (seconds % 86400 === 0) return `${seconds / 86400} d`;
	if (seconds % 3600 === 0) return `${seconds / 3600} h`;
	if (seconds % 60 === 0) return `${seconds / 60} min`;
	return `${seconds} s`;
}

export async function listEntries(
	client: HttpClient,
	limit: number,
	offset: number
): Promise<ListEnvelope<CacheEntry> & { note?: string }> {
	// A provider that cannot list its entries answers an empty page and a note.
	return client.get<ListEnvelope<CacheEntry> & { note?: string }>(`${ENTRIES_URL}?limit=${limit}&offset=${offset}`);
}

export async function flushAll(client: HttpClient): Promise<void> {
	await client.post(FLUSH_URL, {});
}

export async function flushTag(client: HttpClient, tag: string): Promise<void> {
	await client.post(`${FLUSH_URL}/${encodeURIComponent(tag)}`, {});
}

export async function resetCircuit(client: HttpClient, name: string): Promise<void> {
	await client.post(`${PROVIDERS_URL}/${encodeURIComponent(name)}/reset-circuit`, {});
}

/**
 * Share of lookups that were served from cache.
 *
 * Null when nothing has been looked up. A fresh process has hit none of
 * nothing, and reporting that as 0% reads as a cache that is not working,
 * which is the opposite of what it means.
 */
export function hitRate(stats: CacheStats | null): number | null {
	if (!stats) return null;
	const lookups = stats.hits + stats.misses;
	if (lookups === 0) return null;
	return Math.round((stats.hits / lookups) * 1000) / 10;
}

/**
 * Whether the cache is evicting rather than expiring.
 *
 * Evictions mean entries were pushed out before their TTL because the store
 * was full. That is a capacity problem wearing the costume of a working
 * cache: the hit rate falls and nothing errors.
 */
export function underPressure(stats: CacheStats | null): boolean {
	if (!stats) return false;
	return stats.evictions > 0;
}

/** How full the store is, as a fraction, or null when no ceiling is set. */
export function fullness(stats: CacheStats | null): number | null {
	if (!stats || stats.max_size <= 0) return null;
	return Math.min(1, stats.entries / stats.max_size);
}

export type CircuitState = 'closed' | 'open' | 'half-open' | 'unknown';

export function circuitState(provider: CacheProvider): CircuitState {
	const raw = (provider.circuit_state ?? '').toLowerCase().replace('_', '-');
	if (raw === 'open' || raw === 'closed' || raw === 'half-open') return raw;
	return 'unknown';
}

export const CIRCUIT_LABELS: Readonly<Record<CircuitState, string>> = {
	closed: 'Healthy',
	open: 'Taken out of use after failures',
	'half-open': 'Testing whether it recovered',
	unknown: 'Not reported',
};

export function circuitTone(state: CircuitState): StatusTone {
	if (state === 'closed') return 'success';
	if (state === 'open') return 'danger';
	if (state === 'half-open') return 'warn';
	return 'neutral';
}

/**
 * Providers that are cut out.
 *
 * This is the reading the stats hide. A lower-priority provider picks up when
 * one trips, so the hit rate stays plausible while a backend is entirely out
 * of service and nothing else reports it.
 */
export function trippedProviders(providers: readonly CacheProvider[]): CacheProvider[] {
	return providers.filter((p) => circuitState(p) === 'open');
}

/** Every tag in use, so a targeted flush can offer them rather than ask. */
export function tagsOf(entries: readonly CacheEntry[]): string[] {
	const seen = new Set<string>();
	for (const e of entries) {
		for (const tag of e.tags ?? []) seen.add(tag);
	}
	return [...seen].sort();
}
