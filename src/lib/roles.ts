/**
 * The roles an account or a key can hold, in one place, so the user picker
 * and the key picker offer the same four in the same order.
 *
 * The membership is the engine's. Its route guards name admin, editor and
 * super_admin, and every read route is open to any authenticated caller, which
 * is what viewer is: an account that reads and writes nothing. The engine
 * validates no list on the way in, so a role is whatever string is sent and
 * only this file keeps the two pickers offering the same four.
 */
import type { StatusTone } from '@lyeve-labs/ui-kit';

/**
 * Least privileged first. The order is a privilege ladder rather than an
 * accident of who wrote the list, and it puts the safe choice where a reader
 * lands rather than the one that grants everything.
 */
export const ROLES = ['viewer', 'editor', 'admin', 'super_admin'] as const;

export type Role = (typeof ROLES)[number];

/** A role as a sentence names it: "a super admin", "an editor". */
function roleInWords(role: string): string {
	const name = role.replaceAll('_', ' ');
	return `${/^[aeiou]/.test(name) ? 'an' : 'a'} ${name}`;
}

/**
 * The roles a check admits, as a refusal names them, least privileged first:
 * "an admin or a super admin". A role outside the four goes last.
 */
export function rolesInWords(roles: readonly string[]): string {
	const rank = (r: string) => ((ROLES as readonly string[]).includes(r) ? ROLES.indexOf(r as Role) : ROLES.length);
	const named = [...roles].sort((a, b) => rank(a) - rank(b)).map(roleInWords);
	return named.length < 2 ? (named[0] ?? '') : `${named.slice(0, -1).join(', ')} or ${named[named.length - 1]}`;
}

/** The same four as picker options. The value is the role the engine stores. */
export const ROLE_OPTIONS: { value: string; label: string }[] = ROLES.map((role) => ({
	value: role,
	label: role,
}));

/**
 * Badge tone for a role.
 *
 * One function for both pages, so a role reads the same on each. An unknown
 * role stays neutral rather than reading as a granted capability. A role is
 * a privilege, not a decoration, so it never takes the violet accent.
 */
export function roleTone(role: string): StatusTone {
	if (role === 'super_admin') return 'danger';
	if (role === 'admin') return 'warn';
	if (role === 'editor') return 'brand';
	return 'neutral';
}
