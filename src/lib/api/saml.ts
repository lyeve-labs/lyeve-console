/**
 * The SAML plugin's admin routes.
 *
 * A SAML deployment fails on a date, not on a change. The service provider
 * certificate this instance mints is good for a year and the identity
 * provider's is set by somebody else entirely. Both expire in silence, and the
 * first report is that nobody can sign in. So the list carries expiry dates
 * rather than certificates, and the screen's job is to say which one runs out
 * first and how long is left.
 *
 * Rollover is two steps and they are not interchangeable. Staging mints a
 * certificate into a second slot and publishes it in the SP metadata document
 * beside the active one. Promoting makes it the one every AuthnRequest is
 * signed with. Doing the second without the first means the IdP starts seeing
 * signatures from a key it has never been told to trust.
 *
 * A provider is addressed by name on the sign-in path and by id everywhere
 * else. Names are display names, so they hold spaces and have to be encoded
 * into a URL rather than concatenated into one.
 */
import type { StatusTone } from '@lyeve-labs/ui-kit';
import type { HttpClient } from '@lyeve-labs/client';
import type { ListEnvelope } from './list';
import { plural } from '$lib/format';

const PROVIDERS_URL = '/api/admin/saml-providers';
const TEMPLATES_URL = '/api/admin/saml-templates';

/**
 * One configured identity provider.
 *
 * `idp_cert` is deliberately absent: the engine never serializes it, and the
 * expiry beside it is the only thing an operator has to act on. `sp_cert_next`
 * is the staged certificate, present only between a prepare and a rollover,
 * and it is shown so it can be handed to an IdP that reads certificates rather
 * than metadata URLs.
 */
export interface SamlProvider {
	id: string;
	tenant_id: string;
	name: string;
	entity_id: string;
	sso_url: string;
	slo_url?: string | null;
	sp_cert_active: string;
	sp_cert_next?: string | null;
	name_id_format: string;
	want_authn_signed: boolean;
	want_assertions_signed: boolean;
	want_response_signed: boolean;
	sign_authn_requests: boolean;
	encrypt_assertions: boolean;
	attributes_mapping: Record<string, string>;
	enabled: boolean;
	created_at: string;
	updated_at: string;
	sp_cert_expires_at?: string | null;
	sp_cert_next_expires_at?: string | null;
	idp_cert_expires_at?: string | null;
}

/** The settings a template fills. Entity ID and sign-on URL are often empty, because they name the customer's own tenant. */
export interface SamlTemplateConfig {
	entity_id?: string;
	sso_url?: string;
	slo_url?: string;
	idp_cert_hint?: string;
	name_id_format?: string;
	want_authn_signed?: boolean;
	want_assertions_signed?: boolean;
	want_response_signed?: boolean;
	sign_authn_requests?: boolean;
	encrypt_assertions?: boolean;
	attributes_mapping?: Record<string, string>;
}

/** A vendor preset that fills the protocol settings. The list leaves out its config, and a read of one template carries it. */
export interface SamlTemplate {
	key: string;
	name: string;
	description?: string;
	vendor?: string;
	docs_url?: string;
	config?: SamlTemplateConfig;
}

export async function listProviders(
	client: HttpClient,
	limit: number,
	offset: number
): Promise<ListEnvelope<SamlProvider>> {
	return client.get<ListEnvelope<SamlProvider>>(`${PROVIDERS_URL}?limit=${limit}&offset=${offset}`);
}

export async function listTemplates(client: HttpClient): Promise<SamlTemplate[]> {
	return client.get<SamlTemplate[]>(TEMPLATES_URL);
}

export async function getTemplate(client: HttpClient, key: string): Promise<SamlTemplate> {
	return client.get<SamlTemplate>(`${TEMPLATES_URL}/${encodeURIComponent(key)}`);
}

export interface CreateProvider {
	name: string;
	entity_id: string;
	sso_url: string;
	slo_url?: string;
	idp_cert: string;
	name_id_format?: string;
	want_authn_signed?: boolean;
	want_assertions_signed?: boolean;
	want_response_signed?: boolean;
	sign_authn_requests?: boolean;
	encrypt_assertions?: boolean;
	attributes_mapping?: Record<string, string>;
	enabled?: boolean;
}

export async function createProvider(
	client: HttpClient,
	body: CreateProvider
): Promise<SamlProvider> {
	return client.post<SamlProvider>(PROVIDERS_URL, body);
}

export async function updateProvider(
	client: HttpClient,
	id: string,
	body: Partial<CreateProvider>
): Promise<SamlProvider> {
	return client.put<SamlProvider>(`${PROVIDERS_URL}/${encodeURIComponent(id)}`, body);
}

export async function deleteProvider(client: HttpClient, id: string): Promise<void> {
	await client.delete(`${PROVIDERS_URL}/${encodeURIComponent(id)}`);
}

/** Mints a certificate into the staged slot, leaving the active one signing. */
export async function prepareCert(client: HttpClient, id: string): Promise<SamlProvider> {
	return client.post<SamlProvider>(`${PROVIDERS_URL}/${encodeURIComponent(id)}/prepare-cert`, {});
}

/** Promotes the staged certificate. Refused when nothing is staged. */
export async function rolloverCert(client: HttpClient, id: string): Promise<SamlProvider> {
	return client.post<SamlProvider>(`${PROVIDERS_URL}/${encodeURIComponent(id)}/rollover-cert`, {});
}

/**
 * Where the IdP fetches this instance's SP metadata.
 *
 * Built from the provider name because that is what the route matches on, and
 * encoded because a display name holds spaces. A relative path, since the URL
 * an IdP should be given is the one this instance is actually reached at, and
 * only the browser knows that.
 */
export function metadataPath(name: string): string {
	return `/api/admin/auth/saml/${encodeURIComponent(name)}/metadata`;
}

/** Where a person starts a sign-in with this provider. */
export function signInPath(name: string): string {
	return `/api/admin/auth/saml/${encodeURIComponent(name)}`;
}

/** Days until a date, rounded down. Negative once it has passed. */
export function daysUntil(when: string | null | undefined, now: Date = new Date()): number | null {
	if (!when) return null;
	const at = Date.parse(when);
	if (Number.isNaN(at)) return null;
	return Math.floor((at - now.getTime()) / 86_400_000);
}

export type CertHealth = 'expired' | 'expiring' | 'ok' | 'unknown';

/**
 * How much trouble a certificate is in.
 *
 * Thirty days is the threshold because that is roughly the time it takes to
 * get a change through somebody else's identity team, which is who has to act
 * on the IdP half. An unreadable or absent date is 'unknown' rather than a
 * warning: the engine sends no date for a certificate it could not parse, and
 * warning about it would bury the rows that are genuinely running out.
 */
export function certHealth(
	when: string | null | undefined,
	now: Date = new Date()
): CertHealth {
	const days = daysUntil(when, now);
	if (days === null) return 'unknown';
	if (days < 0) return 'expired';
	if (days <= 30) return 'expiring';
	return 'ok';
}

/** The tone a certificate's health wears, in the kit's own vocabulary. */
export function certTone(health: CertHealth): StatusTone {
	if (health === 'expired') return 'danger';
	if (health === 'expiring') return 'warn';
	if (health === 'ok') return 'success';
	return 'neutral';
}

/**
 * The worst news among a provider's certificates.
 *
 * A row is as healthy as its sickest certificate: an SP certificate good for
 * another ten months does not help if the IdP's expires next week, and the
 * staged one is deliberately left out because it is not in use yet.
 */
export function providerHealth(p: SamlProvider, now: Date = new Date()): CertHealth {
	const ranked: CertHealth[] = ['expired', 'expiring', 'unknown', 'ok'];
	const both = [certHealth(p.sp_cert_expires_at, now), certHealth(p.idp_cert_expires_at, now)];
	for (const level of ranked) {
		if (both.includes(level)) return level;
	}
	return 'ok';
}

/** How a certificate's expiry reads in a sentence. */
export function expiryLabel(when: string | null | undefined, now: Date = new Date()): string {
	const days = daysUntil(when, now);
	if (days === null) return 'Expiry unknown';
	if (days < 0) return `Expired ${Math.abs(days)} ${plural(Math.abs(days), 'day')} ago`;
	if (days === 0) return 'Expires today';
	return `Expires in ${days} ${plural(days, 'day')}`;
}
