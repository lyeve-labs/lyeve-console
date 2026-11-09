/**
 * What the permissions plugin answers beyond the rules the client package
 * reads and writes.
 */
import type { HttpClient } from '@lyeve-labs/client';
import { whole } from './narrow';

/** A ceiling and what already counts against it. A limit of 0 is no ceiling. */
export interface Ceiling {
	limit: number;
	current: number;
}

export interface RoleLimits {
	/** The ceiling on distinct roles holding rules, and how many hold one in the caller's tenant. */
	roles: Ceiling;
}

/**
 * The role ceiling and the roles already holding rules, the two numbers the
 * plugin checks a new role against. Super admin, with a session.
 */
export async function getRoleLimits(client: HttpClient): Promise<RoleLimits> {
	const res = await client.get<{ roles?: { limit?: unknown; current?: unknown } } | null>('/api/admin/permissions/limits');
	return { roles: { limit: whole(res?.roles?.limit), current: whole(res?.roles?.current) } };
}
