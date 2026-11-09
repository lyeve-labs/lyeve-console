/**
 * Streaming the audit log to a destination outside the instance: any HTTPS
 * endpoint, a Splunk HTTP Event Collector or the Datadog logs intake.
 *
 * The engine may refuse a write with 402. The page renders the refusal it
 * sends.
 */
import type { StatusTone } from '@lyeve-labs/ui-kit';
import type { HttpClient } from '@lyeve-labs/client';
import { plural } from '$lib/format';

const SINKS_URL = '/api/admin/audit-log/sinks';

export const SINK_KINDS = ['https', 'splunk', 'datadog'] as const;
export type SinkKind = (typeof SINK_KINDS)[number];

export const SINK_KIND_LABELS: Readonly<Record<SinkKind, string>> = {
	https: 'HTTPS endpoint',
	splunk: 'Splunk HEC',
	datadog: 'Datadog logs',
};

/** What the secret is for each kind, in the words of its field. */
export const SINK_SECRET_LABELS: Readonly<Record<SinkKind, string>> = {
	https: 'Signing secret',
	splunk: 'HEC token',
	datadog: 'API key',
};

export interface AuditSink {
	id: string;
	name: string;
	kind: SinkKind;
	url: string;
	splunk_index?: string;
	datadog_service?: string;
	datadog_tags?: string;
	enabled: boolean;
	has_secret: boolean;
	cursor_sequence: number;
	consecutive_failures: number;
	next_attempt_at?: string;
	last_shipped_at?: string;
	last_error?: string;
	last_error_at?: string;
	pending_entries: number;
	lag_seconds: number;
	created_at: string;
	updated_at: string;
}

export interface SinkInput {
	name: string;
	kind: SinkKind;
	url: string;
	secret?: string;
	splunk_index?: string;
	datadog_service?: string;
	datadog_tags?: string;
	enabled: boolean;
	backfill?: boolean;
}

export function isSinkKind(v: string): v is SinkKind {
	return (SINK_KINDS as readonly string[]).includes(v);
}

export async function listSinks(client: HttpClient): Promise<AuditSink[]> {
	const res = await client.get<{ data?: AuditSink[] | null }>(SINKS_URL);
	return res?.data ?? [];
}

/** The created sink, with the signing secret the plugin generated when it made one. */
export function createSink(client: HttpClient, body: SinkInput): Promise<AuditSink & { secret?: string }> {
	return client.post<AuditSink & { secret?: string }>(SINKS_URL, body);
}

/** An update leaves the kind as it is, and an absent secret keeps the stored one. */
export function updateSink(client: HttpClient, id: string, body: Omit<SinkInput, 'kind' | 'backfill'>): Promise<AuditSink> {
	return client.put<AuditSink>(`${SINKS_URL}/${encodeURIComponent(id)}`, body);
}

export function deleteSink(client: HttpClient, id: string): Promise<void> {
	return client.delete<void>(`${SINKS_URL}/${encodeURIComponent(id)}`);
}

export function testSink(client: HttpClient, id: string): Promise<{ delivered: boolean; error?: string }> {
	return client.post<{ delivered: boolean; error?: string }>(`${SINKS_URL}/${encodeURIComponent(id)}/test`, {});
}

/** How far behind the destination is, in words. */
export function lagText(s: Pick<AuditSink, 'pending_entries' | 'lag_seconds'>): string {
	if (s.pending_entries <= 0) return 'Up to date';
	const n = `${s.pending_entries} ${plural(s.pending_entries, 'entry', 'entries')} waiting`;
	const secs = s.lag_seconds;
	if (secs < 60) return `${n}, ${secs}s behind`;
	if (secs < 3600) return `${n}, ${Math.round(secs / 60)} min behind`;
	return `${n}, ${Math.round(secs / 3600)} h behind`;
}

/** The health of a sink as a tone: failing, behind, paused or fine. */
export function sinkTone(s: Pick<AuditSink, 'enabled' | 'consecutive_failures' | 'pending_entries'>): StatusTone {
	if (!s.enabled) return 'neutral';
	if (s.consecutive_failures > 0) return 'danger';
	if (s.pending_entries > 0) return 'warn';
	return 'success';
}
