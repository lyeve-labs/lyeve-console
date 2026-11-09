/**
 * The rate-limit plugin's admin routes.
 *
 * Three kinds of limit live here. The global limit is one rate and burst over
 * every request. The protections are the built-in sign-in and reset limits,
 * enforced on every instance. Custom rules are a rule per endpoint pattern,
 * tenant or role, counted by address or account. Whether this instance may
 * change the protections and enforce custom rules is the plugin's answer, in
 * the overview it serves. A stored custom rule on an instance that may not
 * enforce it stays listed and is not enforced.
 *
 * A custom rule is a sustained rate and a burst, matched against an endpoint and
 * optionally narrowed to one tenant. A rule with no tenant applies to every
 * one of them, which is the setting most likely to be made by accident and
 * the hardest to notice afterwards, so the screen names it rather than
 * printing an empty cell.
 *
 * The status route reports what the limiter is doing right now: which callers
 * are close to their limit and when each window resets. It is a snapshot from
 * one process, which matters on more than one node.
 */
import type { StatusTone } from '@lyeve-labs/ui-kit';
import type { HttpClient } from '@lyeve-labs/client';
import type { ListEnvelope } from './list';
import { limitOf, type Limit } from './limits';

const RULES_URL = '/api/admin/rate-limits';
const STATUS_URL = '/api/admin/rate-limits/status';
const OVERVIEW_URL = '/api/admin/rate-limits/overview';
const GLOBAL_URL = '/api/admin/rate-limits/global';
const PROTECTIONS_URL = '/api/admin/rate-limits/protections';

export type RuleKind = 'global' | 'protection' | 'custom';
export type KeyBy = 'ip' | 'user';

export interface RateRule {
	id: string;
	/** Null means every tenant. */
	tenant_id?: string | null;
	endpoint: string;
	/** Sustained requests per second. */
	rate: number;
	burst: number;
	enabled: boolean;
	kind: RuleKind;
	/** Absent means every caller. */
	role?: string | null;
	key_by: KeyBy;
	/** False when disabled, or when the engine reports it does not enforce the rule. */
	enforced: boolean;
	created_at: string;
	updated_at: string;
}

export interface Protection {
	name: string;
	plugin: string;
	description: string;
	/** True for a limit on a route, false for one a plugin counts itself. */
	route: boolean;
	requests: number;
	window_seconds: number;
	default_requests: number;
	default_window_seconds: number;
	customized: boolean;
}

export interface EngineLimit {
	scope: 'global' | 'public';
	endpoint: string;
	rate: number;
	burst: number;
	per_tenant?: boolean;
	source: 'default' | 'environment';
	setting: string;
}

export interface RateLimitOverview {
	custom_licensed: boolean;
	global: RateRule | null;
	protections: Protection[];
	engine: EngineLimit[];
}

export interface LimiterState {
	rule_id: string;
	tenant_id?: string;
	client_ip: string;
	endpoint: string;
	rate: number;
	burst: number;
	remaining: number;
	reset_at: string;
}

export async function listRules(
	client: HttpClient,
	limit: number,
	offset: number,
	kind?: RuleKind
): Promise<ListEnvelope<RateRule>> {
	const only = kind ? `&kind=${kind}` : '';
	return client.get<ListEnvelope<RateRule>>(`${RULES_URL}?limit=${limit}&offset=${offset}${only}`);
}

/** The status route answers its buckets under their own key, not data. */
export interface LimiterStatus {
	buckets: LimiterState[] | null;
	count: number;
}

export async function readStatus(client: HttpClient): Promise<LimiterStatus> {
	return client.get<LimiterStatus>(STATUS_URL);
}

export async function readOverview(client: HttpClient): Promise<RateLimitOverview> {
	return client.get<RateLimitOverview>(OVERVIEW_URL);
}

export async function updateGlobal(
	client: HttpClient,
	body: { rate: number; burst: number; enabled: boolean }
): Promise<RateRule> {
	return client.put<RateRule>(GLOBAL_URL, body);
}

export async function setProtection(
	client: HttpClient,
	body: { name: string; requests: number; window_seconds: number }
): Promise<void> {
	await client.put(PROTECTIONS_URL, body);
}

export async function resetProtection(client: HttpClient, name: string): Promise<void> {
	await client.post(`${PROTECTIONS_URL}/reset`, { name });
}

export interface SaveRule {
	tenant_id?: string | null;
	endpoint: string;
	rate: number;
	burst: number;
	enabled?: boolean;
	/** An empty string clears the role. Null keeps the stored one on an edit. */
	role?: string | null;
	key_by?: KeyBy;
}

export async function createRule(client: HttpClient, body: SaveRule): Promise<RateRule> {
	return client.post<RateRule>(RULES_URL, body);
}

export async function updateRule(
	client: HttpClient,
	id: string,
	body: Partial<SaveRule>
): Promise<RateRule> {
	return client.put<RateRule>(`${RULES_URL}/${encodeURIComponent(id)}`, body);
}

export async function deleteRule(client: HttpClient, id: string): Promise<void> {
	await client.delete(`${RULES_URL}/${encodeURIComponent(id)}`);
}

/**
 * What a rule covers, in words.
 *
 * A null tenant means every tenant, which is the setting most likely to be
 * made by accident: it is what you get by leaving the field empty. Printing an
 * empty cell for it reads as "not applicable" rather than "everyone".
 */
export function scopeLabel(rule: RateRule): string {
	return rule.tenant_id ? rule.tenant_id : 'Every tenant';
}

export function scopeTone(rule: RateRule): StatusTone {
	return rule.tenant_id ? 'neutral' : 'warn';
}

/**
 * The rate in the unit a person thinks in.
 *
 * Stored as requests per second, which reads badly below one: 0.016 per second
 * is a rule somebody wrote as one a minute, and showing the fraction hides
 * what they meant.
 */
export function rateLabel(rate: number): string {
	if (!Number.isFinite(rate) || rate <= 0) return 'Blocked';
	if (rate >= 1) {
		const n = Number.isInteger(rate) ? rate : Number(rate.toFixed(2));
		return `${n}/second`;
	}
	const perMinute = rate * 60;
	if (perMinute >= 1) {
		const n = Number.isInteger(perMinute) ? perMinute : Number(perMinute.toFixed(1));
		return `${n}/minute`;
	}
	const perHour = rate * 3600;
	const n = Number.isInteger(perHour) ? perHour : Number(perHour.toFixed(1));
	return `${n}/hour`;
}

/**
 * Whether a rule can ever let a request through.
 *
 * A burst of zero is a closed door whatever the rate says, because the first
 * request has no token to take. It stores fine and reads as a configured
 * limit rather than as a block.
 */
export function blocksEverything(rule: RateRule): boolean {
	return rule.enabled && (rule.burst <= 0 || rule.rate <= 0);
}

/** Callers with nothing left in their window. */
export function exhausted(states: readonly LimiterState[]): LimiterState[] {
	return states.filter((s) => s.remaining <= 0);
}

/** A reset time as a countdown, which is what a person reading it wants. */
export function resetsIn(when: string, now: Date = new Date()): string {
	const at = Date.parse(when);
	if (Number.isNaN(at)) return '-';
	const seconds = Math.round((at - now.getTime()) / 1000);
	if (seconds <= 0) return 'now';
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
	return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/**
 * An endpoint pattern the plugin will match.
 *
 * "*" for every request, or "METHOD /path" where the method may be "*", a
 * segment may be a {name} placeholder and the last segment may be "*". The
 * engine refuses anything else with a 400. Checking here names the problem
 * before the round trip.
 */
const METHOD = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|\*)$/;
const PARAM = /^\{[A-Za-z_][A-Za-z0-9_]*\}$/;

export function endpointIsSound(endpoint: string): boolean {
	const value = endpoint.trim();
	if (value === '*') return true;
	const space = value.indexOf(' ');
	if (space < 0) return false;
	const method = value.slice(0, space);
	const path = value.slice(space + 1);
	if (!METHOD.test(method) || !path.startsWith('/') || /[\s?#]/.test(path)) return false;
	if (path === '/') return true;
	const segments = path.slice(1).split('/');
	return segments.every((seg, i) => {
		if (seg === '') return false;
		if (seg === '*') return i === segments.length - 1;
		if (/[{}*]/.test(seg)) return PARAM.test(seg);
		return true;
	});
}

/** A role name the engine accepts: 1 to 64 letters, digits or _ . : - */
export function roleIsSound(role: string): boolean {
	return /^[A-Za-z0-9_.:-]{1,64}$/.test(role);
}

/**
 * A count per window in the unit a person thinks in: "5 per 15 minutes".
 */
export function windowLabel(requests: number, windowSeconds: number): string {
	if (!Number.isFinite(windowSeconds) || windowSeconds <= 0) return `${requests}`;
	const units: [number, string][] = [
		[86400, 'day'],
		[3600, 'hour'],
		[60, 'minute'],
		[1, 'second'],
	];
	for (const [size, unit] of units) {
		if (windowSeconds % size === 0) {
			const n = windowSeconds / size;
			return `${requests} per ${n === 1 ? unit : `${n} ${unit}s`}`;
		}
	}
	return `${requests} per ${windowSeconds} seconds`;
}

const TENANT_GLOBAL_URL = '/api/admin/rate-limits/tenant-global';
const IP_RULES_URL = '/api/admin/rate-limits/ip-rules';
const HISTORY_URL = '/api/admin/rate-limits/history';

/** The caller's tenant limit, the instance-wide one beside it, and whether writing one is licensed. */
export interface TenantGlobalRead {
	licensed: boolean;
	tenant_global: RateRule | null;
	install_global: RateRule | null;
}

export type AddressList = 'allow' | 'deny';

/** An address or range on the tenant's allow or deny list. */
export interface AddressEntry {
	id: string;
	cidr: string;
	list: AddressList;
	note: string;
	created_at: string;
}

export interface AddressListRead {
	licensed: boolean;
	/** How many entries one tenant may hold and holds, as the plugin states it. */
	limits?: { entries?: Limit };
	rules: AddressEntry[] | null;
}

/**
 * The codes the plugin gives the three refusals of a new entry, which all
 * answer 409: a deny entry that covers the caller's own address, a tenant
 * at its ceiling, and a range already listed.
 */
export const ADDRESS_SELF_LOCKOUT = 'rate_limit.self_lockout';
export const ADDRESS_LIST_FULL = 'rate_limit.list_full';
export const ADDRESS_DUPLICATE = 'rate_limit.duplicate_entry';

/**
 * The entry ceiling and the count held against it. A read with no limits
 * object counts the entries it listed and states no ceiling.
 */
export function addressLimit(read: AddressListRead): Limit {
	return limitOf(read.limits, 'entries') ?? { limit: null, current: read.rules?.length ?? 0 };
}

/** How many requests one rule or list entry refused in one minute. */
export interface RefusalMinute {
	minute: string;
	rule_id: string;
	/** The rule's kind, or deny for an address the deny list refused. */
	kind: string;
	endpoint: string;
	refused: number;
}

export interface RefusalHistory {
	hours: number;
	minutes: RefusalMinute[] | null;
	total_refused: number;
}

export async function readTenantGlobal(client: HttpClient): Promise<TenantGlobalRead> {
	return client.get<TenantGlobalRead>(TENANT_GLOBAL_URL);
}

export async function setTenantGlobal(
	client: HttpClient,
	body: { rate: number; burst: number; enabled: boolean },
): Promise<RateRule> {
	return client.put<RateRule>(TENANT_GLOBAL_URL, body);
}

export async function clearTenantGlobal(client: HttpClient): Promise<void> {
	await client.delete(TENANT_GLOBAL_URL);
}

export async function listAddressEntries(client: HttpClient): Promise<AddressListRead> {
	return client.get<AddressListRead>(IP_RULES_URL);
}

export async function createAddressEntry(
	client: HttpClient,
	body: { cidr: string; list: AddressList; note: string },
): Promise<AddressEntry> {
	return client.post<AddressEntry>(IP_RULES_URL, body);
}

export async function deleteAddressEntry(client: HttpClient, id: string): Promise<void> {
	await client.delete(`${IP_RULES_URL}/${encodeURIComponent(id)}`);
}

/** The refusal history over the last `hours`, from 1 to 168. */
export async function readRefusalHistory(client: HttpClient, hours: number): Promise<RefusalHistory> {
	return client.get<RefusalHistory>(`${HISTORY_URL}?hours=${hours}`);
}

/** The windows the history offers. The plugin reads at most a week. */
export const HISTORY_WINDOWS = [
	{ value: '1', label: 'Last hour' },
	{ value: '24', label: 'Last day' },
	{ value: '168', label: 'Last week' },
] as const;

/** One row of the history: a rule or an entry, with its refusals summed over the window. */
export interface RefusalTotal {
	rule_id: string;
	kind: string;
	endpoint: string;
	refused: number;
	last: string;
}

/** The minutes summed per rule or entry, most refused first. */
export function refusalTotals(minutes: readonly RefusalMinute[]): RefusalTotal[] {
	const by = new Map<string, RefusalTotal>();
	for (const m of minutes) {
		const key = `${m.rule_id}\u0000${m.kind}\u0000${m.endpoint}`;
		const row = by.get(key);
		if (row) {
			row.refused += m.refused;
			if (m.minute > row.last) row.last = m.minute;
		} else {
			by.set(key, { rule_id: m.rule_id, kind: m.kind, endpoint: m.endpoint, refused: m.refused, last: m.minute });
		}
	}
	return [...by.values()].sort((a, b) => b.refused - a.refused);
}

/** What refused, in words. */
export function refusalKindLabel(kind: string): string {
	switch (kind) {
		case 'deny':
			return 'Deny list';
		case 'tenant_global':
			return 'Tenant limit';
		case 'global':
			return 'Global limit';
		case 'protection':
			return 'Protection';
		case 'custom':
			return 'Custom rule';
		default:
			return kind;
	}
}

/**
 * An address or a CIDR range, IPv4 or IPv6. The plugin normalizes and is the
 * judge. This catches a typo before the round trip.
 */
export function cidrIsSound(raw: string): boolean {
	const value = raw.trim();
	if (!value || value.length > 64) return false;
	const [addr, bits, extra] = value.split('/');
	if (extra !== undefined) return false;
	const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(addr);
	if (v4) {
		if (v4.slice(1).some((o) => Number(o) > 255)) return false;
		return bits === undefined || (/^\d{1,2}$/.test(bits) && Number(bits) <= 32);
	}
	if (!/^[0-9A-Fa-f:.]+$/.test(addr) || !addr.includes(':')) return false;
	return bits === undefined || (/^\d{1,3}$/.test(bits) && Number(bits) <= 128);
}

/** Who a custom rule applies to and how it counts, in words. */
export function audienceLabel(rule: Pick<RateRule, 'role' | 'key_by'>): string {
	const who = rule.role ? (rule.role === 'anonymous' ? 'Signed-out callers' : `Role ${rule.role}`) : 'Everyone';
	return rule.key_by === 'user' ? `${who}, per account` : `${who}, per address`;
}
