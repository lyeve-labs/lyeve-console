import type { HttpClient, User } from '@lyeve-labs/client';
import { plural } from '../format';

/**
 * An account as the users list reads it. `tenant_local` marks an account that
 * a tenant's identity provider created: it belongs to that tenant alone, its
 * address can repeat in another tenant, and `email` is the address it signs in
 * with. An engine that predates the marker sends none, which reads as false.
 */
export type ListedUser = User & { tenant_local?: boolean };

/**
 * Replaces an account's password. Only a super admin may call it, and the
 * engine ends every session the account held, so the operator has to be told
 * the user is signed out everywhere and not only that the write landed.
 *
 * The policy is judged by the engine, which answers 422 with the reason in
 * its error field. Nothing here restates the rules: a length or complexity
 * check kept in two places is how the two drift apart.
 *
 * The engine removes the account's passkeys unless `removePasskeys` is false,
 * so a passkey someone added from a stolen session stops signing in. The
 * choice is always sent, and the answer counts what was removed.
 */
export function setUserPassword(
	id: string,
	password: string,
	client: HttpClient,
	removePasskeys = true
): Promise<User & { passkeys_removed?: number }> {
	return client.put<User & { passkeys_removed?: number }>(`/api/admin/users/${encodeURIComponent(id)}/password`, {
		password,
		remove_passkeys: removePasskeys,
	});
}

/** The sentence for the passkeys a password change removed, or empty when it removed none. */
export function passkeysRemovedText(count: number | undefined): string {
	if (!count) return '';
	return `${count} ${plural(count, 'passkey was', 'passkeys were')} removed.`;
}

/** The longest password the engine's default hasher reads, in UTF-8 bytes. */
export const MAX_PASSWORD_BYTES = 72;

/** A password's length as the engine counts it, in UTF-8 bytes. */
function passwordBytes(password: string): number {
	return new TextEncoder().encode(password).length;
}

/**
 * The sentence for a password the hasher cannot hold, or null when it fits.
 * The engine fails such a password with a 500 rather than naming the rule, so
 * every form that sets one checks it before sending.
 */
export function passwordTooLong(password: string): string | null {
	if (passwordBytes(password) <= MAX_PASSWORD_BYTES) return null;
	return `Use at most ${MAX_PASSWORD_BYTES} bytes. A plain letter or digit is one byte, and an accented letter or symbol takes two to four.`;
}

