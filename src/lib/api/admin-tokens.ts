import type { StatusTone } from '@lyeve-labs/ui-kit';
import type { HttpClient } from '@lyeve-labs/client';
import type { ListEnvelope } from './list';
import { httpStatusTone } from '../tones';
import { outageFor } from '../outage';
import { plural } from '../format';

const TOKENS_URL = '/api/admin/admin-tokens';

/** One admin token as the list returns it. The secret is never part of it. */
export interface AdminToken {
	id: string;
	tenant_id: string;
	owner_user_id: string;
	owner_email?: string;
	name: string;
	display_prefix: string;
	grants: string[];
	allowed_ips: string[] | null;
	expires_at: string;
	created_at: string;
	last_used_at: string | null;
	revoked_at: string | null;
	rotated_from: string | null;
	/** The newest token rotated from this one, across every page. */
	replaced_by?: string | null;
}

/** What a create or a rotate answers: the row, plus the token, once. */
export interface AdminTokenIssued extends AdminToken {
	token: string;
}

export interface AdminGrantRoute {
	method: string;
	pattern: string;
}

/** A grant from the engine's closed catalog, with the routes that declare it. */
export interface AdminGrant {
	name: string;
	description: string;
	routes: AdminGrantRoute[];
}

/** One row of a token's request log. */
export interface AdminTokenRequest {
	id: string;
	token_id: string;
	tenant_id: string;
	method: string;
	route_pattern: string;
	status: number;
	client_ip: string;
	created_at: string;
}

/** The answer to a step-up: a code when the account has MFA, else the password. */
export type StepUp = { mfa_code: string } | { password: string };

export interface CreateAdminTokenInput {
	name: string;
	grants: string[];
	expires_at: string;
	allowed_ips: string[];
	tenant_id?: string;
}

export function listAdminTokens(client: HttpClient, limit = 50, offset = 0): Promise<ListEnvelope<AdminToken>> {
	return client.get<ListEnvelope<AdminToken>>(`${TOKENS_URL}?limit=${limit}&offset=${offset}`);
}

export async function listAdminGrants(client: HttpClient): Promise<AdminGrant[]> {
	const res = await client.get<{ data: AdminGrant[] }>(`${TOKENS_URL}/grants`);
	return res.data ?? [];
}

export function createAdminToken(client: HttpClient, input: CreateAdminTokenInput & StepUp): Promise<AdminTokenIssued> {
	return client.post<AdminTokenIssued>(TOKENS_URL, input);
}

export function rotateAdminToken(
	client: HttpClient,
	id: string,
	input: { expires_at: string } & StepUp
): Promise<AdminTokenIssued> {
	return client.post<AdminTokenIssued>(`${TOKENS_URL}/${encodeURIComponent(id)}/rotate`, input);
}

export async function revokeAdminToken(client: HttpClient, id: string): Promise<void> {
	await client.delete(`${TOKENS_URL}/${encodeURIComponent(id)}`);
}

export function listAdminTokenRequests(
	client: HttpClient,
	id: string,
	limit = 50,
	offset = 0
): Promise<ListEnvelope<AdminTokenRequest>> {
	return client.get<ListEnvelope<AdminTokenRequest>>(
		`${TOKENS_URL}/${encodeURIComponent(id)}/requests?limit=${limit}&offset=${offset}`
	);
}

/** The longest a token may live, counted from when it is issued. */
export const MAX_TOKEN_DAYS = 90;
/** The lifetimes offered as one click, in days. */
export const EXPIRY_PRESETS = [7, 30, 90] as const;
/** The choice that opens the date picker instead of a preset. */
export const CUSTOM_EXPIRY = 'custom';

const DAY_MS = 24 * 60 * 60 * 1000;

function localDay(d: Date): string {
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The instant a preset expires at, counted from `now`. */
export function presetExpiry(days: number, now: Date = new Date()): string {
	return new Date(now.getTime() + days * DAY_MS).toISOString();
}

/**
 * The first and last day the picker offers. The last is 89 days out, not 90:
 * the token expires at the end of the chosen day, and the end of the 90th day
 * lands after the 90 days the engine allows from the moment of the request.
 */
export function customExpiryBounds(today: Date = new Date()): { min: string; max: string } {
	const min = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
	const max = new Date(today.getFullYear(), today.getMonth(), today.getDate() + MAX_TOKEN_DAYS - 1);
	return { min: localDay(min), max: localDay(max) };
}

/**
 * The last second of a day in the zone this runs in, as RFC3339 with that
 * zone's offset: `2026-10-25T23:59:59+09:00`. It runs in the browser, so the
 * day ends where the operator is, not where the server is.
 */
export function endOfDayRFC3339(day: string): string {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
	if (!m) return '';
	const at = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59);
	if (Number.isNaN(at.getTime())) return '';
	const pad = (n: number) => String(Math.abs(n)).padStart(2, '0');
	const offset = -at.getTimezoneOffset();
	const sign = offset >= 0 ? '+' : '-';
	return `${localDay(at)}T23:59:59${sign}${pad(Math.trunc(offset / 60))}:${pad(offset % 60)}`;
}

/** What is wrong with a picked day, or '' when nothing is. */
export function customExpiryProblem(day: string, today: Date = new Date()): string {
	if (!day) return 'Choose the day the token expires.';
	const { min, max } = customExpiryBounds(today);
	if (day < min) return 'Choose a day after today.';
	if (day > max) return `A token expires at most ${MAX_TOKEN_DAYS} days away.`;
	return '';
}

/**
 * Where a submitted expiry lands, checked again on the server: a preset is
 * counted from the server's own clock, and a custom instant has to be in the
 * future and within the limit. Returns the instant or the problem.
 */
export function resolveExpiry(
	choice: string,
	custom: string,
	now: Date = new Date()
): { expires_at: string } | { problem: string } {
	const days = Number(choice);
	if ((EXPIRY_PRESETS as readonly number[]).includes(days)) return { expires_at: presetExpiry(days, now) };
	if (choice !== CUSTOM_EXPIRY) return { problem: 'Choose when the token expires.' };
	const at = new Date(custom);
	if (!custom || Number.isNaN(at.getTime())) return { problem: 'Choose the day the token expires.' };
	if (at.getTime() <= now.getTime()) return { problem: 'Choose a day after today.' };
	if (at.getTime() > now.getTime() + MAX_TOKEN_DAYS * DAY_MS) {
		return { problem: `A token expires at most ${MAX_TOKEN_DAYS} days away.` };
	}
	return { expires_at: custom };
}

export interface GrantGroup {
	id: string;
	label: string;
	grants: AdminGrant[];
}

/**
 * The catalog grouped by what a grant is over (`content:read` and
 * `content:write` under Content), in the order the engine lists it.
 */
export function groupGrants(grants: readonly AdminGrant[]): GrantGroup[] {
	const groups: GrantGroup[] = [];
	for (const grant of grants) {
		const id = grant.name.split(':')[0] || grant.name;
		let group = groups.find((g) => g.id === id);
		if (!group) {
			group = { id, label: id.charAt(0).toUpperCase() + id.slice(1), grants: [] };
			groups.push(group);
		}
		group.grants.push(grant);
	}
	return groups;
}

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

function isIPv6(s: string): boolean {
	if (!/^[0-9a-fA-F:.]+$/.test(s) || !s.includes(':')) return false;
	const halves = s.split('::');
	if (halves.length > 2) return false;
	const groups = halves.flatMap((h) => (h === '' ? [] : h.split(':')));
	let count = 0;
	for (const [i, g] of groups.entries()) {
		if (g.includes('.')) {
			// An embedded IPv4 address closes the address and fills two groups.
			if (i !== groups.length - 1 || !IPV4.test(g)) return false;
			count += 2;
		} else if (/^[0-9a-fA-F]{1,4}$/.test(g)) {
			count += 1;
		} else {
			return false;
		}
	}
	return halves.length === 2 ? count < 8 : count === 8;
}

/** Whether an entry is shaped like an IP address or a CIDR range. */
export function isIPOrCIDR(entry: string): boolean {
	const [addr, bits, extra] = entry.split('/');
	if (extra !== undefined || !addr) return false;
	const v4 = IPV4.test(addr);
	if (!v4 && !isIPv6(addr)) return false;
	if (bits === undefined) return true;
	if (!/^\d{1,3}$/.test(bits)) return false;
	return Number(bits) <= (v4 ? 32 : 128);
}

/** The address list typed one per line, and the lines that are not addresses. */
export function parseAllowedIPs(text: string): { entries: string[]; invalid: string[] } {
	const entries = text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);
	return { entries, invalid: entries.filter((e) => !isIPOrCIDR(e)) };
}

export function allowedIPsProblem(text: string): string {
	const { entries, invalid } = parseAllowedIPs(text);
	if (entries.length > 100) return 'List at most 100 addresses.';
	if (invalid.length === 0) return '';
	const shown = invalid.slice(0, 3).join(', ');
	return invalid.length === 1
		? `${shown} is not an IP address or a CIDR range.`
		: `${shown}${invalid.length > 3 ? ' and more' : ''} are not IP addresses or CIDR ranges.`;
}

export type TokenStatus = 'active' | 'expired' | 'revoked' | 'replaced';

/**
 * Where a token stands. A replaced token has a successor from a rotation and
 * keeps working until its shortened expiry, so it is not yet expired.
 */
export function tokenStatus(token: AdminToken, successors: ReadonlySet<string>, now: Date = new Date()): TokenStatus {
	if (token.revoked_at) return 'revoked';
	if (new Date(token.expires_at).getTime() <= now.getTime()) return 'expired';
	if (successors.has(token.id)) return 'replaced';
	return 'active';
}

/**
 * The ids of the tokens a rotation has replaced. The engine names each
 * token's successor in `replaced_by`, whatever page it is on. The successors
 * on this page also count, for an engine that does not send it.
 */
export function replacedIds(tokens: readonly AdminToken[]): Set<string> {
	const ids = new Set(tokens.map((t) => t.rotated_from).filter((id): id is string => !!id));
	for (const t of tokens) if (t.replaced_by) ids.add(t.id);
	return ids;
}

export const STATUS_LABEL: Readonly<Record<TokenStatus, string>> = {
	active: 'Active',
	expired: 'Expired',
	revoked: 'Revoked',
	replaced: 'Replaced',
};

export const STATUS_TONE: Readonly<Record<TokenStatus, StatusTone>> = {
	active: 'success',
	expired: 'neutral',
	revoked: 'danger',
	replaced: 'warn',
};

/** Danger once a token has expired, warn in its last seven days. */
export function expiryTone(expiresAt: string, now: Date = new Date()): StatusTone {
	const left = new Date(expiresAt).getTime() - now.getTime();
	if (left <= 0) return 'danger';
	if (left <= 7 * DAY_MS) return 'warn';
	return 'neutral';
}

/** `in 3 days`, `in 5 hours`, or `expired 2 days ago`. */
export function expiryDistance(expiresAt: string, now: Date = new Date()): string {
	const at = new Date(expiresAt).getTime();
	if (Number.isNaN(at)) return '';
	const left = at - now.getTime();
	const span = Math.abs(left);
	const unit = (n: number, word: string) => `${n} ${plural(n, word)}`;
	let amount: string;
	if (span < 60 * 60 * 1000) amount = unit(Math.max(1, Math.round(span / 60000)), 'minute');
	else if (span < DAY_MS) amount = unit(Math.round(span / 3600000), 'hour');
	else amount = unit(Math.round(span / DAY_MS), 'day');
	return left > 0 ? `in ${amount}` : `expired ${amount} ago`;
}

/** The count a `dropped:<n>` log row stands for, or null for an ordinary row. */
export function droppedCount(row: Pick<AdminTokenRequest, 'route_pattern' | 'status'>): number | null {
	const m = /^dropped:(\d+)$/.exec(row.route_pattern);
	return m && !row.status ? Number(m[1]) : null;
}

export function requestStatusTone(status: number): StatusTone {
	return httpStatusTone(status);
}

/** The example a new token is shown with: one read its grants may open. */
export function curlExample(origin: string): string {
	return `curl -H "Authorization: Bearer $LYEVE_ADMIN_TOKEN" ${origin}/api/admin/schemas`;
}

export interface Refusal {
	error: string;
	fields: Record<string, string>;
	/** The engine asked for a code: the account has MFA enrolled. */
	needsMfa?: boolean;
}

const CHECK_FIELDS = 'Check the highlighted fields.';

/**
 * The engine's refusal of a create or a rotate, in words for the operator and
 * on the field it concerns. The engine's sentences are written for an API
 * caller and name body keys (`expires_at`, `allowed_ips`). This turns each
 * into the field on the form.
 */
export function describeRefusal(status: number, message: string, step: 'password' | 'mfa_code'): Refusal {
	const msg = message.trim();
	if (status === 429) {
		return step === 'mfa_code' || /mfa/i.test(msg)
			? { error: 'Too many wrong codes. Wait a few minutes, then try again.', fields: {} }
			: {
					error: 'Too many wrong passwords. Your account is locked for a few minutes, and you cannot sign in until it unlocks.',
					fields: {},
				};
	}
	if (status === 403) {
		if (/^mfa_code is required/i.test(msg)) {
			return {
				error: CHECK_FIELDS,
				fields: { mfa_code: 'This account uses two-factor authentication. Enter the current code from your authenticator app.' },
				needsMfa: true,
			};
		}
		if (/MFA code is not valid/i.test(msg)) {
			return { error: CHECK_FIELDS, fields: { mfa_code: 'That code is not right. Enter the current code from your authenticator app.' } };
		}
		if (/already used/i.test(msg)) {
			return { error: CHECK_FIELDS, fields: { mfa_code: 'That code was already used. Wait for the next one.' } };
		}
		if (/password is not valid/i.test(msg)) {
			return { error: CHECK_FIELDS, fields: { password: 'That password is not right.' } };
		}
		if (/^password is required/i.test(msg)) {
			return { error: CHECK_FIELDS, fields: { password: 'Enter your current password.' } };
		}
		return { error: msg || 'You cannot issue this token.', fields: {} };
	}
	if (status === 422) {
		const ip = /^allowed_ips entry "(.*)" is not/.exec(msg);
		if (ip) return { error: CHECK_FIELDS, fields: { allowed_ips: `${ip[1] || 'An empty line'} is not an IP address or a CIDR range.` } };
		if (/^allowed_ips/.test(msg)) return { error: CHECK_FIELDS, fields: { allowed_ips: 'List at most 100 addresses.' } };
		if (/^expires_at must be at most/.test(msg)) {
			return { error: CHECK_FIELDS, fields: { expires_at: `A token expires at most ${MAX_TOKEN_DAYS} days away.` } };
		}
		if (/^expires_at/.test(msg)) return { error: CHECK_FIELDS, fields: { expires_at: 'Choose a day after today.' } };
		if (/^name/.test(msg)) return { error: CHECK_FIELDS, fields: { name: 'Name the token, in at most 255 characters.' } };
		if (/^grants/.test(msg)) return { error: CHECK_FIELDS, fields: { grants: 'Choose at least one grant from the list.' } };
		if (/^tenant_id/.test(msg)) return { error: CHECK_FIELDS, fields: { tenant_id: 'Choose a tenant from the list.' } };
		return { error: msg || 'Could not issue the token.', fields: {} };
	}
	if (status === 409) return { error: msg || 'This token can no longer be rotated.', fields: {} };
	if (status === 404) return { error: 'This token no longer exists. Reload the list.', fields: {} };
	if (status === 503) return { error: outageFor('nothing was changed'), fields: {} };
	return { error: 'Could not issue the token. Try again.', fields: {} };
}
