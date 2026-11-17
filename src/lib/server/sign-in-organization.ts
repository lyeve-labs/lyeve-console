import { organizationFromForm, type Organization } from '#lib/organization.ts';

/**
 * Whether the signed-out forms ask for an organization.
 *
 * Only a console that serves more than one organization on an address that
 * names none needs the field: an account an identity provider created, or one
 * with a membership in another organization, names where it signs in. Everyone
 * else would read a field that does not apply to them, so it stays hidden
 * unless SIGN_IN_ORGANIZATION is true.
 */
export function asksOrganization(env: Record<string, string | undefined> = process.env): boolean {
	return /^(true|1)$/i.test(env.SIGN_IN_ORGANIZATION?.trim() ?? '');
}

/**
 * The organization a signed-out form names. While the console does not ask
 * for one, a posted name is dropped rather than sent, so the engine never
 * receives an organization these pages did not offer to take.
 */
export function askedOrganization(form: FormData): Organization {
	return asksOrganization() ? organizationFromForm(form) : { ok: true, value: '' };
}
