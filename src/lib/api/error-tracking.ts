/**
 * The error-tracking plugin's admin routes.
 *
 * Three levels and they are easy to confuse. An error code is a catalog
 * entry, written once, describing a class of failure. An event is one
 * occurrence. A fingerprint groups events that share a source location, and it
 * is the fingerprint that carries the count and the acknowledgment.
 *
 * So the number to read is not how many events arrived: it is how many
 * distinct fingerprints are unacknowledged. Ten thousand events from one
 * fingerprint is one problem, and ten fingerprints with one event each is ten.
 * A list ordered by event count says the opposite.
 */
import type { StatusTone } from '@lyeve-labs/ui-kit';
import type { HttpClient } from '@lyeve-labs/client';
import { toChannels, type AlertChannels } from './alert-channels';
import { query, readAll, rowsOf, statedTotal, type ListEnvelope } from './list';
import { count, num } from './narrow';

const BASE_URL = '/api/admin/error-tracking';
const ALERTS_URL = `${BASE_URL}/alerts`;
const CODES_URL = `${BASE_URL}/codes`;
const EVENTS_URL = `${BASE_URL}/events`;
const SETTINGS_URL = `${BASE_URL}/alert-settings`;

/** Where an alert is in its triage. */
export const ALERT_STATUSES = ['open', 'resolved', 'ignored'] as const;
export type AlertStatus = (typeof ALERT_STATUSES)[number];

/** The triage moves a row offers, each a route of its own. */
export const TRIAGE_ACTIONS = ['resolve', 'ignore', 'reopen'] as const;
export type TriageAction = (typeof TRIAGE_ACTIONS)[number];

export const SEVERITIES = ['CRITICAL', 'ERROR', 'WARN', 'INFO'] as const;
export type Severity = (typeof SEVERITIES)[number];

export interface ErrorCode {
	id: string;
	code: string;
	title: string;
	severity: string;
	category: string;
	description: string;
	created_at: string;
	updated_at: string;
}

/** One group of events sharing a source location, with its running count. */
export interface ErrorAlert {
	id: string;
	fingerprint: string;
	error_code_id: string;
	source_file: string;
	source_line: number;
	message_sample: string;
	error_count: number;
	first_seen: string;
	last_seen: string;
	acknowledged: boolean;
	acknowledged_at?: string | null;
	acknowledged_by: string;
	created_at: string;
	/** Absent from a plugin that predates triage, which reads as open. */
	status?: AlertStatus | string;
	resolved_at?: string | null;
	/** Who owns the alert, empty for nobody. */
	assigned_to?: string;
}

/** An alert's triage status, open when the plugin sent none it knows. */
export function alertStatus(a: ErrorAlert): AlertStatus {
	return (ALERT_STATUSES as readonly string[]).includes(a.status ?? '') ? (a.status as AlertStatus) : 'open';
}

/** The moves a row in this status offers. */
export function triageFor(status: AlertStatus): TriageAction[] {
	return status === 'open' ? ['resolve', 'ignore'] : ['reopen'];
}

export function isTriageAction(v: unknown): v is TriageAction {
	return typeof v === 'string' && (TRIAGE_ACTIONS as readonly string[]).includes(v);
}

/** One occurrence, as the event list answers it. */
export interface ErrorEvent {
	id: string;
	error_code_id: string;
	endpoint: string;
	tenant_id?: string | null;
	message: string;
	http_status: number;
	ts: string;
	fingerprint: string;
}

/**
 * A page of events. `hidden_older` counts the events older than the window
 * this instance reads, which the page leaves out. It is 0 when the instance
 * reads everything. `window_days` is that window, null when the instance reads
 * every event.
 */
export interface EventPage {
	data: ErrorEvent[];
	total: number;
	hiddenOlder: number;
	windowDays: number | null;
}

/** The spike threshold pair, as the defaults and a custom setting carry it. */
export interface SpikeThreshold {
	spike_min_count: number;
	spike_z_score: number;
}

/**
 * The tenant's spike alert setting. A null threshold member means the
 * default. `licensed` is the plugin's answer to whether it would take a paid
 * channel or a custom threshold.
 */
export interface AlertSettings {
	channels: AlertChannels;
	spike_min_count: number | null;
	spike_z_score: number | null;
	defaults: SpikeThreshold;
	licensed: boolean;
	/** Answered once, by the write that set a new webhook URL. */
	webhook_signing_secret?: string;
}

/** What the settings form's channel fields are named after. */
export const SETTINGS_CHANNEL_PREFIX = 'channel_';

/** The body a settings write sends. */
export interface AlertSettingsInput {
	channels: AlertChannels;
	spike_min_count: number | null;
	spike_z_score: number | null;
}

/** One page of alerts. `total` is null when the plugin states no count. */
export interface AlertPage {
	alerts: ErrorAlert[];
	total: number | null;
}

export async function listAlerts(
	client: HttpClient,
	limit: number,
	offset: number,
	status: AlertStatus | '' = ''
): Promise<AlertPage> {
	const res = await client.get<ListEnvelope<ErrorAlert>>(`${ALERTS_URL}${query({ limit, offset, status })}`);
	return { alerts: rowsOf(res), total: statedTotal(res) };
}

export async function triage(client: HttpClient, id: string, action: TriageAction): Promise<void> {
	await client.post(`${ALERTS_URL}/${encodeURIComponent(id)}/${action}`, {});
}

/** Assigns an alert. An empty assignee clears it. */
export async function assign(client: HttpClient, id: string, assignee: string): Promise<void> {
	await client.put(`${ALERTS_URL}/${encodeURIComponent(id)}/assignee`, { assignee });
}

/** The newest events, with the count of older ones the instance does not read. */
export async function listEvents(client: HttpClient, limit: number): Promise<EventPage> {
	const res = await client.get<Record<string, unknown>>(`${EVENTS_URL}?limit=${limit}&offset=0`);
	const data = Array.isArray(res?.data) ? (res.data as ErrorEvent[]) : [];
	return {
		data,
		total: num(res?.total_count, data.length),
		hiddenOlder: num(res?.hidden_older),
		windowDays: count(res?.window_days),
	};
}

export function toAlertSettings(raw: unknown): AlertSettings {
	const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
	const d = r.defaults && typeof r.defaults === 'object' ? (r.defaults as Record<string, unknown>) : {};
	const secret = typeof r.webhook_signing_secret === 'string' ? r.webhook_signing_secret : '';
	return {
		channels: toChannels(r.channels),
		spike_min_count: count(r.spike_min_count),
		spike_z_score: count(r.spike_z_score),
		defaults: { spike_min_count: num(d.spike_min_count, 10), spike_z_score: num(d.spike_z_score, 2.5) },
		licensed: r.licensed === true,
		...(secret ? { webhook_signing_secret: secret } : {}),
	};
}

export async function getAlertSettings(client: HttpClient): Promise<AlertSettings> {
	return toAlertSettings(await client.get<unknown>(SETTINGS_URL));
}

export async function putAlertSettings(client: HttpClient, body: AlertSettingsInput): Promise<AlertSettings> {
	return toAlertSettings(await client.put<unknown>(SETTINGS_URL, body));
}

/** The largest page the plugin serves. */
const CODES_PAGE = 500;

/**
 * Every registered code. The plugin pages the catalog, 50 to a page unless
 * asked for more, so a lookup that read one page labeled every alert past it
 * as an unclassified failure.
 */
export async function listCodes(client: HttpClient): Promise<ListEnvelope<ErrorCode>> {
	const { rows } = await readAll(async (limit, offset) => {
		const page = await client.get<ListEnvelope<ErrorCode>>(`${CODES_URL}?limit=${limit}&offset=${offset}`);
		return { rows: rowsOf(page), total: statedTotal(page) };
	}, CODES_PAGE);
	return { data: rows, total_count: rows.length };
}

export async function acknowledge(client: HttpClient, id: string): Promise<void> {
	await client.post(`${ALERTS_URL}/${encodeURIComponent(id)}/acknowledge`, {});
}

/**
 * The alerts nobody has looked at.
 *
 * Acknowledgment is per fingerprint, so a fingerprint acknowledged once stays
 * acknowledged while its count keeps rising. That is correct: somebody has
 * seen the problem. It does mean the count alone never says whether anything
 * is being attended to.
 */
export function unacknowledged(alerts: readonly ErrorAlert[]): ErrorAlert[] {
	return alerts.filter((a) => !a.acknowledged);
}

/**
 * Fingerprints seen for the first time within a window.
 *
 * A new fingerprint is a new failure, which is different from an old one
 * getting louder, and it is the one worth waking somebody for.
 */
export function firstSeenWithin(
	alerts: readonly ErrorAlert[],
	hours: number,
	now: Date = new Date()
): ErrorAlert[] {
	const cutoff = now.getTime() - hours * 3600_000;
	return alerts.filter((a) => {
		const at = Date.parse(a.first_seen);
		return !Number.isNaN(at) && at >= cutoff;
	});
}

/**
 * Whether a fingerprint is still happening.
 *
 * An acknowledged alert whose last event is minutes old is not resolved, it is
 * merely seen. A list that hid acknowledged rows would hide a live outage
 * somebody ticked off an hour ago.
 */
export function stillFiring(
	alert: ErrorAlert,
	withinMinutes = 15,
	now: Date = new Date()
): boolean {
	const at = Date.parse(alert.last_seen);
	if (Number.isNaN(at)) return false;
	return now.getTime() - at <= withinMinutes * 60_000;
}

export function severityTone(
	severity: string
): StatusTone {
	const s = severity.toUpperCase();
	if (s === 'CRITICAL') return 'danger';
	if (s === 'ERROR') return 'danger';
	if (s === 'WARN') return 'warn';
	if (s === 'INFO') return 'brand';
	return 'neutral';
}

/** Where a fingerprint came from, as a reader would cite it. */
export function sourceLabel(alert: ErrorAlert): string {
	if (!alert.source_file) return 'Source unknown';
	return alert.source_line > 0 ? `${alert.source_file}:${alert.source_line}` : alert.source_file;
}

/**
 * Alerts ordered the way somebody triaging wants them.
 *
 * Unacknowledged first, then still firing, then by how recently they last
 * happened. Ordering by count puts a loud old problem above a new one, which
 * is the ordering that hides an outage that started ten minutes ago.
 */
export function triageOrder(
	alerts: readonly ErrorAlert[],
	now: Date = new Date()
): ErrorAlert[] {
	return [...alerts].sort((a, b) => {
		if (a.acknowledged !== b.acknowledged) return a.acknowledged ? 1 : -1;
		const aLive = stillFiring(a, 15, now);
		const bLive = stillFiring(b, 15, now);
		if (aLive !== bLive) return aLive ? -1 : 1;
		return Date.parse(b.last_seen) - Date.parse(a.last_seen);
	});
}
