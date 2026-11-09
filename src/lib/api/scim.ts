/**
 * The SCIM plugin's admin routes.
 *
 * SCIM is how an identity provider creates and removes accounts here without
 * anybody logging in, so the thing on the screen is a connection: a name, a
 * bearer token the provider sends, and what happens to an account when the
 * provider stops listing it.
 *
 * The token is write-only. The engine stores a SHA-256 of it and never sends
 * it back, so a connection's token can be replaced but never read. That is why
 * rotation is its own control rather than a field on an edit form: there is no
 * edit form to put it on.
 *
 * The provisioning endpoints themselves live under /api/v1/scim/v2 and are
 * the identity provider's, not this screen's. What this screen owns is who may
 * call them.
 */
import type { StatusTone } from '@lyeve-labs/ui-kit';
import type { HttpClient } from '@lyeve-labs/client';
import type { ListEnvelope } from './list';

const PROVIDERS_URL = '/api/admin/scim/providers';
export const SCIM_BASE_PATH = '/api/v1/scim/v2';

/** How a SCIM attribute maps onto a field here. */
export interface ScimAttributeMap {
	userName?: string;
	displayName?: string;
	externalId?: string;
	active?: string;
	groups?: string;
}

/**
 * What happens to an account when the identity provider deprovisions it.
 *
 * `disable` keeps the row and its history and stops the sign-in. `delete`
 * removes it. The difference matters to an auditor, so the screen names it
 * rather than showing a boolean.
 */
export const DEPROVISION_ACTIONS = ['disable', 'delete'] as const;
export type DeprovisionAction = (typeof DEPROVISION_ACTIONS)[number];

/** One identity provider allowed to provision accounts here. */
export interface ScimProvider {
	id: string;
	name: string;
	enabled: boolean;
	tenant_id: string;
	saml_provider_id?: string | null;
	attribute_map: ScimAttributeMap;
	deprovision_on_delete: boolean;
	deprovision_action: string;
	created_at: string;
	updated_at: string;
}

export async function listProviders(
	client: HttpClient,
	limit: number,
	offset: number
): Promise<ListEnvelope<ScimProvider>> {
	return client.get<ListEnvelope<ScimProvider>>(`${PROVIDERS_URL}?limit=${limit}&offset=${offset}`);
}

export interface CreateScimProvider {
	name: string;
	bearer_token: string;
	saml_provider_id?: string;
	attribute_map?: ScimAttributeMap;
	deprovision_on_delete?: boolean;
	deprovision_action?: DeprovisionAction;
}

export async function createProvider(
	client: HttpClient,
	body: CreateScimProvider
): Promise<ScimProvider> {
	return client.post<ScimProvider>(PROVIDERS_URL, body);
}

export async function deleteProvider(client: HttpClient, id: string): Promise<void> {
	await client.delete(`${PROVIDERS_URL}/${encodeURIComponent(id)}`);
}

/** Replaces the bearer token. The old one stops working immediately. */
export async function rotateToken(
	client: HttpClient,
	id: string,
	newToken: string
): Promise<void> {
	await client.post(`${PROVIDERS_URL}/${encodeURIComponent(id)}/rotate`, { new_token: newToken });
}

/** Whether a string is one of the two deprovision actions the engine accepts. */
export function deprovisionAction(value: string): DeprovisionAction | null {
	return DEPROVISION_ACTIONS.includes(value as DeprovisionAction)
		? (value as DeprovisionAction)
		: null;
}

/**
 * What happens to an account the directory deletes, in words.
 *
 * The two fields are read together on purpose. The plugin disables the
 * account only while the switch is on and the action is disable. With the
 * switch off it deletes the account whatever the stored action says, so
 * reading the action alone would promise a disable that never happens.
 */
export function deprovisionLabel(p: ScimProvider): string {
	if (!p.deprovision_on_delete) return 'Deleted';
	return p.deprovision_action === 'delete' ? 'Deleted' : 'Disabled';
}

/**
 * The tone that outcome wears.
 *
 * Deleting an account on deprovision is the irreversible option, so it is
 * marked rather than stated flatly beside the reversible one.
 */
export function deprovisionTone(p: ScimProvider): StatusTone {
	if (!p.deprovision_on_delete) return 'danger';
	return p.deprovision_action === 'delete' ? 'danger' : 'warn';
}

/**
 * Minimum length for a bearer token this screen will accept.
 *
 * A token is the whole authentication for a route that creates and deletes
 * accounts, so a short one is a real exposure. The API refuses one under this
 * length on create and on rotate, and the form refuses it first so the reason
 * reads next to the field.
 */
export const MIN_TOKEN_LENGTH = 32;
