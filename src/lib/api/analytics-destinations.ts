/**
 * The analytics plugin's destinations: the third-party services a tenant's
 * tracked events are sent to, and the deliveries a destination has not
 * accepted yet.
 *
 * Both lists answer `{data, licensed}`. `licensed` is the plugin's answer to
 * whether it would take a retry policy and a replay, so the page offers them
 * without naming anything. A destination type the instance is not enabled for
 * is refused when it is created, with a 402 the page renders.
 *
 * A destination's settings carry its credentials, so every answer redacts
 * them whole. An edit sends settings only when the form names new ones, and
 * then the plugin replaces all of them.
 */
import type { HttpClient } from '@lyeve-labs/client';
import { query } from './list';
import { num, record, str } from './narrow';

const PROVIDERS_URL = '/api/admin/analytics/providers';
const DELIVERIES_URL = '/api/admin/analytics/deliveries';

export const PROVIDER_TYPES = ['ga4', 'mixpanel', 'plausible', 'segment', 'posthog', 'amplitude', 'webhook'] as const;
export type ProviderType = (typeof PROVIDER_TYPES)[number];

export const PROVIDER_LABELS: Readonly<Record<ProviderType, string>> = {
	ga4: 'Google Analytics 4',
	mixpanel: 'Mixpanel',
	plausible: 'Plausible',
	segment: 'Segment',
	posthog: 'PostHog',
	amplitude: 'Amplitude',
	webhook: 'Signed webhook',
};

/** One setting a destination type takes, as the drawer renders it. */
export interface ConfigField {
	key: string;
	label: string;
	/** A credential, which the form never prefills and never shows back. */
	secret?: boolean;
	required?: boolean;
	hint?: string;
}

const API_URL = (fallback: string): ConfigField => ({
	key: 'api_url',
	label: 'Endpoint',
	hint: `Optional. Empty sends to ${fallback}.`,
});

/** The settings each destination type takes. */
export const CONFIG_FIELDS: Readonly<Record<ProviderType, readonly ConfigField[]>> = {
	ga4: [
		{ key: 'measurement_id', label: 'Measurement id', required: true },
		{ key: 'api_secret', label: 'API secret', secret: true, required: true },
		API_URL('the global endpoint. Use the regional EU endpoint to keep collection in the EU'),
	],
	mixpanel: [{ key: 'project_token', label: 'Project token', secret: true, required: true }, API_URL('the default endpoint')],
	plausible: [
		{ key: 'site_id', label: 'Site id', required: true },
		{ key: 'api_token', label: 'API token', secret: true },
		API_URL('the hosted service'),
	],
	segment: [{ key: 'write_key', label: 'Write key', secret: true, required: true }, API_URL('the default endpoint')],
	posthog: [{ key: 'api_key', label: 'Project API key', secret: true, required: true }, API_URL('the US cloud')],
	amplitude: [{ key: 'api_key', label: 'API key', secret: true, required: true }, API_URL('the US endpoint')],
	webhook: [
		{
			key: 'url',
			label: 'HTTPS URL',
			required: true,
			hint: 'Receives each event as signed JSON. A new URL gets a new signing secret, shown once.',
		},
	],
};

export interface RetryPolicy {
	/** Counts the first attempt, so 1 means no retry. */
	max_attempts: number;
	/** The wait before the first retry, doubling after each up to an hour. */
	backoff_seconds: number;
}

export const MAX_ATTEMPTS = 10;
export const MAX_BACKOFF_SECONDS = 3600;

export interface Provider {
	id: string;
	name: string;
	type: ProviderType | string;
	enabled: boolean;
	retry_policy: RetryPolicy;
	created_at: string;
	updated_at: string;
	/** A webhook's signing secret, answered once by the write that made it. */
	signing_secret?: string;
}

export interface Delivery {
	id: string;
	event_id: string;
	provider_id: string;
	provider_type: string;
	status: 'pending' | 'failed' | string;
	attempts: number;
	last_error: string;
	next_attempt_at: string | null;
	created_at: string;
	updated_at: string;
}

export interface Listed<T> {
	data: T[];
	licensed: boolean;
}

/** The body a write sends. `config` is left out of an edit that keeps the stored settings. */
export interface ProviderInput {
	name: string;
	type?: ProviderType;
	enabled: boolean;
	config?: Record<string, string>;
	retry_policy?: RetryPolicy;
	rotate_secret?: boolean;
}

export function isProviderType(v: unknown): v is ProviderType {
	return typeof v === 'string' && (PROVIDER_TYPES as readonly string[]).includes(v);
}

export function toProvider(raw: unknown): Provider {
	const r = record(raw);
	const rp = record(r.retry_policy);
	const secret = str(r.signing_secret);
	return {
		id: str(r.id),
		name: str(r.name),
		type: str(r.type),
		enabled: r.enabled === true,
		retry_policy: { max_attempts: Math.max(1, num(rp.max_attempts, 1)), backoff_seconds: num(rp.backoff_seconds) },
		created_at: str(r.created_at),
		updated_at: str(r.updated_at),
		...(secret ? { signing_secret: secret } : {}),
	};
}

export function toDelivery(raw: unknown): Delivery {
	const r = record(raw);
	return {
		id: str(r.id),
		event_id: str(r.event_id),
		provider_id: str(r.provider_id),
		provider_type: str(r.provider_type),
		status: str(r.status),
		attempts: num(r.attempts),
		last_error: str(r.last_error),
		next_attempt_at: str(r.next_attempt_at) || null,
		created_at: str(r.created_at),
		updated_at: str(r.updated_at),
	};
}

function listed<T>(res: unknown, map: (raw: unknown) => T): Listed<T> {
	const r = record(res);
	// The list shape changed from a bare array to {data, licensed}. A bare
	// array is read as a list from a plugin that does not say.
	const rows = Array.isArray(res) ? res : Array.isArray(r.data) ? r.data : [];
	return { data: rows.map(map), licensed: r.licensed === true };
}

export async function listProviders(client: HttpClient): Promise<Listed<Provider>> {
	return listed(await client.get<unknown>(PROVIDERS_URL), toProvider);
}

export async function createProvider(client: HttpClient, body: ProviderInput): Promise<Provider> {
	return toProvider(await client.post<unknown>(PROVIDERS_URL, body));
}

export async function updateProvider(client: HttpClient, id: string, body: ProviderInput): Promise<Provider> {
	return toProvider(await client.put<unknown>(`${PROVIDERS_URL}/${encodeURIComponent(id)}`, body));
}

export async function deleteProvider(client: HttpClient, id: string): Promise<void> {
	await client.delete(`${PROVIDERS_URL}/${encodeURIComponent(id)}`);
}

export const DELIVERY_STATUSES = ['pending', 'failed'] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

/**
 * How many owed deliveries the page lists. The plugin answers the newest first
 * and takes no offset, so the rest cannot be paged to, only filtered by status.
 */
export const DELIVERY_LIMIT = 50;

export async function listDeliveries(
	client: HttpClient,
	status: DeliveryStatus | '' = '',
	limit: number = DELIVERY_LIMIT,
): Promise<Listed<Delivery>> {
	return listed(await client.get<unknown>(`${DELIVERIES_URL}${query({ limit, status })}`), toDelivery);
}

/** Sends one delivery again, now, once. A delivery that fails again comes back with its new error. */
export async function replayDelivery(
	client: HttpClient,
	id: string,
): Promise<{ delivered: boolean; delivery: Delivery | null }> {
	const r = record(await client.post<unknown>(`${DELIVERIES_URL}/${encodeURIComponent(id)}/replay`, {}));
	return { delivered: r.delivered === true, delivery: r.delivery ? toDelivery(r.delivery) : null };
}

/** A retry policy in a few words. */
export function retryText(p: RetryPolicy): string {
	if (p.max_attempts <= 1) return 'One attempt';
	return `${p.max_attempts} attempts, first retry after ${p.backoff_seconds}s`;
}
