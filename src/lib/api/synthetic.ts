/**
 * The synthetic-monitoring plugin's admin routes.
 *
 * A probe is a check the instance runs against itself on a schedule: fetch a
 * URL, walk an API resource through create, read, update and delete, sign in,
 * or deliver a webhook and wait for the receipt. Each run is a result, and a
 * run of consecutive failures past the probe's threshold raises an alert.
 *
 * Three things could each be called "the state of a probe" and they are not
 * the same: whether it is switched on, how its last run went, and whether it
 * has an alert outstanding. A screen that merged them would show a disabled
 * probe as healthy, which is the reading that lets an outage go unnoticed.
 */
import type { StatusTone } from '@lyeve-labs/ui-kit';
import { toChannels, type AlertChannels } from './alert-channels';
import { ApiError, type HttpClient } from '@lyeve-labs/client';
import { rowsOf, type ListEnvelope } from './list';
import { plural } from '$lib/format';

const PROBES_URL = '/api/admin/synthetic-monitoring/probes';
const ALERTS_URL = '/api/admin/synthetic-monitoring/alerts';

export const PROBE_TYPES = [
	'health_check',
	'api_canary',
	'login_flow',
	'webhook_delivery',
] as const;
export type ProbeType = (typeof PROBE_TYPES)[number];

export type ProbeStatus = 'pass' | 'fail';

/** What each probe type actually does, for the reader choosing one. */
export const PROBE_TYPE_LABELS: Readonly<Record<ProbeType, string>> = {
	health_check: 'Health check',
	api_canary: 'API canary',
	login_flow: 'Sign-in flow',
	webhook_delivery: 'Webhook delivery',
};

export const PROBE_TYPE_HINTS: Readonly<Record<ProbeType, string>> = {
	health_check: 'Fetches a URL and checks the status code.',
	api_canary: 'Creates, reads, updates and deletes a resource, then verifies it is gone.',
	login_flow: 'Signs in with stored credentials and checks the session that comes back.',
	webhook_delivery: 'Sends a webhook and waits for the receipt.',
};

export interface ProbeConfig {
	url?: string;
	expected_status?: number;
	endpoint_base?: string;
	resource_path?: string;
	resource_id_field?: string;
	login_url?: string;
	username?: string;
	expected_redirect?: string;
	webhook_url?: string;
	headers?: Record<string, string> | null;
	/** Masked as "***" on every read. No read returns the stored value. */
	auth_token?: string;
	/** Masked as "***" on every read. No read returns the stored value. */
	password?: string;
	payload?: Record<string, unknown> | null;
	expected_response?: Record<string, string> | null;
}

/** What the plugin answers in place of a stored secret. */
export const SECRET_MASK = '***';

/**
 * The headers whose stored values a read masks. A probe save replaces the
 * stored config whole, so these cannot be sent back and the save drops them.
 */
export function maskedHeaders(config: ProbeConfig | null | undefined): string[] {
	return Object.entries(config?.headers ?? {})
		.filter(([, v]) => v === SECRET_MASK)
		.map(([k]) => k)
		.sort();
}

/**
 * The stored config a save sends back beside what the form shows. The plugin
 * replaces the config whole, so a key the form never shows is lost unless it
 * travels back. A masked secret cannot travel back: sending the mask would
 * store the mask, so it is left out and the form asks for it again.
 */
export function keptConfig(read: ProbeConfig | null | undefined): ProbeConfig {
	const kept: ProbeConfig = { ...(read ?? {}) };
	delete kept.auth_token;
	delete kept.password;
	if (kept.headers) {
		const headers = Object.fromEntries(Object.entries(kept.headers).filter(([, v]) => v !== SECRET_MASK));
		if (Object.keys(headers).length > 0) kept.headers = headers;
		else delete kept.headers;
	}
	return kept;
}

export interface Probe {
	id: string;
	tenant_id: string;
	name: string;
	type: ProbeType;
	enabled: boolean;
	config: ProbeConfig;
	interval_seconds: number;
	timeout_seconds: number;
	regions: string[] | null;
	alert_threshold: number;
	last_run_at?: string | null;
	last_status?: ProbeStatus | null;
	created_at: string;
	updated_at: string;
}

export interface ProbeResult {
	id: string;
	probe_id: string;
	status: ProbeStatus;
	status_code?: number | null;
	response_time_ms: number;
	error_message?: string;
	region: string;
	detail?: string;
	created_at: string;
}

export interface ProbeAlert {
	id: string;
	probe_id: string;
	probe_name: string;
	probe_type: ProbeType;
	consecutive_failures: number;
	last_failure_at: string;
	last_failure_error?: string;
	message: string;
	acknowledged: boolean;
	acknowledged_at?: string | null;
	created_at: string;
}

export async function listProbes(
	client: HttpClient,
	limit: number,
	offset: number
): Promise<ListEnvelope<Probe>> {
	return client.get<ListEnvelope<Probe>>(`${PROBES_URL}?limit=${limit}&offset=${offset}`);
}

/**
 * Outstanding alerts. Acknowledged ones are history and are not asked for.
 * The plugin answers a bare array.
 */
export async function listOpenAlerts(client: HttpClient, limit = 50): Promise<ListEnvelope<ProbeAlert>> {
	const raw = await client.get<ListEnvelope<ProbeAlert> | ProbeAlert[]>(
		`${ALERTS_URL}?acknowledged=false&limit=${limit}&offset=0`
	);
	const data = rowsOf(raw);
	return { data, total_count: Array.isArray(raw) ? data.length : (raw?.total_count ?? data.length) };
}

export interface SaveProbe {
	name: string;
	type: ProbeType;
	enabled: boolean;
	config: ProbeConfig;
	interval_seconds: number;
	timeout_seconds: number;
	alert_threshold: number;
	/** The plugin stores an absent list as none, so an edit sends back what it read. */
	regions?: string[];
}

export async function createProbe(client: HttpClient, body: SaveProbe): Promise<Probe> {
	return client.post<Probe>(PROBES_URL, body);
}

export async function updateProbe(
	client: HttpClient,
	id: string,
	body: SaveProbe
): Promise<Probe> {
	return client.put<Probe>(`${PROBES_URL}/${encodeURIComponent(id)}`, body);
}

export async function deleteProbe(client: HttpClient, id: string): Promise<void> {
	await client.delete(`${PROBES_URL}/${encodeURIComponent(id)}`);
}

/**
 * How long Run now waits for its answer. A run that fails in several regions
 * can take half a minute, and the engine answers no request after about 30
 * seconds, so the wait ends a little past that rather than at the client's
 * default.
 */
const RUN_NOW_WAIT_MS = 35_000;

/** Runs a probe now. The answer is one result per region it is watched from. */
export async function runProbeNow(client: HttpClient, id: string): Promise<ProbeResult[]> {
	const res = await client.post<unknown>(`${PROBES_URL}/${encodeURIComponent(id)}/run`, {}, {
		signal: AbortSignal.timeout(RUN_NOW_WAIT_MS),
	});
	return Array.isArray(res) ? (res as ProbeResult[]) : [];
}

/**
 * Whether Run now ended with no answer at all: the wait ran out or the
 * connection dropped. The run goes on without its caller and records its
 * results, so this is not a failure.
 */
export function runOutlastedTheWait(err: unknown): boolean {
	return err instanceof TypeError || (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError'));
}

/** Whether the engine refused Run now because a run of the probe is going. */
export function runAlreadyGoing(err: unknown): boolean {
	return err instanceof ApiError && err.status === 409;
}

/** What Run now says when the run is still going, its own or an earlier one. */
export function runGoingOnText(name: string, already: boolean): string {
	const first = already ? `${name} is already running.` : `${name} is still running.`;
	return `${first} Its results appear in the list when it finishes.`;
}

/** How one run went across its regions. */
export interface RunOutcome {
	/** Failed when any region failed. Null when the run recorded no result. */
	status: ProbeStatus | null;
	/** The slowest region's response time, in milliseconds. */
	ms: number;
	failed: number;
	regions: number;
}

/**
 * One run read as a whole.
 *
 * A run is a result per region, and a run fails when any region fails, which
 * is also what counts toward the alert. Timed by the slowest region, because
 * that is the time the run took.
 */
export function runOutcome(results: readonly ProbeResult[]): RunOutcome {
	const failed = results.filter((r) => r.status === 'fail').length;
	return {
		status: results.length === 0 ? null : failed > 0 ? 'fail' : 'pass',
		ms: results.reduce((slowest, r) => Math.max(slowest, r.response_time_ms || 0), 0),
		failed,
		regions: results.length,
	};
}

const LIMITS_URL = '/api/admin/synthetic-monitoring/limits';

/** What a probe write will accept for this tenant, as the plugin answers it. */
export interface ProbeLimits {
	/** The probes the tenant keeps against its ceiling. A limit of 0 is no ceiling. */
	probes: { limit: number; current: number };
	/** The shortest interval a new probe may be given, in seconds. */
	minIntervalSeconds: number;
}

/**
 * The limits a probe write is held to, or null when the plugin does not say.
 *
 * The floor depends on what the instance is licensed for, so the console reads
 * it rather than guessing one of its own.
 */
export async function readProbeLimits(client: HttpClient): Promise<ProbeLimits | null> {
	const raw = await client.get<unknown>(LIMITS_URL);
	const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
	const probes = r.probes && typeof r.probes === 'object' ? (r.probes as Record<string, unknown>) : {};
	const min = r.min_interval_seconds;
	if (typeof min !== 'number' || !Number.isFinite(min) || min <= 0) return null;
	return {
		probes: {
			limit: typeof probes.limit === 'number' ? probes.limit : 0,
			current: typeof probes.current === 'number' ? probes.current : 0,
		},
		minIntervalSeconds: min,
	};
}

/** The interval field's hint, with the floor when the plugin said what it is. */
export function intervalHint(limits: ProbeLimits | null): string {
	const why = 'Each probe sends a request to this engine.';
	return limits ? `At least ${limits.minIntervalSeconds}. ${why}` : why;
}

export async function acknowledgeAlert(client: HttpClient, id: string): Promise<void> {
	await client.post(`${ALERTS_URL}/${encodeURIComponent(id)}/acknowledge`, {});
}

/**
 * Where a probe's down and recovery notices go, and whether the plugin would
 * take a new chat, webhook or PagerDuty channel. The signing secret is
 * answered once, by the write that set a new webhook URL.
 */
export interface ProbeChannels {
	channels: AlertChannels;
	licensed: boolean;
	webhook_signing_secret?: string;
}

function toProbeChannels(raw: unknown): ProbeChannels {
	const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
	const secret = typeof r.webhook_signing_secret === 'string' ? r.webhook_signing_secret : '';
	return { channels: toChannels(r.channels), licensed: r.licensed === true, ...(secret ? { webhook_signing_secret: secret } : {}) };
}

export async function getProbeChannels(client: HttpClient, id: string): Promise<ProbeChannels> {
	return toProbeChannels(await client.get<unknown>(`${PROBES_URL}/${encodeURIComponent(id)}/alert-channels`));
}

/** Sets a probe's channels. Null clears every one of them. */
export async function putProbeChannels(
	client: HttpClient,
	id: string,
	channels: AlertChannels | null
): Promise<ProbeChannels> {
	return toProbeChannels(await client.put<unknown>(`${PROBES_URL}/${encodeURIComponent(id)}/alert-channels`, channels));
}

/** Whether a string is a probe type the engine will store. */
export function probeType(value: string): ProbeType | null {
	return PROBE_TYPES.includes(value as ProbeType) ? (value as ProbeType) : null;
}

export type ProbeHealth = 'passing' | 'failing' | 'paused' | 'unrun';

/**
 * What a probe's row should say about it.
 *
 * Switched off comes first and outranks the last result, because a paused
 * probe's last pass is stale by however long it has been paused and reading
 * it as green is how an outage goes unnoticed. A probe that has never run
 * reports that rather than passing: no result is not a good result.
 */
export function probeHealth(p: Probe): ProbeHealth {
	if (!p.enabled) return 'paused';
	if (!p.last_run_at || !p.last_status) return 'unrun';
	return p.last_status === 'pass' ? 'passing' : 'failing';
}

export function probeTone(h: ProbeHealth): StatusTone {
	if (h === 'passing') return 'success';
	if (h === 'failing') return 'danger';
	if (h === 'unrun') return 'warn';
	return 'neutral';
}

export const PROBE_HEALTH_LABELS: Readonly<Record<ProbeHealth, string>> = {
	passing: 'Passing',
	failing: 'Failing',
	paused: 'Paused',
	unrun: 'Never run',
};

/**
 * An interval a person can read.
 *
 * Kept exact rather than rounded: a probe set to 90 seconds must not read as
 * "every 2 minutes", because the number on screen is the one somebody will
 * compare against an alerting threshold elsewhere.
 */
export function everyLabel(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds <= 0) return 'Not scheduled';
	if (seconds % 3600 === 0) {
		const hours = seconds / 3600;
		return `Every ${hours} ${plural(hours, 'hour')}`;
	}
	if (seconds % 60 === 0) {
		const minutes = seconds / 60;
		return `Every ${minutes} ${plural(minutes, 'minute')}`;
	}
	return `Every ${seconds} seconds`;
}

/**
 * The one line under a probe's name: what it checks.
 *
 * Read off the config rather than the type, because two health checks against
 * different URLs are different probes and a list that named only the type
 * would show them as the same row twice.
 */
export function probeTarget(p: Probe): string {
	const c = p.config ?? {};
	switch (p.type) {
		case 'health_check':
			return c.url ?? 'No URL set';
		case 'api_canary':
			return [c.endpoint_base, c.resource_path].filter(Boolean).join('') || 'No endpoint set';
		case 'login_flow':
			return c.login_url ?? 'No sign-in URL set';
		case 'webhook_delivery':
			return c.webhook_url ?? 'No webhook URL set';
		default:
			return 'Unknown probe type';
	}
}
