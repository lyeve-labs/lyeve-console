/**
 * What the multitenant plugin answers about the tenant registry beyond the
 * list, the create, the update and the delete the client package covers.
 */
import { ApiError, type HttpClient } from '@lyeve-labs/client';
import { refusalOf, type Refusal } from '#lib/api/refusal.ts';
import { linkHref } from '#lib/links.ts';

/** What the plugin says about creating a tenant on this instance. */
export interface Provisioning {
	enabled: boolean;
	/** Where creating tenants is bought, when the plugin names it. Empty otherwise. */
	upgradeUrl: string;
}

/**
 * Whether this instance may create tenants, as the multitenant plugin says.
 * The plugin asks the same check its create route makes, so a page offers a
 * create only where one would pass. A read that says no can carry the link
 * the create route's refusal carries. Super admin only.
 */
export async function getProvisioning(client: HttpClient): Promise<Provisioning> {
	const res = await client.get<{ enabled?: unknown; upgrade_url?: unknown } | null>('/api/admin/tenants/provisioning');
	const enabled = res?.enabled === true;
	const upgradeUrl = enabled ? '' : (linkHref(typeof res?.upgrade_url === 'string' ? res.upgrade_url : null) ?? '');
	return { enabled, upgradeUrl };
}

/**
 * The cap a tenant ceiling refusal reads as. The plugin's ceiling refusal
 * names no cap, so the page names what it counts.
 */
export const TENANTS_CAP = 'tenants';

/**
 * The refusal a tenant create carries, or null when it is not a 402.
 *
 * The plugin refuses a create two ways. Without the capability to create
 * tenants it answers payment_required, which reads as any capability this
 * license lacks. At the license's tenant ceiling it answers a sentence of its
 * own with no cap and no count, which reads as a limit reached: the operator
 * has the capability and has used what the license allows.
 */
export function tenantRefusal(err: unknown): Refusal | null {
	const refused = refusalOf(err);
	if (!refused || refused.kind === 'cap') return refused;
	const body = (err as ApiError).body as { error?: unknown } | null | undefined;
	// Any other 402 that carries a sentence reads as the ceiling too. The
	// create answers 402 only these two ways and a store failure answers 503,
	// so a third refusal there needs its own branch here.
	const sentence = typeof body?.error === 'string' && body.error !== 'payment_required';
	if (!sentence) return refused;
	return { kind: 'cap', cap: TENANTS_CAP, limit: null, current: null, upgradeUrl: refused.upgradeUrl };
}
