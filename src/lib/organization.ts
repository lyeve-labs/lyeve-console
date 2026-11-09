/**
 * The organization a signed-out form may name, sent to the engine as `tenant`.
 *
 * An account that an organization's identity provider created belongs to that
 * organization alone, and its address can repeat in another one. When the
 * address this console is reached on does not already say which organization
 * it serves, signing such an account in by password, resetting its password or
 * emailing it a sign-in link needs the organization named.
 *
 * The engine checks only the shape of the name and answers the same whether
 * or not the organization exists. So the console checks the shape too and
 * nothing more: a form that refused an unknown organization would tell anyone
 * which ones exist.
 */

/** The one spelling of an organization the engine reads. Anything else names none. */
const SHAPE = /^[a-z][a-z0-9_]{0,62}$/;

/** What the field says under itself on every signed-out form. */
export const ORGANIZATION_HINT =
	"Leave this empty unless your organization's identity provider created your account. Then enter the short name your administrator gave you.";

/** What the field says under itself when the link the reader followed filled it in. */
export const ORGANIZATION_FROM_LINK_HINT =
	'The link you followed filled this in. Change or clear it if it is not your organization.';

/** The refusal for a name the engine would not read. It says nothing about whether one exists. */
export const ORGANIZATION_SHAPE =
	'Enter the short name your administrator gave you: lower-case letters, digits and underscores, starting with a letter.';

export type Organization = { ok: true; value: string } | { ok: false; error: string };

/**
 * The organization a form names, or an empty value when it names none. Case
 * is folded, because a reader types "Acme" for the organization the engine
 * calls "acme".
 */
export function organizationFromForm(form: FormData): Organization {
	const raw = String(form.get('tenant') ?? '')
		.trim()
		.toLowerCase();
	if (raw === '') return { ok: true, value: '' };
	return SHAPE.test(raw) ? { ok: true, value: raw } : { ok: false, error: ORGANIZATION_SHAPE };
}

/**
 * The organization a link carries in its `tenant` query, or an empty string.
 * A link that carries one fills the field in, and the reader can change or clear it.
 */
export function organizationFromUrl(url: URL | undefined): string {
	const raw = url?.searchParams.get('tenant') ?? '';
	return SHAPE.test(raw) ? raw : '';
}

/** A signed-out page's path with the organization carried on, when there is one. */
export function withOrganization(path: string, organization: string): string {
	return organization ? `${path}?tenant=${encodeURIComponent(organization)}` : path;
}
