/**
 * What the two Builder connections routes share. It is a module of its own
 * because neither route file may import the other.
 */
import { ApiError } from '@lyeve-labs/client';
import { errorCodeOf } from '$lib/api/limits';

/** The roles that manage every connection of the tenant and its settings. */
export const OWNER_ROLES = ['admin', 'super_admin'];

/** Whether the person holds one of the owner roles. */
export function isOwner(roles: readonly string[] | undefined): boolean {
	return (roles ?? []).some((r) => OWNER_ROLES.includes(r));
}

/**
 * The sentence for a refusal outside the cases a page names. A 4xx that
 * carries the engine's code shows the engine's sentence. Anything else gets
 * the page's own, so no transport text reaches it.
 */
export function refusalSentence(err: unknown, fallback: string): string {
	if (err instanceof ApiError && err.status >= 400 && err.status < 500 && errorCodeOf(err) && err.message.trim()) {
		return err.message;
	}
	return fallback;
}
