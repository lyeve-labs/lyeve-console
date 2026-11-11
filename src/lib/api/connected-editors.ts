/**
 * The admin routes of the plugin that lets a browser edit pages through a
 * signed connection.
 *
 * A person approves a connection with the code the browser shows, and the
 * approval asks for their password or MFA code again, because a connection
 * lasts months. Every route reads the person from the session and the tenant
 * from the request, so nothing here names either. A waiting request is never
 * listed: anyone can start one, so only the person holding its code brings it
 * up.
 */
import { ApiError, type HttpClient } from '@lyeve-labs/client';
import type { StatusTone } from '@lyeve-labs/ui-kit';
import { gateOf, type Gate } from './gate';
import { errorCodeOf } from './limits';
import { totalOf, type ListEnvelope } from './list';
import { couldNotLoad } from '../outage';

const CONNECTIONS_URL = '/api/admin/builder/connections';
const SETTINGS_URL = '/api/admin/builder/settings';

/** The lifetimes a connection may have, in days. */
export const LIFETIMES = [30, 90, 180] as const;

/** One connection that was approved once, as the list sends it. The key itself never leaves the engine. */
export interface Connection {
	id: string;
	approver_email: string;
	/** The first 8 bytes of SHA-256 over the raw public key, as four groups of four hex digits. */
	fingerprint: string;
	/** The name the browser gave itself. Reported by the requester, unchecked. */
	label: string;
	/** The origin the request carried. Reported by the requester, unchecked. */
	origin: string;
	approved_at: string | null;
	last_used_at: string | null;
	expires_at: string | null;
	status: string;
}

export interface ConnectionList {
	data: Connection[];
	total: number;
}

/** A waiting request, as the approve drawer shows it before anyone decides. */
export interface ConnectionRequest {
	fingerprint: string;
	label: string;
	origin: string;
	requested_at: string;
	code_expires_at: string;
	/** When a connection approved now at the tenant's lifetime would end. */
	would_expire_at: string;
	/** The longest lifetime the tenant allows, in days. */
	lifetime_days: number;
	/** The address or IPv6 /64 the request came from: the one field its sender cannot choose. */
	requester_network: string;
	approver_address: string;
	same_network: boolean;
}

/** The confirmation an approval carries: the password, or the MFA code for an account that has one. */
export type ApproveStepUp = { password: string } | { mfa_code: string };

export type ApproveBody = { fingerprint: string; lifetime_days: number } & ApproveStepUp;

export interface Settings {
	allowed: boolean;
	lifetime_days: number;
	show_schemas: string[];
	writes_per_minute: number;
	/** The most writes a minute the operator lets a tenant allow one connection. */
	max_writes_per_minute: number;
	/** The content types forms may save posts into. Empty means none. */
	form_schemas: string[];
	/** The slugs of the flows forms may start. Only the shape of each is checked when saved. */
	form_flows: string[];
	/** The ids of the sites whose forms post without a signature, from static files with no server. */
	form_static_sites?: string[];
	/** Set when a save shortened the lifetime. */
	note?: string;
}

/** A settings change names only what it changes, so two owners editing different fields both keep theirs. */
export type SettingsPatch = Partial<
	Pick<Settings, 'allowed' | 'lifetime_days' | 'show_schemas' | 'writes_per_minute' | 'form_schemas' | 'form_flows' | 'form_static_sites'>
>;

/** A site of the tenant, as the static sites list offers it. */
export interface SiteOption {
	id: string;
	name: string;
}

/** The most sites the admin content list answers in one page. */
const SITES_PAGE = 500;

/**
 * The tenant's sites, read from the admin content list of the type the
 * builder keeps them in, sorted by name. A list cut short is refused rather
 * than offered, because a save sends every site it does not tick as off.
 */
export async function listSites(client: HttpClient): Promise<SiteOption[]> {
	const query = new URLSearchParams({ schema: 'lyeve_builder_sites', limit: String(SITES_PAGE), offset: '0' });
	const res = await client.get<ListEnvelope<{ id: string; title?: string; body?: { name?: unknown } }>>(`/api/admin/content?${query}`);
	const rows = res.data ?? [];
	if (totalOf(res) > rows.length) throw new Error('site list cut short');
	return rows
		.map((r) => ({ id: r.id, name: (typeof r.body?.name === 'string' && r.body.name.trim()) || r.title || r.id }))
		.sort((a, b) => a.name.localeCompare(b.name));
}

/** What the static sites field says when the engine refuses the list. */
export const STATIC_SITES_REFUSED = 'Choose up to 50 sites whose last production build does not sign its forms.';

const code = (c: string) => `${CONNECTIONS_URL}/requests/${encodeURIComponent(c)}`;

export function listConnections(client: HttpClient, limit: number, offset: number): Promise<ConnectionList> {
	return client.get<ConnectionList>(`${CONNECTIONS_URL}?limit=${limit}&offset=${offset}`);
}

export function getRequest(client: HttpClient, userCode: string): Promise<ConnectionRequest> {
	return client.get<ConnectionRequest>(code(userCode));
}

export function approveRequest(
	client: HttpClient,
	userCode: string,
	body: ApproveBody,
): Promise<{ status: string; expires_at: string }> {
	return client.post(`${code(userCode)}/approve`, body);
}

export function declineRequest(client: HttpClient, userCode: string): Promise<{ status: string }> {
	return client.post(`${code(userCode)}/decline`, {});
}

/** Revoking twice answers the same, so a second owner's revoke is not an error. */
export function revokeConnection(client: HttpClient, id: string): Promise<{ status: string }> {
	return client.post(`${CONNECTIONS_URL}/${encodeURIComponent(id)}/revoke`, {});
}

/** Ends every current connection of the tenant and declines every waiting request. Owners only. */
export function revokeAllConnections(client: HttpClient): Promise<{ revoked: number; declined: number }> {
	return client.post(`${CONNECTIONS_URL}/revoke-all`, {});
}

export function getSettings(client: HttpClient): Promise<Settings> {
	return client.get<Settings>(SETTINGS_URL);
}

export function saveSettings(client: HttpClient, patch: SettingsPatch): Promise<Settings> {
	return client.put<Settings>(SETTINGS_URL, patch);
}

/** The engine's refusal of a tenant an operator withheld the plugin from. */
export const WITHHELD = 'TENANT_FEATURE_WITHHELD';

/** A gate, plus a tenant the operator withheld the plugin from, which no role or retry changes. */
export type ConnectionsGate = Gate | { state: 'withheld' };

/** What a refused read on this page means. */
export function connectionsGate(err: unknown): ConnectionsGate {
	if (err instanceof ApiError && err.status === 403 && errorCodeOf(err) === WITHHELD) return { state: 'withheld' };
	return gateOf(err, couldNotLoad('builder connections'));
}

/** Schemas a page may show: the builder's own and the engine's are never offered. */
export function showable(names: readonly string[]): string[] {
	return names.filter((n) => !n.startsWith('lyeve_builder_') && !n.startsWith('sys_'));
}

/** The lifetimes a person may pick when the tenant allows at most `max` days. */
export function lifetimesUpTo(max: number): number[] {
	return LIFETIMES.filter((d) => d <= max);
}

/** The name a browser gave, cut for a table cell or a drawer line. The full text goes in a title. */
export function shortLabel(label: string, max = 60): string {
	const chars = Array.from(label);
	return chars.length > max ? `${chars.slice(0, max - 3).join('')}...` : label;
}

/** The status word a reader sees for a connection, and the tone of its dot. */
export function statusOf(status: string): { label: string; tone: StatusTone } {
	switch (status) {
		case 'approved':
			return { label: 'Active', tone: 'success' };
		case 'expired':
			return { label: 'Expired', tone: 'neutral' };
		case 'revoked':
			return { label: 'Revoked', tone: 'danger' };
		case 'declined':
			return { label: 'Declined', tone: 'neutral' };
		case 'pending':
			return { label: 'Waiting', tone: 'warn' };
		default:
			return { label: status, tone: 'neutral' };
	}
}

/** Who approved a connection, as the Person column shows it. */
export function personOf(c: Pick<Connection, 'approver_email'>): string {
	return c.approver_email?.trim() ? c.approver_email : 'Removed person';
}

/** The sentences the drawer shows, one per outcome the engine can answer. */
export const SAID = {
	malformed: 'Enter the eight-character code the builder shows, such as K7F3-A2M9.',
	unknown: 'No request matches this code. Check the code the builder shows.',
	expired: 'This code expired. Connect again from the builder to get a new one.',
	decided: 'This request was already approved or declined.',
	keyChanged: 'The key changed after you opened this request. Find the request again.',
	lifetime: 'An administrator shortened how long a connection can last after you opened this request. Choose again.',
	stepUpMissing: 'Enter your password or your authentication code.',
	approvalUnavailable: 'Approving connections is not available on this engine.',
	checkUnavailable: 'Could not check your password or authentication code. The connection was not approved. Try again.',
	withheld: 'Builder connections are not available to this tenant. Ask a super admin to make them available.',
	lookupFailed: 'Could not load this request. Try again.',
	approveOutage: 'Could not confirm the approval. Check whether the connection shows in the list, then try again.',
	declineOutage: 'Could not confirm the request was declined. Find it again to see whether it is still waiting.',
	revokeOutage: 'Could not confirm the connection was revoked. Check its status in the list, then try again.',
	revokeAllFailed: 'Could not revoke the connections. Check their status in the list, then try again.',
	settingOutage: 'Could not confirm the setting was saved. Reload the page to check it, then try again.',
} as const;
