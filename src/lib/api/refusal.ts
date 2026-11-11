/**
 * What a page makes of a write the engine refused for the license, the same
 * way for every page.
 *
 * The engine answers two kinds of 402, and the admin decides neither:
 *
 *   cap_exceeded      the caller may use the thing and already holds the most
 *                     this instance allows. The body carries the cap's name,
 *                     the ceiling and the count, so a page never holds either
 *                     number itself.
 *   payment_required  the request needs a capability this instance does not
 *                     carry. The body names the plugin and the feature.
 *
 * A refusal is plain data, so a form action can return it through `fail` and
 * the page renders it with `RefusalNotice`.
 */
import { ApiError } from '@lyeve-labs/client';
import { count, text } from './narrow';

/**
 * An optional ceiling on admin accounts that a licensing implementation may
 * state. The engine enforces it.
 */
export const ADMIN_SEATS_CAP = 'admin.seats';

/** Where an operator reads and changes what this instance is licensed for. */
export const LICENSE_PAGE = '/admin/settings/license';

/** The neutral locked state, which names no plan, license or capability. */
export const NOT_ENABLED = 'Not enabled on this engine';

/** The way forward from any limit, said first. */
export const LIFTS = 'A license that allows more lifts the limit.';

export type Refusal =
	| {
			kind: 'cap';
			/** The cap's name as the engine sent it, such as `example.items`. */
			cap: string;
			/** Either number is null when the engine did not send it. */
			limit: number | null;
			current: number | null;
			upgradeUrl: string;
	  }
	| {
			kind: 'feature';
			/** The capability's name, such as `example-feature`, or empty when the body named none. */
			feature: string;
			plugin: string;
			upgradeUrl: string;
	  };

interface Body {
	error?: unknown;
	cap?: unknown;
	limit?: unknown;
	current?: unknown;
	feature?: unknown;
	plugin?: unknown;
	upgrade_url?: unknown;
}

/**
 * The capability a payment_required body names. The engine sends a code,
 * `feature:` and the name with each dash as an underscore, and a license
 * carries the name, so the name is what the operator reads.
 */
export function featureName(code: string): string {
	const bare = code.startsWith('feature:') ? code.slice('feature:'.length) : code;
	return bare.replaceAll('_', '-');
}

/** The refusal a thrown request error carries, or null when it is not a 402. */
export function refusalOf(err: unknown): Refusal | null {
	if (!(err instanceof ApiError) || err.status !== 402) return null;
	const body = (err.body ?? {}) as Body;
	const upgradeUrl = text(body.upgrade_url);
	if (body.error === 'cap_exceeded') {
		return { kind: 'cap', cap: text(body.cap), limit: count(body.limit), current: count(body.current), upgradeUrl };
	}
	return { kind: 'feature', feature: featureName(text(body.feature)), plugin: text(body.plugin), upgradeUrl };
}

/**
 * The caps whose last segment alone would not name the thing the reader
 * manages on the screen that meets them.
 */
const CAP_NOUNS: Readonly<Record<string, string>> = {
	[ADMIN_SEATS_CAP]: 'admin seats',
	'ai.providers': 'AI providers',
	'mcp.agents': 'connected agents',
};

/**
 * What a cap counts, in the words of a sentence. The engine names a cap as
 * dotted segments ending in what it counts, so the last segment is the noun
 * and any cap renders without the admin knowing it in advance. A cap with no
 * usable segment reads as "items".
 */
export function capNoun(cap: string): string {
	const named = CAP_NOUNS[cap];
	if (named) return named;
	const last = cap.split('.').pop() ?? '';
	const noun = last.replace(/[_-]+/g, ' ').trim().replace(/\s+/g, ' ');
	return noun || 'items';
}

/** The heading for a refusal. */
export function refusalTitle(r: Refusal): string {
	if (r.kind === 'cap') {
		const noun = capNoun(r.cap);
		return `No more ${noun}`;
	}
	return NOT_ENABLED;
}

/**
 * The sentence for a refusal: "7 of 7 items are in use" for a cap, and the
 * neutral locked state for a feature, which names no capability. A cap says what happened, then the way
 * forward: a license that allows more, and only after it removing one. It
 * reads the same to an instance with no license and to one whose license
 * allows less than it needs.
 */
export function refusalText(r: Refusal): string {
	if (r.kind === 'cap') {
		const noun = capNoun(r.cap);
		if (r.cap === ADMIN_SEATS_CAP) {
			// Admin seats are counted across the engine, so this line names it.
			// The heading already names the seats, so the count stands alone.
			let held: string;
			if (r.limit !== null && r.current !== null) {
				held = `You're using ${r.current} of ${r.limit}, the most this engine allows.`;
			} else if (r.limit !== null) {
				held = `This engine allows at most ${r.limit} ${noun}.`;
			} else {
				held = `This engine is at its limit for ${noun}.`;
			}
			return `Every admin seat is taken. ${held} ${LIFTS} Removing the admin role from an account also frees a seat. Editors and viewers take no seat.`;
		}
		// Most limits count inside one tenant and some across the engine, and
		// the refusal does not say which, so the sentence names neither.
		let line: string;
		if (r.limit !== null && r.current !== null) {
			line = `You're using ${r.current} of ${r.limit} ${noun}.`;
		} else if (r.limit !== null) {
			line = `You can have up to ${r.limit} ${noun}.`;
		} else {
			line = `You've reached the limit for ${noun}.`;
		}
		return `${line} ${LIFTS} Removing one also makes room.`;
	}
	return 'This is not enabled on this engine. Nothing was changed.';
}

/**
 * The words for a link to where more is bought, read from what the link
 * opens: a plan, or an add-on the visitor's build holds. Null for a link
 * that says neither, such as a path on this console, and the caller uses
 * words of its own.
 */
export function upgradeLabel(href: string): string | null {
	let url: URL;
	try {
		url = new URL(href);
	} catch {
		return null;
	}
	const addOns = url.searchParams.get('skus');
	if (addOns) return addOns.includes(',') ? 'View the add-ons' : 'View the add-on';
	if (url.searchParams.get('plan')) return 'View the plan';
	return null;
}

/**
 * The words for a link out of a refusal: what the address opens, then the
 * label it was served with, then the step the refusal asks for. `raises` is
 * a refusal at a ceiling, where more is bought rather than turned on.
 */
export function upgradeWords(link: { href: string; label?: string }, raises = false): string {
	return upgradeLabel(link.href) ?? link.label ?? (raises ? 'How to raise the limit' : 'How to enable it');
}

/**
 * The refusal a form action returned, read from the page's `form` prop. The
 * key is `refused`, because the flow editor already returns a `refusal` of
 * its own shape.
 */
export function formRefusal(form: unknown): Refusal | null {
	if (!form || typeof form !== 'object' || !('refused' in form)) return null;
	const r = (form as { refused?: unknown }).refused;
	if (!r || typeof r !== 'object') return null;
	const kind = (r as { kind?: unknown }).kind;
	return kind === 'cap' || kind === 'feature' ? (r as Refusal) : null;
}
