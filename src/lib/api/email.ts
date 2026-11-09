import type { HttpClient } from '@lyeve-labs/client';
import { record } from './narrow';

/** How a provider row sends: over SMTP, or over a provider's HTTP API. */
export type EmailTransport = 'smtp' | 'api';

/** What an api provider's webhook event is classified as. */
export type WebhookEvent = 'delivered' | 'bounced_hard' | 'bounced_soft' | 'complained' | 'deferred';

export const TRANSPORTS: EmailTransport[] = ['smtp', 'api'];
export const WEBHOOK_EVENTS: WebhookEvent[] = ['delivered', 'bounced_hard', 'bounced_soft', 'complained', 'deferred'];

/** Where a provider posts delivery events for an api row. The row's webhook secret is its token. */
export function webhookPath(id: string): string {
	return `/api/v1/email/webhook/api/${encodeURIComponent(id)}`;
}

/**
 * The placeholders an api body template may carry. The plugin substitutes
 * them at send time. `to` is a JSON array of addresses, `to_first` its first
 * address and `to_objects` the same list as [{"email": ...}] objects.
 */
export const BODY_PLACEHOLDERS = ['from', 'to', 'to_first', 'to_objects', 'subject', 'html', 'text', 'message_id'] as const;

/** The verbs the plugin accepts for the send request. POST when blank. */
export const API_METHODS = ['POST', 'PUT', 'PATCH'] as const;

/**
 * One row of the email plugin's rotation pool, as its admin routes answer.
 * An api row is wired entirely from its own columns: the base URL, the
 * request template and the webhook mapping. The SMTP password, the API key and the webhook secret are never in the
 * answer: the plugin drops them from every response, so the form cannot show
 * them and a blank on edit means keep the stored one.
 */
export interface EmailProvider {
	id: string;
	name: string;
	transport: EmailTransport;
	api_base_url?: string;
	host: string;
	port: number;
	username?: string;
	from_addr: string;
	use_tls: boolean;
	priority: number;
	max_per_hour: number;
	status: 'active' | 'paused' | 'degraded' | string;
	api_method?: string;
	api_path?: string;
	api_headers?: Record<string, string>;
	api_body?: string;
	api_message_id_path?: string;
	api_webhook_event_path?: string;
	api_webhook_recipient_path?: string;
	api_webhook_message_id_path?: string;
	api_webhook_reason_path?: string;
	api_webhook_event_map?: Record<string, string>;
	created_at?: string;
	updated_at?: string;
}

/**
 * What the form sends. A secret left out is kept on update. The plugin's
 * update route reads every field as optional and touches only what arrives.
 */
export interface EmailProviderBody {
	name: string;
	transport: EmailTransport;
	from_addr: string;
	priority: number;
	max_per_hour: number;
	status?: string;
	host?: string;
	port?: number;
	username?: string;
	password?: string;
	use_tls?: boolean;
	api_key?: string;
	api_base_url?: string;
	webhook_secret?: string;
	api_method?: string;
	api_path?: string;
	api_headers?: Record<string, string>;
	api_body?: string;
	api_message_id_path?: string;
	api_webhook_event_path?: string;
	api_webhook_recipient_path?: string;
	api_webhook_message_id_path?: string;
	api_webhook_reason_path?: string;
	api_webhook_event_map?: Record<string, string>;
}

const BASE = '/api/admin/email/providers';

function stringMap(v: unknown): Record<string, string> | undefined {
	const obj = record(v);
	const out: Record<string, string> = {};
	for (const [k, val] of Object.entries(obj)) if (typeof val === 'string') out[k] = val;
	return Object.keys(out).length > 0 ? out : undefined;
}

function optString(v: unknown): string | undefined {
	return typeof v === 'string' && v !== '' ? v : undefined;
}

/**
 * Normalize a row. A row with no transport sends over SMTP, and every secret
 * is absent by design. The type says so and the normalizer never invents one.
 */
export function toEmailProvider(raw: Record<string, unknown>): EmailProvider {
	return {
		id: String(raw.id ?? ''),
		name: typeof raw.name === 'string' ? raw.name : '',
		transport: raw.transport === 'api' ? 'api' : 'smtp',
		api_base_url: optString(raw.api_base_url),
		host: typeof raw.host === 'string' ? raw.host : '',
		port: typeof raw.port === 'number' ? raw.port : 0,
		username: optString(raw.username),
		from_addr: typeof raw.from_addr === 'string' ? raw.from_addr : '',
		use_tls: raw.use_tls === true,
		priority: typeof raw.priority === 'number' ? raw.priority : 0,
		max_per_hour: typeof raw.max_per_hour === 'number' ? raw.max_per_hour : 0,
		status: typeof raw.status === 'string' ? raw.status : 'active',
		api_method: optString(raw.api_method),
		api_path: optString(raw.api_path),
		api_headers: stringMap(raw.api_headers),
		api_body: optString(raw.api_body),
		api_message_id_path: optString(raw.api_message_id_path),
		api_webhook_event_path: optString(raw.api_webhook_event_path),
		api_webhook_recipient_path: optString(raw.api_webhook_recipient_path),
		api_webhook_message_id_path: optString(raw.api_webhook_message_id_path),
		api_webhook_reason_path: optString(raw.api_webhook_reason_path),
		api_webhook_event_map: stringMap(raw.api_webhook_event_map),
		created_at: optString(raw.created_at),
		updated_at: optString(raw.updated_at),
	};
}

/**
 * Every provider of the tenant. The route answers the paginated envelope
 * every admin list uses. A rotation pool holds a handful of rows, so the
 * first page is the whole list.
 */
export async function listEmailProviders(client: HttpClient): Promise<EmailProvider[]> {
	const res = await client.get<unknown>(`${BASE}?limit=100&offset=0`);
	const rows = Array.isArray(res) ? res : (record(res).data ?? []);
	return (Array.isArray(rows) ? rows : []).map((r) => toEmailProvider(record(r)));
}

export function createEmailProvider(client: HttpClient, body: EmailProviderBody): Promise<EmailProvider> {
	return client.post<Record<string, unknown>>(BASE, body).then(toEmailProvider);
}

export function updateEmailProvider(
	client: HttpClient,
	id: string,
	body: Partial<EmailProviderBody>,
): Promise<EmailProvider> {
	return client.put<Record<string, unknown>>(`${BASE}/${encodeURIComponent(id)}`, body).then(toEmailProvider);
}

export async function deleteEmailProvider(client: HttpClient, id: string): Promise<void> {
	await client.delete<void>(`${BASE}/${encodeURIComponent(id)}`);
}
