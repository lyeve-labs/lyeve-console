/**
 * The request-capture plugin's admin routes.
 *
 * A capture is a request this instance served, kept with its response for a
 * while so it can be replayed and compared. Without a rule the plugin keeps
 * every request for its default day. A tenant with at least one enabled rule
 * keeps only what a rule matches, sampled at the rule's rate, for the rule's
 * retention. That inversion is the thing a reader misses: the first rule
 * narrows what is captured, it does not add to it.
 *
 * A replay set is a named list of captures replayed together, each answering
 * its own diff against the original. Whether this instance may create a rule
 * or a set is the plugin's answer, `licensed` on its reads. Replaying a set
 * that exists is not gated by it.
 */
import type { HttpClient } from '@lyeve-labs/client';
import type { ListEnvelope } from './list';
import { plural } from '$lib/format';

const CAPTURES_URL = '/api/admin/request-captures';
const CAPTURE_RULES_URL = `${CAPTURES_URL}/rules`;
const REPLAY_SETS_URL = `${CAPTURES_URL}/sets`;

export interface Capture {
	id: string;
	captured_at: string;
	method: string;
	url: string;
	status_code: number;
	duration_ms: number;
	ttl_seconds: number;
	tenant_id?: string;
}

export interface CapturesRead extends ListEnvelope<Capture> {
	licensed?: boolean;
}

export type RuleMethod = '*' | 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

export const RULE_METHODS: readonly RuleMethod[] = ['*', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

export interface CaptureRule {
	id: string;
	route_pattern: string;
	method: RuleMethod;
	/** The share of matching requests kept, 0 to 1. */
	sample_rate: number;
	retention_seconds: number;
	enabled: boolean;
	created_at: string;
	updated_at: string;
}

export interface SaveCaptureRule {
	route_pattern: string;
	method: RuleMethod;
	sample_rate: number;
	retention_seconds: number;
	enabled: boolean;
}

export interface ReplaySet {
	id: string;
	name: string;
	capture_ids: string[];
	created_at: string;
}

/** One capture's diff against its replay. */
export interface CaptureDiff {
	id1: string;
	id2: string;
	status_match: boolean;
	status_code1: number;
	status_code2: number;
	body_diff?: string;
	headers_diff?: string;
	duration1_ms: number;
	duration2_ms: number;
}

/** One capture's outcome in a batch replay. A failed one carries an error and the rest still ran. */
export interface SetReplayResult {
	capture_id: string;
	/** The captured request's method and path. An expired capture carries neither. */
	method?: string;
	path?: string;
	replay_id?: string;
	diff?: CaptureDiff;
	error?: string;
}

export interface SetReplay {
	set_id: string;
	results: SetReplayResult[];
}

/** The longest and shortest retention a rule may keep, in seconds. */
export const MIN_RETENTION_SECONDS = 3600;
export const MAX_RETENTION_SECONDS = 30 * 86400;

/** How many captures one set may hold. A batch replay runs them inside one request. */
export const MAX_SET_CAPTURES = 50;

/** The retentions the form offers, from an hour to the 30 days the plugin allows. */
export const RETENTION_CHOICES: readonly { seconds: number; label: string }[] = [
	{ seconds: 3600, label: '1 hour' },
	{ seconds: 6 * 3600, label: '6 hours' },
	{ seconds: 86400, label: '1 day' },
	{ seconds: 3 * 86400, label: '3 days' },
	{ seconds: 7 * 86400, label: '7 days' },
	{ seconds: 14 * 86400, label: '14 days' },
	{ seconds: 30 * 86400, label: '30 days' },
];

export async function listCaptures(client: HttpClient, limit: number, offset: number): Promise<CapturesRead> {
	return client.get<CapturesRead>(`${CAPTURES_URL}?limit=${limit}&offset=${offset}`);
}

export async function listCaptureRules(
	client: HttpClient,
): Promise<{ data?: CaptureRule[] | null; licensed?: boolean }> {
	return client.get(CAPTURE_RULES_URL);
}

export async function createCaptureRule(client: HttpClient, body: SaveCaptureRule): Promise<CaptureRule> {
	return client.post<CaptureRule>(CAPTURE_RULES_URL, body);
}

export async function updateCaptureRule(
	client: HttpClient,
	id: string,
	body: Partial<SaveCaptureRule>,
): Promise<CaptureRule> {
	return client.patch<CaptureRule>(`${CAPTURE_RULES_URL}/${encodeURIComponent(id)}`, body);
}

export async function deleteCaptureRule(client: HttpClient, id: string): Promise<void> {
	await client.delete(`${CAPTURE_RULES_URL}/${encodeURIComponent(id)}`);
}

export async function listReplaySets(
	client: HttpClient,
): Promise<{ data?: ReplaySet[] | null; licensed?: boolean }> {
	return client.get(REPLAY_SETS_URL);
}

export async function createReplaySet(
	client: HttpClient,
	body: { name: string; capture_ids: string[] },
): Promise<ReplaySet> {
	return client.post<ReplaySet>(REPLAY_SETS_URL, body);
}

export async function deleteReplaySet(client: HttpClient, id: string): Promise<void> {
	await client.delete(`${REPLAY_SETS_URL}/${encodeURIComponent(id)}`);
}

/**
 * The code a replay answers 428 for when the set holds a write and the
 * request did not cover it.
 */
export const CONFIRM_WRITES = 'request_capture.confirm_writes';

/**
 * Replays every capture in a set. `confirm_replay` acknowledges that the
 * replay carries the caller's own credentials in place of the redacted ones,
 * and it is always sent, so its own 428 never comes back. `confirm_mutating`
 * covers every write in the set, and without it a set that holds one is
 * refused before any of it runs.
 */
export async function replaySet(client: HttpClient, id: string, confirmMutating: boolean): Promise<SetReplay> {
	return client.post<SetReplay>(`${REPLAY_SETS_URL}/${encodeURIComponent(id)}/replay`, {
		confirm_replay: true,
		...(confirmMutating ? { confirm_mutating: true } : {}),
	});
}

/** A route pattern the plugin accepts: an absolute path, ** only last. */
export function capturePatternIsSound(pattern: string): boolean {
	const p = pattern.trim();
	if (!p.startsWith('/') || p.length < 2 || p.length > 512 || /[?#\s]/.test(p)) return false;
	const segs = p.slice(1).split('/');
	return segs.every((s, i) => s !== '' && (s !== '**' || i === segs.length - 1));
}

/** "Every method" for the wildcard, the method itself otherwise. */
export function methodLabel(m: string): string {
	return m === '*' ? 'Every method' : m;
}

/** A sample rate as the percentage a person reads. */
export function sampleLabel(rate: number): string {
	const pct = Math.round(rate * 1000) / 10;
	return `${pct}%`;
}

/** A retention in the largest whole unit it fills. */
export function retentionLabel(seconds: number): string {
	if (seconds % 86400 === 0) {
		const d = seconds / 86400;
		return `${d} ${plural(d, 'day')}`;
	}
	if (seconds % 3600 === 0) {
		const h = seconds / 3600;
		return `${h} ${plural(h, 'hour')}`;
	}
	return `${Math.round(seconds / 60)} minutes`;
}

/** The retention choices, with a stored value outside them kept as its own option. */
export function retentionOptions(current?: number): { value: string; label: string }[] {
	const opts = RETENTION_CHOICES.map((c) => ({ value: String(c.seconds), label: c.label }));
	if (current && !RETENTION_CHOICES.some((c) => c.seconds === current)) {
		opts.push({ value: String(current), label: retentionLabel(current) });
		opts.sort((a, b) => Number(a.value) - Number(b.value));
	}
	return opts;
}

/** A capture's path, without the scheme and host every row shares. */
export function capturePath(url: string): string {
	try {
		const u = new URL(url);
		return `${u.pathname}${u.search}`;
	} catch {
		return url;
	}
}

/** Whether a replay changed what the caller saw: the status, the headers or the body. */
export function diffChanged(d: CaptureDiff): boolean {
	return !d.status_match || !!d.body_diff || !!d.headers_diff;
}
