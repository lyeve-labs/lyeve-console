import type { HttpClient } from '@lyeve-labs/client';
import { listTenantMembers } from '$lib/api/tenant-access';

/**
 * An account as a column names it and a picker offers it. The tenant is empty
 * for an account that belongs to none, such as the first super admin.
 */
export type Person = { id: string; email: string; tenant_id: string };

/** How many accounts one read asks for. The engine answers no total. */
export const PEOPLE_LIMIT = 200;

/**
 * The first page of accounts, by id and email.
 *
 * The engine answers a bare array with no total, so this is the first page of
 * the directory and not all of it. Where an account past it is shown, its id
 * stands in for the email. A caller the engine refuses the list to gets none,
 * and the page falls back the same way.
 */
export async function listPeople(client: HttpClient): Promise<Person[]> {
	const res = await client.get<unknown>(`/api/admin/users?limit=${PEOPLE_LIMIT}&offset=0`).catch(() => null);
	const rows = Array.isArray(res)
		? res
		: res && typeof res === 'object' && Array.isArray((res as { data?: unknown }).data)
			? ((res as { data: unknown[] }).data)
			: [];
	const out: Person[] = [];
	for (const row of rows) {
		if (!row || typeof row !== 'object') continue;
		const { id, email, tenant_id } = row as { id?: unknown; email?: unknown; tenant_id?: unknown };
		if (typeof id === 'string' && id && typeof email === 'string' && email) {
			out.push({ id, email, tenant_id: typeof tenant_id === 'string' ? tenant_id : '' });
		}
	}
	return out;
}

/** How many of one tenant's accounts one read asks for, the most the tenancy plugin answers. */
export const TENANT_PEOPLE_LIMIT = 500;

/**
 * The accounts whose home is `tenant`, read from the tenancy plugin's member
 * list, which holds that tenant's accounts alone. A membership lets an account
 * act in another tenant, but the engine mentions only an account of the
 * entry's own tenant, so members whose home is elsewhere are left out. A read
 * that fails answers none, like the directory.
 */
export async function listTenantPeople(client: HttpClient, tenant: string): Promise<Person[]> {
	const res = await listTenantMembers(client, tenant, TENANT_PEOPLE_LIMIT, 0).catch(() => null);
	return (res?.members ?? [])
		.filter((m) => m.home && m.id && m.email)
		.map((m) => ({ id: m.id, email: m.email, tenant_id: tenant }));
}
