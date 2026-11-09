/**
 * What the search plugin is set to do for this tenant: which schemas anyone
 * may search, how fields weigh against each other, which terms stand for
 * others, and what people have been searching for.
 */
import type { HttpClient } from '@lyeve-labs/client';
import { rowsOf } from './list';
import type { RankWeightBoost, SearchResult, SynonymGroup } from '@lyeve-labs/client-rest';

export interface SearchAnalytics {
	total_searches: number;
	unique_queries: number;
	avg_result_count: number;
	avg_duration_ms: number;
	zero_result_pct: number;
	top_queries: { query_text: string; count: number }[];
}

export interface RankingWeights {
	title_weight: number;
	body_weight: number;
	tag_weight: number;
}

export function getPublicSchemas(client: HttpClient): Promise<string[]> {
	return client.get<{ schemas: string[] }>('/api/admin/search/public-schemas').then((r) => r.schemas ?? []);
}

export function setPublicSchemas(client: HttpClient, schemas: string[]): Promise<string[]> {
	return client.put<{ schemas: string[] }>('/api/admin/search/public-schemas', { schemas }).then((r) => r.schemas ?? []);
}

export function getSearchAnalytics(client: HttpClient): Promise<SearchAnalytics> {
	return client.get<SearchAnalytics>('/api/admin/search/analytics');
}

/**
 * Weights for every schema that has no row of its own. The plugin replaces
 * the whole row, so the boost rules the caller read go back beside the
 * weights. Left out, they would be written as none.
 */
export function setDefaultRanking(
	client: HttpClient,
	w: RankingWeights,
	boostRules: RankWeightBoost[] = [],
): Promise<unknown> {
	return client.put('/api/admin/search/ranking', { schema_name: '*', ...w, boost_rules: boostRules });
}

/** One page of search results and how many matched in all. */
export interface SearchPage {
	results: SearchResult[];
	total: number;
}

/**
 * One page of a search. The plugin answers 20 rows unless asked for more,
 * and its total counts every match, which the page states instead of the
 * rows it holds.
 */
export async function searchPage(client: HttpClient, q: string, limit: number, offset: number): Promise<SearchPage> {
	const query = new URLSearchParams({ q, limit: String(limit), offset: String(offset) });
	const res = await client.get<{ results?: SearchResult[] | null; total?: number }>(`/api/admin/search?${query}`);
	const results = res.results ?? [];
	return { results, total: typeof res.total === 'number' ? Math.max(res.total, results.length) : results.length };
}

/** The most synonym groups one read asks for, which is the engine's page ceiling. */
export const SYNONYM_LIMIT = 500;

/** The synonym groups one read gave, and how many the plugin holds. */
export interface SynonymList {
	groups: SynonymGroup[];
	total: number;
}

/**
 * The tenant's synonym groups, up to the engine's page ceiling. The plugin
 * answers 50 unless asked, and a group past that could not be seen or
 * deleted.
 */
export async function listSynonymGroups(client: HttpClient): Promise<SynonymList> {
	const res = await client.get<{ data?: SynonymGroup[] | null; total_count?: number } | SynonymGroup[]>(
		`/api/admin/search/synonyms?limit=${SYNONYM_LIMIT}&offset=0`,
	);
	const groups = rowsOf(res);
	const counted = Array.isArray(res) ? groups.length : res.total_count;
	return { groups, total: typeof counted === 'number' ? Math.max(counted, groups.length) : groups.length };
}

export function createSynonym(client: HttpClient, name: string, baseTerm: string, synonyms: string[]): Promise<unknown> {
	return client.post('/api/admin/search/synonyms', { name, base_term: baseTerm, synonyms });
}

export function deleteSynonym(client: HttpClient, id: string): Promise<unknown> {
	return client.delete(`/api/admin/search/synonyms/${encodeURIComponent(id)}`);
}

export function reindexSearch(client: HttpClient): Promise<{ indexed: number; message: string }> {
	return client.post('/api/admin/search/reindex', {});
}

/** Schema names from the engine's schema list, sorted. */
export async function listSchemaNames(client: HttpClient): Promise<string[]> {
	const rows = await client.get<{ name: string }[] | { data: { name: string }[] }>('/api/admin/schemas');
	const list = Array.isArray(rows) ? rows : (rows.data ?? []);
	return list.map((s) => s.name).filter(Boolean).sort();
}

/** Terms from a comma list: trimmed, empty ones dropped, each once. */
export function parseTerms(raw: string): string[] {
	const out: string[] = [];
	for (const part of raw.split(',')) {
		const t = part.trim();
		if (t && !out.includes(t)) out.push(t);
	}
	return out;
}

/** A weight from a form field, or null when it is not a number from 0 to 10. */
export function parseWeight(raw: FormDataEntryValue | null): number | null {
	const n = Number(String(raw ?? '').trim());
	if (String(raw ?? '').trim() === '' || !Number.isFinite(n) || n < 0 || n > 10) return null;
	return n;
}
