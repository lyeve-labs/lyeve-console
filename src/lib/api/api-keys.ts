import type { HttpClient } from '@lyeve-labs/client';
import type { APIKey, CreateAPIKeyResponse } from '@lyeve-labs/client';
import { query, type ListEnvelope } from './list';

const KEYS_URL = '/api/admin/api-keys';

/**
 * A page of API keys.
 *
 * The published `listAPIKeys` takes no pagination and the endpoint pages at
 * fifty, so this asks for a page explicitly.
 */
export function listKeys(
	client: HttpClient,
	limit = 50,
	offset = 0,
	filter: { q?: string; status?: string } = {}
): Promise<ListEnvelope<APIKey> | APIKey[]> {
	return client.get<ListEnvelope<APIKey> | APIKey[]>(`${KEYS_URL}${query({ limit, offset, q: filter.q, status: filter.status })}`);
}

export interface KeyInput {
	name: string;
	roles: string[];
	schemas: string[];
	/** What the key may do, as resource:action pairs. */
	scopes: string[];
	expires_at: string | null;
	/** Requests a key may make in a UTC calendar month, where 0 is no ceiling. */
	monthly_limit?: number;
	/** Requests a key may make in a UTC day, where 0 is no ceiling. */
	daily_limit?: number;
	/** Requests a key may make in a UTC clock hour, where 0 is no ceiling. */
	hourly_limit?: number;
}

/** A key's three request ceilings, 0 meaning none. */
export interface KeyLimits {
	hourly_limit: number;
	daily_limit: number;
	monthly_limit: number;
}

/** The ceiling fields, shortest window first, with how the form names each. */
export const LIMIT_FIELDS: { field: keyof KeyLimits; label: string; per: string }[] = [
	{ field: 'hourly_limit', label: 'Per hour', per: 'h' },
	{ field: 'daily_limit', label: 'Per day', per: 'day' },
	{ field: 'monthly_limit', label: 'Per month', per: 'mo' },
];

/**
 * Create a key. Each ceiling is sent only when the operator filled it in, so
 * the engine sees exactly what the form set.
 */
export function createKey(client: HttpClient, input: KeyInput): Promise<CreateAPIKeyResponse> {
	return client.post<CreateAPIKeyResponse>(KEYS_URL, input);
}

/**
 * Set or clear a key's ceilings. The engine may refuse a write with 402. The
 * page renders the refusal it sends.
 */
export function setLimits(client: HttpClient, id: string, limits: KeyLimits): Promise<APIKey> {
	return client.patch<APIKey>(`${KEYS_URL}/${encodeURIComponent(id)}/limits`, limits);
}

/** A whole number of requests from a form field, 0 for blank, or null when it is not one. */
export function parseLimit(raw: string): number | null {
	const s = raw.trim();
	if (!s) return 0;
	const n = Number(s);
	return Number.isInteger(n) && n >= 0 ? n : null;
}

/**
 * The ceilings a form sent, or the fields that are not whole numbers. A
 * shorter window above a longer one can never be reached, so it is refused
 * here as the engine refuses it.
 */
export function parseLimits(data: FormData): { limits: KeyLimits } | { fields: Record<string, string> } {
	const fields: Record<string, string> = {};
	const limits = { hourly_limit: 0, daily_limit: 0, monthly_limit: 0 };
	for (const { field } of LIMIT_FIELDS) {
		const n = parseLimit(String(data.get(field) ?? ''));
		if (n === null) fields[field] = 'Enter a whole number of requests, or 0 for no limit';
		else limits[field] = n;
	}
	if (Object.keys(fields).length) return { fields };
	const problem = limitOrderProblem(limits);
	if (problem) return { fields: { [problem.field]: problem.message } };
	return { limits };
}

/** A window whose ceiling sits above a longer window's, or null. */
export function limitOrderProblem(l: KeyLimits): { field: keyof KeyLimits; message: string } | null {
	if (l.hourly_limit > 0 && l.daily_limit > 0 && l.hourly_limit > l.daily_limit) {
		return { field: 'hourly_limit', message: 'Keep this at or below the daily limit, or it never takes effect' };
	}
	if (l.daily_limit > 0 && l.monthly_limit > 0 && l.daily_limit > l.monthly_limit) {
		return { field: 'daily_limit', message: 'Keep this at or below the monthly limit, or it never takes effect' };
	}
	if (l.hourly_limit > 0 && l.monthly_limit > 0 && l.hourly_limit > l.monthly_limit) {
		return { field: 'hourly_limit', message: 'Keep this at or below the monthly limit, or it never takes effect' };
	}
	return null;
}

/**
 * A listed key's ceilings. The published APIKey type declares only the
 * monthly one, and the engine may send neither of the others, so a missing
 * field reads as no ceiling.
 */
export function limitsOf(key: APIKey): KeyLimits {
	const k = key as APIKey & Partial<Record<keyof KeyLimits, unknown>>;
	const n = (v: unknown) => (typeof v === 'number' && v > 0 ? v : 0);
	return { hourly_limit: n(k.hourly_limit), daily_limit: n(k.daily_limit), monthly_limit: n(k.monthly_limit) };
}

/**
 * The longest ids value, encoded, that one usage read carries. nginx refuses
 * a request line over 8 KB by default and Cloudflare a URL over 16 KB, and a
 * page of 500 keys names about 19.5 KB of ids, so a page splits its ids into
 * reads that each stay well under the smaller limit.
 */
export const USAGE_IDS_BUDGET = 6144;

/** Splits ids into batches whose encoded, comma-joined length fits budget. */
export function usageIdBatches(ids: readonly string[], budget = USAGE_IDS_BUDGET): string[][] {
	const comma = encodeURIComponent(',').length;
	const batches: string[][] = [];
	let batch: string[] = [];
	let size = 0;
	for (const id of ids) {
		const cost = encodeURIComponent(id).length;
		if (batch.length > 0 && size + comma + cost > budget) {
			batches.push(batch);
			batch = [];
			size = 0;
		}
		size += (batch.length > 0 ? comma : 0) + cost;
		batch.push(id);
	}
	if (batch.length > 0) batches.push(batch);
	return batches;
}

/**
 * The metered usage of every key in ids for a billing period (YYYY-MM), read
 * in as few requests as the URL limit allows. The usage plugin meters
 * requests and owns the count a key's monthly limit is enforced against, so
 * the read goes there. It answers a row for each key it counts and leaves the
 * rest out. A failed read rejects, and the caller tells an engine without the
 * route from a figure that could not be read.
 */
export async function keysUsage<T>(client: HttpClient, ids: readonly string[], period: string): Promise<T[]> {
	const reads = usageIdBatches(ids).map((batch) => {
		const query = new URLSearchParams({ ids: batch.join(','), period });
		return client.get<T[]>(`/api/admin/usage/api-keys?${query}`);
	});
	return (await Promise.all(reads)).flat();
}

/** Roles a key may hold only with an expiry. */
export const PRIVILEGED_KEY_ROLES = ['admin', 'super_admin'] as const;
/** The longest a key holding one of them may live, in days. */
export const MAX_PRIVILEGED_KEY_DAYS = 90;

export function isPrivilegedKey(roles: readonly string[]): boolean {
	return roles.some((r) => (PRIVILEGED_KEY_ROLES as readonly string[]).includes(r));
}

function isoDay(d: Date): string {
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * The first and last day a privileged key may expire on, counted from today.
 * The last day stops one short of the limit: the chosen day is sent as its
 * UTC midnight, which east of UTC falls after the local day began, and the
 * engine measures its 90 days from the moment of the request.
 */
export function privilegedExpiryBounds(today: Date = new Date()): { min: string; max: string } {
	const min = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
	const max = new Date(today.getFullYear(), today.getMonth(), today.getDate() + MAX_PRIVILEGED_KEY_DAYS - 1);
	return { min: isoDay(min), max: isoDay(max) };
}

/**
 * What is wrong with the expiry chosen for a key, or '' when nothing is. The
 * engine refuses the same thing. Saying it on the field is kinder than its
 * refusal arriving as a banner.
 */
export function keyExpiryProblem(roles: readonly string[], day: string, today: Date = new Date()): string {
	if (!isPrivilegedKey(roles)) return '';
	if (!day) return `A key with the admin or super admin role needs an expiry, at most ${MAX_PRIVILEGED_KEY_DAYS} days away.`;
	const { min, max } = privilegedExpiryBounds(today);
	if (day < min) return 'Choose a day after today.';
	if (day > max) return `A key with the admin or super admin role expires at most ${MAX_PRIVILEGED_KEY_DAYS} days away.`;
	return '';
}

/**
 * What is wrong with the scopes chosen for a key, or '' when nothing is. A key
 * holding an admin role is judged by its role and needs no scope. Any other
 * key with no scope can call nothing, so it is refused before it is made.
 */
export function keyScopeProblem(roles: readonly string[], scopes: readonly string[]): string {
	if (isPrivilegedKey(roles) || scopes.length > 0) return '';
	return 'Choose at least one scope. A key without one cannot call any route.';
}

/** Roles the engine lets write content, beside the scope that names the write. */
const WRITING_ROLES = ['editor', 'admin', 'super_admin'];

/**
 * What is wrong with the roles chosen for a key, or '' when nothing is. The
 * engine refuses a content write to a key without a writing role, whatever
 * its scopes say, so a key that names a write needs one.
 */
export function keyRoleProblem(roles: readonly string[], scopes: readonly string[]): string {
	if (roles.some((r) => WRITING_ROLES.includes(r))) return '';
	const writes = scopes.some((s) => /^content(\.[^:]+)?:/.test(s) && !s.endsWith(':read'));
	if (!writes) return '';
	return 'Writing content needs the editor role. Tick editor, or leave create, update and delete off.';
}

/**
 * The scopes a listed key holds. The engine sends them with every key, and
 * the published APIKey type does not declare the field, so a key that
 * arrives without it reads as none.
 */
export function scopesOf(key: APIKey): string[] {
	const scopes = (key as APIKey & { scopes?: unknown }).scopes;
	return Array.isArray(scopes) ? scopes.map(String) : [];
}
