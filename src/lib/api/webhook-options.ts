/**
 * The options of an outbound webhook past its address and events: a payload
 * template, a JSONPath filter, field filters and a retry policy of its own.
 *
 * The engine may refuse a write with 402. The page renders the refusal it
 * sends. An update replaces the whole record, so the form sends back what it
 * read and an edit of the name keeps the options.
 */
import type { HttpClient, Webhook } from '@lyeve-labs/client';
import { checked } from '$lib/checkbox';

/** A webhook as the engine answers it, options included. */
export interface WebhookRecord extends Webhook {
	headers?: Record<string, string> | null;
	payload_template?: string;
	max_retries?: number | null;
	retry_delay_seconds?: number | null;
	field_filters?: Record<string, string> | null;
	jsonpath_filter?: string;
	include_fields?: string[] | null;
	exclude_fields?: string[] | null;
	max_response_size?: number | null;
}

export interface WebhookBody {
	name: string;
	url: string;
	events: string[];
	schemas: string[];
	/** Absent on an edit that leaves the box blank, so the stored secret stays. */
	secret?: string;
	enabled: boolean;
	headers?: Record<string, string>;
	payload_template?: string;
	max_retries?: number;
	retry_delay_seconds?: number;
	field_filters?: Record<string, string>;
	jsonpath_filter?: string;
	include_fields?: string[];
	exclude_fields?: string[];
	max_response_size?: number;
}

/** Field filters as the editor writes them: one `field=value` per line. */
export function filtersText(f: Record<string, string> | null | undefined): string {
	return Object.entries(f ?? {})
		.map(([k, v]) => `${k}=${v}`)
		.join('\n');
}

/** The field filters a textarea holds, or the line that is not `field=value`. */
export function parseFilters(raw: string): { filters: Record<string, string> } | { error: string } {
	const filters: Record<string, string> = {};
	for (const line of raw.split('\n').map((l) => l.trim()).filter(Boolean)) {
		const at = line.indexOf('=');
		if (at <= 0) return { error: `"${line}" is not field=value.` };
		filters[line.slice(0, at).trim()] = line.slice(at + 1).trim();
	}
	return { filters };
}

function whole(raw: FormDataEntryValue | null): number | undefined {
	const s = String(raw ?? '').trim();
	if (!s) return undefined;
	const n = Number(s);
	return Number.isInteger(n) && n >= 0 ? n : undefined;
}

/**
 * The write body a webhook form names, or the sentence that stops it. The
 * settings the form does not show travel through `kept`, the JSON of the
 * record as it was read, so an update never clears them. A blank secret is
 * left out rather than sent empty: the form never shows the stored one, so a
 * blank box means keep it, and an empty value would remove the signature.
 */
export function webhookBodyFrom(form: FormData): { body: WebhookBody } | { error: string; field?: string } {
	const body: WebhookBody = {
		name: String(form.get('name') ?? ''),
		url: String(form.get('url') ?? ''),
		events: form.getAll('events').map(String),
		schemas: form.getAll('schemas').map(String),
		enabled: checked(form, 'enabled'),
	};
	const secret = String(form.get('secret') ?? '');
	if (secret.trim()) body.secret = secret;
	const filters = parseFilters(String(form.get('field_filters') ?? ''));
	if ('error' in filters) return { error: filters.error, field: 'field_filters' };
	if (Object.keys(filters.filters).length) body.field_filters = filters.filters;
	const template = String(form.get('payload_template') ?? '').trim();
	if (template) body.payload_template = template;
	const jsonpath = String(form.get('jsonpath_filter') ?? '').trim();
	if (jsonpath) body.jsonpath_filter = jsonpath;
	const retries = whole(form.get('max_retries'));
	if (retries !== undefined) body.max_retries = retries;
	const delay = whole(form.get('retry_delay_seconds'));
	if (delay !== undefined) body.retry_delay_seconds = delay;

	try {
		const kept = JSON.parse(String(form.get('kept') ?? '{}')) as Partial<WebhookRecord>;
		if (kept.headers && Object.keys(kept.headers).length) body.headers = kept.headers;
		if (kept.include_fields?.length) body.include_fields = kept.include_fields;
		if (kept.exclude_fields?.length) body.exclude_fields = kept.exclude_fields;
		if (typeof kept.max_response_size === 'number') body.max_response_size = kept.max_response_size;
	} catch {
		// A form without the kept settings is a new endpoint, which has none.
	}
	return { body };
}

export function createWebhookRecord(client: HttpClient, body: WebhookBody): Promise<WebhookRecord> {
	return client.post<WebhookRecord>('/api/admin/webhooks', body);
}

export function updateWebhookRecord(client: HttpClient, id: string, body: WebhookBody): Promise<WebhookRecord> {
	return client.put<WebhookRecord>(`/api/admin/webhooks/${encodeURIComponent(id)}`, body);
}

/** The settings an edit carries back unchanged, as the form's hidden `kept` field. */
export function keptJSON(w: WebhookRecord | null): string {
	if (!w) return '{}';
	return JSON.stringify({
		headers: w.headers ?? undefined,
		include_fields: w.include_fields ?? undefined,
		exclude_fields: w.exclude_fields ?? undefined,
		max_response_size: w.max_response_size ?? undefined,
	});
}
