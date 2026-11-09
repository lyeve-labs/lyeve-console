/**
 * The recommendations plugin's admin routes.
 *
 * The plugin computes similarity pairs, trending items and a per-user feed on
 * a cycle, and holds out a share of users as a control who get random picks
 * instead. Three admin routes: the aggregate split, a recompute, and a feed
 * generated for one named user so somebody can see what a person would get.
 *
 * The recompute is the one with teeth. It rebuilds everything, the plugin
 * takes a lock so only one can run at a time, and on a large corpus it is
 * minutes rather than seconds. It answers 409 while one is already running,
 * which the screen has to report as "already running" and not as a failure.
 */
import type { StatusTone } from '@lyeve-labs/ui-kit';
import { ApiError, type HttpClient } from '@lyeve-labs/client';

const AB_STATS_URL = '/api/admin/recommendations/ab-stats';
const REFRESH_URL = '/api/admin/recommendations/refresh';
const GENERATE_FEED_URL = '/api/admin/recommendations/generate-feed';

/** How the users are split between recommendations and the control arm. */
export interface AbStats {
	recommendation_count: number;
	random_count: number;
	total_users: number;
	recommendation_pct: number;
	random_pct: number;
}

export interface RefreshResult {
	similarity_pairs_computed: number;
	trending_items_computed: number;
	feeds_generated: number;
	duration_ms: number;
}

export interface FeedEntry {
	id: string;
	user_id: string;
	content_id: string;
	score: number;
	source: string;
	created_at: string;
}

export async function readAbStats(client: HttpClient): Promise<AbStats> {
	return client.get<AbStats>(AB_STATS_URL);
}

export async function refreshAll(client: HttpClient): Promise<RefreshResult> {
	return client.post<RefreshResult>(REFRESH_URL, {});
}

/** Generates one reader's feed now. The plugin answers `{entries, total}`. */
export async function generateFeed(client: HttpClient, userId: string): Promise<FeedEntry[]> {
	const res = await client.post<unknown>(`${GENERATE_FEED_URL}/${encodeURIComponent(userId)}`, {});
	if (Array.isArray(res)) return res as FeedEntry[];
	const entries = res && typeof res === 'object' ? (res as { entries?: unknown }).entries : undefined;
	return Array.isArray(entries) ? (entries as FeedEntry[]) : [];
}

const USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether a value has the shape of a user id, which the engine issues as a UUID. */
export function isUserId(value: string): boolean {
	return USER_ID.test(value);
}

/**
 * Whether a refusal means a recompute is already under way.
 *
 * The plugin takes a lock and answers 409, which is not a failure: it means
 * somebody else pressed the button first, and reporting it as an error sends
 * an operator looking for a fault that is not there.
 */
export function isAlreadyRunning(err: unknown): boolean {
	return err instanceof ApiError && err.status === 409;
}

export const SOURCE_LABELS: Readonly<Record<string, string>> = {
	similar: 'Similar to something they read',
	trending: 'Trending now',
	collaborative: 'People like them read it',
	random: 'Random, control arm',
};

export function sourceLabel(source: string): string {
	return SOURCE_LABELS[source] ?? source;
}

/**
 * Random picks are the control arm, so a feed made of them is not a broken
 * feed. It is the measurement, and marking it apart stops that reading.
 */
export function sourceTone(source: string): StatusTone {
	return source === 'random' ? 'neutral' : 'brand';
}

/**
 * Whether the split is far enough from its intent to be worth saying.
 *
 * Each reader is assigned at random, so the arms are never exactly even and
 * a few points of drift is normal. Ten points is not: at that distance the
 * control arm is either too small to measure against or large enough that a
 * real share of users are getting random content.
 */
export const SPLIT_DRIFT_LIMIT = 10;

export function splitIsSkewed(stats: AbStats | null): boolean {
	if (!stats || stats.total_users === 0) return false;
	return Math.abs(stats.recommendation_pct - stats.random_pct) > 100 - 2 * SPLIT_DRIFT_LIMIT;
}

/**
 * Whether the numbers describe anybody at all.
 *
 * A fresh install has recommended to nobody, which is correct and must not be
 * drawn as a fifty-fifty split of zero people.
 */
export function hasUsers(stats: AbStats | null): boolean {
	return !!stats && stats.total_users > 0;
}

/**
 * A score at a precision the model supports.
 *
 * Scores are unbounded floats out of the similarity computation. Printing one
 * raw puts fifteen digits in a table cell and implies a precision that ranking
 * does not have.
 */
export function score(value: number | null | undefined): string {
	if (value === null || value === undefined || !Number.isFinite(value)) return '-';
	return value.toFixed(3);
}

const TRENDING_URL = '/api/v1/recommendations/trending';

/** One item on the trending list, as the last recompute ranked it. */
export interface TrendingItem {
	content_id: string;
	title: string;
	slug: string;
	score: number;
	view_count: number;
}

export async function readTrending(client: HttpClient, limit = 10): Promise<TrendingItem[]> {
	const res = await client.get<{ items?: TrendingItem[] }>(`${TRENDING_URL}?limit=${limit}`);
	return res.items ?? [];
}

/** The calls an application makes, in the order it needs them. */
export const INTEGRATION_EXAMPLE = `# Record what a reader did: view, like, bookmark or share.
POST /api/v1/recommendations/behavior
{"content_id": "<entry id>", "action": "view"}

# Entries like this one, for a "more like this" block.
GET /api/v1/recommendations/similar?content_id=<entry id>&limit=10

# What is being read most this week.
GET /api/v1/recommendations/trending?limit=20

# This reader's own feed, from what people like them read.
GET /api/v1/recommendations/feed?limit=20`;
