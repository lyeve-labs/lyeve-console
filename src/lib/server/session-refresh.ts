/**
 * Keeps a console session alive past the engine's session token.
 *
 * The engine signs a session token that lives a few minutes and answers a
 * refresh token beside it on a password or second-factor sign-in. Before a
 * request reaches a load or an action, a session token with under two minutes
 * left is traded for a new pair and both cookies are rewritten. SvelteKit
 * reads a cookie set during a request back from that request, so every load
 * and action after this step sends the new token.
 *
 * The engine rotates the refresh token on every trade and reads a second use
 * of a rotated one as theft: it revokes the whole family, which signs the
 * person out. A page sends several requests at once, and the browser can send
 * one with the old cookies before it has stored the new ones. So one trade
 * runs per refresh token in this process, and for ten seconds its answer goes
 * to any request that carries the same refresh token and the same session
 * cookie. A request that carries the old refresh token with any other session
 * cookie, or none, goes to the engine, so a copied refresh token still trips
 * the engine's check.
 *
 * A sign-in through a provider or an emailed link answers no refresh token,
 * so those sessions still end when their token does.
 */
import { createHash } from 'node:crypto';
import { redirect, type RequestEvent } from '@sveltejs/kit';
import { clientAddressOf } from '$lib/server/engine';
import {
	clearRefreshCookie,
	clearSessionCookie,
	refreshToken,
	sessionToken,
	setRefreshCookie,
	setSessionCookie,
	type SessionRead,
} from '$lib/server/session-cookie';

/** How long before its expiry a session token is traded. */
const AHEAD_MS = 2 * 60 * 1000;
/**
 * How long a trade's answer is served to requests that carry the old cookies.
 * It only has to cover the requests a browser sent before it stored the new
 * ones: a server render, and a preload or two.
 */
const KEEP_MS = 10 * 1000;
/** The most answers kept at once. The oldest go first. */
const KEPT_MAX = 10_000;

/** The engine's route that trades a refresh token for a new pair. */
const REFRESH_PATH = '/api/admin/auth/refresh';

/** Where the sign-in page says the session ended. */
export const SESSION_ENDED_PATH = '/login?ended=1';

export type Trade =
	| { kind: 'renewed'; token: string; refreshToken: string }
	| { kind: 'refused' }
	| { kind: 'unavailable' };

/**
 * The engine's refresh token: a UUID naming the family, a dot, and 32 random
 * bytes in unpadded base64url. Anything else is refused here, so a forged
 * cookie never costs a call to the engine.
 */
const REFRESH_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/i;

/** Both maps are keyed by a digest of the refresh token, so a long forged cookie costs no more than a real one. */
interface Shared {
	/** A digest of the session cookie the trade was started with. */
	session: string;
}
const running = new Map<string, Shared & { trade: Promise<Trade> }>();
const kept = new Map<string, Shared & { trade: Trade; until: number }>();

/**
 * How many refreshes the engine may refuse for one address in a minute before
 * that address stops asking. Only a refusal counts: a renewal is what every
 * signed-in reader does, and a shared address such as an office network
 * renews often. A stream of copied or stale refresh tokens is refused, so it
 * runs out here, and the engine's own limit for this console stays for the
 * readers.
 */
const REFUSALS_MAX = 10;
const REFUSALS_WINDOW_MS = 60 * 1000;
/** The most addresses counted at once. The oldest go first. */
const ADDRESSES_MAX = 10_000;
const refusals = new Map<string, { count: number; resetAt: number }>();

function refusedTooOften(address: string, now = Date.now()): boolean {
	const bucket = refusals.get(address);
	return !!bucket && bucket.resetAt > now && bucket.count >= REFUSALS_MAX;
}

/**
 * Counts a trade against its address as it starts. The caller gives the count
 * back unless the engine refuses the trade, so a renewal ends up uncounted, and
 * a burst sent all at once is held back before any refusal has come back.
 */
function countRefusal(address: string, now = Date.now()): { count: number } {
	const bucket = refusals.get(address);
	if (bucket && bucket.resetAt > now) {
		bucket.count++;
		return bucket;
	}
	refusals.delete(address);
	for (const [old, entry] of refusals) {
		if (entry.resetAt > now && refusals.size < ADDRESSES_MAX) break;
		refusals.delete(old);
	}
	const fresh = { count: 1, resetAt: now + REFUSALS_WINDOW_MS };
	refusals.set(address, fresh);
	return fresh;
}

const digest = (value: string) => createHash('sha256').update(value).digest('hex');

/**
 * The token's claims, read without checking its signature. The engine checks
 * it on every call, so this only decides when to ask for a new one.
 */
function claims(token: string): { exp?: unknown; sub?: unknown; tenant_id?: unknown } | null {
	const payload = token.split('.')[1];
	if (!payload) return null;
	try {
		const parsed: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
		return parsed && typeof parsed === 'object' ? parsed : null;
	} catch {
		return null;
	}
}

/**
 * The tenant the session token names, which is the tenant the engine resolves
 * for the session's requests, or null when it names none. The claim is read
 * without its signature, so it may only choose what a page says or offers.
 * The engine checks the token and enforces the tenant on every call.
 */
export function sessionTenant(event: SessionRead): string | null {
	const token = sessionToken(event);
	const tenant = token ? claims(token)?.tenant_id : undefined;
	return typeof tenant === 'string' && tenant ? tenant : null;
}

/** Whether the token has expired or has under two minutes left. A token with no readable expiry is left to the engine. */
export function needsRefresh(token: string, now = Date.now()): boolean {
	const exp = claims(token)?.exp;
	return typeof exp === 'number' && exp * 1000 - now < AHEAD_MS;
}

async function trade(refresh: string, fetch: typeof globalThis.fetch): Promise<Trade> {
	let res: Response;
	try {
		res = await fetch(REFRESH_PATH, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ refresh_token: refresh }),
		});
	} catch {
		return { kind: 'unavailable' };
	}
	// Only a 401 says the family is over: revoked by a sign-out, a password
	// set or a disable, or past its own lifetime. A 503 is the engine asking
	// to be asked again, and a 429 is the rate limit.
	if (res.status === 401) return { kind: 'refused' };
	if (!res.ok) return { kind: 'unavailable' };
	const body = (await res.json().catch(() => null)) as { token?: unknown; refresh_token?: unknown } | null;
	if (typeof body?.token !== 'string' || typeof body.refresh_token !== 'string') return { kind: 'unavailable' };
	return { kind: 'renewed', token: body.token, refreshToken: body.refresh_token };
}

function keep(key: string, session: string, result: Trade): void {
	const now = Date.now();
	for (const [old, entry] of kept) {
		if (entry.until > now && kept.size < KEPT_MAX) break;
		kept.delete(old);
	}
	kept.set(key, { session, trade: result, until: now + KEEP_MS });
}

/**
 * The answer for this refresh token: a kept one or the trade already running,
 * when it was started with the same session cookie, or else a new trade. An
 * address the engine has refused too often in the last minute is not let
 * through to it, and the answer reads as an outage, so the cookies stay. An
 * outage is not kept, so the next request asks again.
 */
export function tradeOnce(
	refresh: string,
	session: string | undefined,
	address: string,
	fetch: typeof globalThis.fetch
): Promise<Trade> {
	const key = digest(refresh);
	const mark = session ? digest(session) : null;
	const hit = kept.get(key);
	if (hit && mark === hit.session && hit.until > Date.now()) return Promise.resolve(hit.trade);
	const inFlight = running.get(key);
	if (inFlight && mark === inFlight.session) return inFlight.trade;
	if (refusedTooOften(address)) return Promise.resolve({ kind: 'unavailable' });
	const counted = countRefusal(address);

	const started = trade(refresh, fetch).then((result) => {
		if (running.get(key)?.trade === started) running.delete(key);
		if (result.kind !== 'refused') counted.count--;
		if (result.kind !== 'unavailable' && mark) keep(key, mark, result);
		return result;
	});
	if (mark) running.set(key, { session: mark, trade: started });
	return started;
}

/** Where a request whose session ended goes, so the reader comes back to the same page. */
export function sessionEndedTarget(url: URL, method: string): string {
	// A form action's address names the action. Sending the reader back there
	// after sign-in would show the page, not repeat the write, so only the
	// path goes along.
	const back = method === 'GET' ? url.pathname + url.search : url.pathname;
	return `${SESSION_ENDED_PATH}&next=${encodeURIComponent(back)}`;
}

/**
 * Renews the session when its token is close to expiry. An engine that refused
 * the refresh token ends the session, and an admin page then goes to the
 * sign-in page, which says so. An engine that did not answer changes nothing:
 * the request goes on with the cookies it brought, and the outage shows the
 * way it shows on any page.
 */
export async function refreshSession(event: RequestEvent): Promise<void> {
	// A request this console made to itself carries cookies its parent already
	// renewed, and the renewal's own call arriving here is the trade in flight.
	// Either one waiting on a renewal would wait on itself and never answer.
	if (event.isSubRequest || event.url.pathname === REFRESH_PATH) return;
	const refresh = refreshToken(event);
	if (!refresh) return;
	const current = sessionToken(event);
	if (current && !needsRefresh(current)) return;
	if (!REFRESH_SHAPE.test(refresh)) {
		clearRefreshCookie(event);
		return;
	}

	const result = await tradeOnce(refresh, current, clientAddressOf(event), event.fetch);
	if (result.kind === 'unavailable') return;
	if (result.kind === 'renewed') {
		// A session cookie written by a later sign-in for another account wins
		// over a refresh token left from the earlier one.
		if (current && claims(current)?.sub !== claims(result.token)?.sub) {
			clearRefreshCookie(event);
			return;
		}
		setSessionCookie(event, result.token);
		setRefreshCookie(event, result.refreshToken);
		return;
	}
	clearSessionCookie(event);
	clearRefreshCookie(event);
	if (event.url.pathname === '/admin' || event.url.pathname.startsWith('/admin/')) {
		redirect(303, sessionEndedTarget(event.url, event.request.method));
	}
}
