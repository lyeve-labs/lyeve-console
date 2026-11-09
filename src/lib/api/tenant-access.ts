/**
 * What one tenant may use, and who may act in it.
 *
 * What the instance serves is every tenant's ceiling. A super admin can
 * withhold a plugin from one tenant beneath it, and the engine then refuses
 * the plugin's routes and its feature checks, with every name that falls with
 * it, to that tenant. Withholding never grants: a name the instance does not
 * serve stays off whatever this says.
 *
 * Membership is the other half. An account may act in its home tenant and in
 * every tenant it holds a membership in, with the roles that membership names.
 */
import type { HttpClient, User } from '@lyeve-labs/client';
import { readAll } from './list';

export interface TenantFeatures {
	tenant: string;
	withheld: string[];
	/** Every plugin the engine accepts in `withheld`. */
	known: string[];
}

export interface TenantMember {
	id: string;
	email: string;
	disabled: boolean;
	/** The tenant is the account's home, so its access cannot be revoked here. */
	home: boolean;
	/** The roles the account holds in this tenant. */
	roles: string[];
}

export interface FeatureChoice {
	name: string;
	available: boolean;
}


export function getTenantFeatures(client: HttpClient, tenant: string): Promise<TenantFeatures> {
	return client.get<TenantFeatures>(`/api/admin/tenant-features/${encodeURIComponent(tenant)}`);
}

export function setTenantFeatures(client: HttpClient, tenant: string, withheld: string[]): Promise<TenantFeatures> {
	return client.put<TenantFeatures>(`/api/admin/tenant-features/${encodeURIComponent(tenant)}`, { withheld });
}

export function listTenantMembers(
	client: HttpClient,
	tenant: string,
	limit = 50,
	offset = 0,
): Promise<{ members: TenantMember[]; total: number }> {
	return client.get(`/api/admin/tenant-members/${encodeURIComponent(tenant)}?limit=${limit}&offset=${offset}`);
}

export function grantMembership(client: HttpClient, userId: string, tenant: string, roles: string[]): Promise<unknown> {
	return client.put(`/api/admin/users/${encodeURIComponent(userId)}/memberships`, { tenant_id: tenant, roles });
}

export function revokeMembership(client: HttpClient, userId: string, tenant: string): Promise<unknown> {
	return client.delete(`/api/admin/users/${encodeURIComponent(userId)}/memberships/${encodeURIComponent(tenant)}`);
}

/**
 * The names worth offering: what the license carries, plus anything already
 * withheld so it can be given back. A name the license lacks is left out,
 * because withholding it changes nothing and a switch that does nothing reads
 * as a switch that is broken.
 */
export function featureChoices(known: string[], licensed: string[], withheld: string[]): FeatureChoice[] {
	const offered = new Set(licensed);
	const off = new Set(withheld);
	return known
		.filter((name) => offered.has(name) || off.has(name))
		.sort()
		.map((name) => ({ name, available: !off.has(name) }));
}

/** Names offered but not ticked: the withheld set a submitted form asks for. */
export function withheldFrom(offered: string[], available: string[]): string[] {
	const on = new Set(available);
	return offered.filter((name) => !on.has(name)).sort();
}

/**
 * Finds an account by email. The users endpoint has no email filter, so this
 * walks its pages, which is bounded: past the cap the operator is told to
 * narrow down rather than left waiting.
 */
export async function findUserByEmail(client: HttpClient, email: string, maxPages = 25): Promise<User | null> {
	const want = email.trim().toLowerCase();
	const [hit] = await walkUsers(client, (u) => u.email.toLowerCase() === want, 1, maxPages);
	return hit ?? null;
}

/** Finds an account by id, walking the users pages the way the email lookup does. */
export async function findUserById(client: HttpClient, id: string, maxPages = 25): Promise<User | null> {
	const [hit] = await walkUsers(client, (u) => u.id === id, 1, maxPages);
	return hit ?? null;
}

/**
 * The ids among `ids` whose account holds super_admin. A tenant's member list
 * shows the roles a home membership sets, which can leave out the account's
 * own super_admin, so only the account says whether it holds it.
 */
export async function superAdminsAmong(client: HttpClient, ids: string[], maxPages = 25): Promise<string[]> {
	if (ids.length === 0) return [];
	const want = new Set(ids);
	const hits = await walkUsers(client, (u) => want.has(u.id), ids.length, maxPages);
	return hits.filter((u) => (u.roles ?? []).includes('super_admin')).map((u) => u.id);
}

/** Walks the users pages until `count` accounts match or the list ends. */
async function walkUsers(client: HttpClient, match: (u: User) => boolean, count: number, maxPages: number): Promise<User[]> {
	const size = 200;
	const { rows } = await readAll(
		async (limit, offset) => {
			const users = await client.get<User[]>(`/api/admin/users?limit=${limit}&offset=${offset}`);
			return { rows: Array.isArray(users) ? users : [], total: null };
		},
		size,
		maxPages * size,
		(read) => read.filter(match).length >= count
	);
	return rows.filter(match).slice(0, count);
}
