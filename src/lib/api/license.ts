/**
 * What the license module serves about itself beside the entitlements.
 *
 * A build that links a license module answers GET /api/admin/license to every
 * signed-in role: the places it sends an operator, each named by a relation
 * and carrying the words to show, and whether this console may renew the
 * license. A build without one answers 404, and the console shows none of it.
 *
 * The module chooses every URL and every word. The admin places a link by its
 * relation, shows its label as given, and follows only an https URL or a path
 * on this console.
 */
import type { HttpClient } from '@lyeve-labs/client';
import { linkHref } from '#lib/links.ts';

export const LICENSE_URL = '/api/admin/license';

/** The relations the admin places a link by. A link with any other is left out. */
export const REL = {
	/** Where a feature this instance does not serve is turned on. */
	upgrade: 'upgrade',
	/** Where a license is obtained. */
	purchase: 'purchase',
	/** Where the license holder manages it. */
	portal: 'portal',
	/** Where an operator asks for help. */
	support: 'support',
	/** Where the license, and how it is verified, is documented. */
	documentation: 'docs',
} as const;

export type Rel = (typeof REL)[keyof typeof REL];

const RELS: ReadonlySet<string> = new Set(Object.values(REL));

/** One place the license module sends an operator. */
export interface LicenseLink {
	rel: Rel;
	/** The words to show, as the module sent them. */
	label: string;
	/** An https URL, or a path on this console. */
	href: string;
}

/** What the license module serves beside the entitlements. */
export interface Licensing {
	/** Every link that can be shown, one per relation, in the order the module sent them. */
	links: LicenseLink[];
	/** Whether the renewal route takes a new license from this console. */
	renew: boolean;
}

/** What a build without a license module serves, and what an unreadable answer comes to. */
export const NO_LICENSING: Licensing = { links: [], renew: false };

/**
 * Reads what the license module serves. It never throws: a 404 from a build
 * without a module and a failed read both come to no links and no renewal,
 * because either way the console has nothing it could offer.
 */
export async function readLicensing(client: HttpClient): Promise<Licensing> {
	try {
		return licensingOf(await client.get<unknown>(LICENSE_URL));
	} catch {
		return NO_LICENSING;
	}
}

/**
 * The answer as far as it can be shown. A link stays when its relation is
 * one the admin places, it carries words, and its URL is safe to follow. The
 * first link for a relation wins.
 */
export function licensingOf(body: unknown): Licensing {
	const raw = (body ?? {}) as { links?: unknown; renew?: unknown };
	const links: LicenseLink[] = [];
	for (const item of Array.isArray(raw.links) ? raw.links : []) {
		const { rel, label, url } = (item ?? {}) as { rel?: unknown; label?: unknown; url?: unknown };
		if (typeof rel !== 'string' || !RELS.has(rel) || links.some((l) => l.rel === rel)) continue;
		const words = typeof label === 'string' ? label.trim() : '';
		const href = typeof url === 'string' ? linkHref(url) : null;
		if (words && href) links.push({ rel: rel as Rel, label: words, href });
	}
	return { links, renew: raw.renew === true };
}

/** The link for one relation, or null when the module serves none. */
export function linkOf(licensing: Licensing | null | undefined, rel: Rel): LicenseLink | null {
	return licensing?.links.find((l) => l.rel === rel) ?? null;
}
