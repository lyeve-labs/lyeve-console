/**
 * What a page makes of a refused read, the same way for every page.
 *
 * A page never knows how its plugin is licensed, which role a route needs or
 * whether the database is up. It knows what the engine answered:
 *
 *   404  the route is not there: the plugin is not in this build, or does not
 *        serve it.
 *   402  the engine refused what this instance is not enabled for. A capacity
 *        refusal says `cap_exceeded` and carries the ceiling and the count, so
 *        a page never holds either number itself.
 *   403  the reader's role may not read it. Another role may.
 *   429  the engine refused for the request rate. It answered, so this is not
 *        an outage, and the same read succeeds once the window passes.
 *   503  the engine or its database did not answer. A 502 or a 504 is the
 *        same outage reported by a proxy in front of the engine, and so is a
 *        read that never reached the engine at all.
 *   else the read failed, and a failed read is never a report that there is
 *        nothing to show.
 */
import { isHttpError, isRedirect } from '@sveltejs/kit';
import { ApiError } from '@lyeve-labs/client';
import { count, str } from './narrow';
import { rolesInWords } from '$lib/roles';

export type Gate =
	| { state: 'ok' }
	| { state: 'absent' }
	/** Not enabled on this instance. The link is where it is turned on, when the engine names one. */
	| { state: 'locked'; upgradeUrl: string }
	/** At a capacity ceiling. Either number is null when the engine did not send it. */
	| { state: 'full'; limit: number | null; current: number | null; upgradeUrl: string }
	/** The reader's role may not read it, which no retry changes. */
	| { state: 'forbidden' }
	/** The engine refused for the request rate. The same read succeeds once the window passes. */
	| { state: 'busy' }
	/** The engine or its database did not answer. The same read may answer in a moment. */
	| { state: 'unavailable' }
	| { state: 'error'; message: string };

export const GATE_OK: Gate = { state: 'ok' };

/** What a 402 carries, as far as a page reads it. */
interface Refusal {
	error?: unknown;
	limit?: unknown;
	current?: unknown;
	upgrade_url?: unknown;
}

/**
 * Whether a read failed before any answer came back. fetch rejects with a
 * TypeError when it cannot reach the engine, and the client gives up with a
 * TimeoutError once the engine has taken too long. The name is read rather
 * than the class, because a DOMException can come from another realm.
 */
function unanswered(err: unknown): boolean {
	if (err instanceof TypeError) return true;
	return typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'TimeoutError';
}

/**
 * The statuses that say no working engine answered. The engine sends a 503
 * when its database does not answer. A proxy in front of it sends a 502 when
 * it cannot reach the engine and a 504 when it gave up waiting.
 */
const OUTAGE_STATUSES: ReadonlySet<number> = new Set([502, 503, 504]);

/** Whether a read failed because the engine or its database did not answer. */
export function isOutage(err: unknown): boolean {
	if (err instanceof ApiError) return OUTAGE_STATUSES.has(err.status);
	return unanswered(err);
}

/**
 * The gate for a read that threw. `failed` is what the page says when the
 * read failed, in words that never pass the failure off as an empty result.
 */
export function gateOf(err: unknown, failed: string): Gate {
	if (err instanceof ApiError) {
		if (err.status === 404) return { state: 'absent' };
		if (err.status === 402) {
			const body = (err.body ?? {}) as Refusal;
			const upgradeUrl = str(body.upgrade_url);
			if (body.error === 'cap_exceeded') {
				return { state: 'full', limit: count(body.limit), current: count(body.current), upgradeUrl };
			}
			return { state: 'locked', upgradeUrl };
		}
		if (err.status === 403) return { state: 'forbidden' };
		if (err.status === 429) return { state: 'busy' };
	}
	if (isOutage(err)) return { state: 'unavailable' };
	return { state: 'error', message: failed };
}

/**
 * One read as load data: the value it answered, or the gate that says why
 * there is none. A failure never becomes an empty value, so a page cannot draw
 * its first-run state for a read that did not answer.
 */
export type Section<T, G = Gate> = { ok: true; value: T } | { ok: false; gate: G };

/**
 * Await a read and keep its failure as a gate. A redirect or an HTTP error
 * thrown on purpose is not a failed read, so it still ends the load. A page
 * whose refusals mean more than `gateOf` knows passes its own mapper in
 * place of the sentence.
 */
export async function section<T>(read: Promise<T>, failed: string): Promise<Section<T>>;
export async function section<T, G>(read: Promise<T>, toGate: (err: unknown) => G): Promise<Section<T, G>>;
export async function section<T, G>(read: Promise<T>, failed: string | ((err: unknown) => G)): Promise<Section<T, G | Gate>> {
	try {
		return { ok: true, value: await read };
	} catch (err) {
		if (isRedirect(err) || isHttpError(err)) throw err;
		return { ok: false, gate: typeof failed === 'string' ? gateOf(err, failed) : failed(err) };
	}
}

/** The sentence a page shows for a gate at a ceiling. */
export function fullText(gate: Extract<Gate, { state: 'full' }>): string {
	// A limit can count inside one tenant or across the engine, and the gate
	// does not say which, so the sentence names neither.
	if (gate.limit !== null && gate.current !== null) {
		return `You're using ${gate.current} of ${gate.limit}.`;
	}
	if (gate.limit !== null) return `You can have up to ${gate.limit}.`;
	return "You've reached the limit.";
}

/**
 * A feature's title as it reads inside a sentence. A first word written with
 * only its first capital is lowered ("Public search"). One spelled with more
 * capitals than that is a name and keeps them ("API keys", "GraphQL schema").
 */
export function inSentence(title: string): string {
	const first = title.split(/\s/, 1)[0];
	if (first.length < 2 || first.slice(1) !== first.slice(1).toLowerCase()) return title;
	return title[0].toLowerCase() + title.slice(1);
}

/**
 * The sentence for a read the reader's role may not make. `what` names what
 * was refused, and `roles` the roles the check admits when the console made
 * the check. An engine refusal names no role, so it gets the sentence
 * without one.
 */
export function forbiddenText(what: string, roles?: readonly string[]): string {
	if (roles?.length) return `Only ${rolesInWords(roles)} can open ${what}.`;
	return `Your role cannot open ${what}. Ask a super admin if you need it.`;
}
