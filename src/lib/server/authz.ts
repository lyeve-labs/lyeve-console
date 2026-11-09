import { error, redirect, type RequestEvent } from '@sveltejs/kit';
import { ApiError, createClient, type HttpClient } from '@lyeve-labs/client';
import { getMe } from '@lyeve-labs/client-rest';
import type { SchemaField, User } from '@lyeve-labs/client';
import {
	CSRF_COOKIE,
	CSRF_COOKIE_INSECURE,
	clearSessionCookie,
	sessionToken,
	type SessionRead,
} from '$lib/server/session-cookie';
import { sessionEndedTarget } from '$lib/server/session-refresh';
import { refusalOf, refusalText } from '$lib/api/refusal';
import { BUSY, OUTAGE } from '$lib/outage';
import { SESSION_ENDED } from '$lib/session';
import { rolesInWords } from '$lib/roles';

/** The headers that carry the session, in lower case. Only `authedHeaders` sets them. */
const SESSION_HEADERS = new Set(['authorization', 'x-csrf-token']);

/**
 * The headers a server-side request to the engine has to carry.
 *
 * This is the one place they are assembled. `event.fetch` forwards the
 * browser's cookies on a same-origin subrequest, so the engine sees its own
 * session cookie, switches from Bearer auth to cookie auth, and applies the
 * double-submit CSRF check whatever Authorization header the call also set.
 * A write without `X-CSRF-Token` is refused 403 "csrf token required", from
 * the route the caller was aiming at, so it reads as that route refusing it.
 *
 * Every call site that builds its own request has to come through here,
 * because the omission is invisible at the call site.
 *
 * The token is set only when a cookie is found: an empty header fails the
 * check it exists to pass.
 */
export function authedHeaders(event: SessionRead): Record<string, string> {
	const token = sessionToken(event);
	if (!token) {
		error(401, 'Not authenticated');
	}
	const csrf = event.cookies.get(CSRF_COOKIE) ?? event.cookies.get(CSRF_COOKIE_INSECURE);
	return {
		Authorization: `Bearer ${token}`,
		...(csrf ? { 'X-CSRF-Token': csrf } : {}),
	};
}

/**
 * Build an API client authenticated as the current session. Every server load
 * and form action reads the engine through it. Throws 401 if no session cookie
 * is present.
 *
 * `extra` adds headers to every request, such as X-Tenant-ID for a super
 * admin acting in another tenant. It never sets the session's own headers.
 * Header names are case-insensitive, so an `authorization` in `extra` would
 * travel beside the session's bearer, and a CSRF header in `extra` would stand
 * in for the cookie's when there is none. Both are dropped in any spelling.
 */
export function authedClient(event: RequestEvent, extra: Record<string, string> = {}): HttpClient {
	const allowed = Object.entries(extra).filter(([name]) => !SESSION_HEADERS.has(name.toLowerCase()));
	const headers = { ...Object.fromEntries(allowed), ...authedHeaders(event) };
	return createClient(async (url, init) =>
		keepingSource(
			await event.fetch(url, {
				...init,
				headers: { ...init?.headers, ...headers },
			})
		)
	);
}

/**
 * The text each parsed response came from, so a reader that knows which
 * fields are integers can read them again without rounding. Keyed weakly, so
 * the text goes when the parsed value does.
 */
const sources = new WeakMap<object, string>();

/** A successful response parses as usual, and its text is kept beside the result. */
function keepingSource(res: Response): Response {
	if (!res.ok) return res;
	res.json = async () => {
		const text = await res.text();
		const value: unknown = JSON.parse(text);
		if (value !== null && typeof value === 'object') sources.set(value, text);
		return value;
	};
	return res;
}

/**
 * Keeps the digits of an integer JSON.parse would round. The reviver's third
 * argument carries each number's source text, so a plain whole number outside
 * the safe range comes back as that text. A fraction, an exponent form and a
 * number too large for a double come back as JSON.parse reads them.
 */
function keepIntegerDigits(_key: string, value: unknown, context?: { source?: string }): unknown {
	if (typeof value !== 'number' || Number.isSafeInteger(value)) return value;
	const source = context?.source;
	return source !== undefined && /^-?\d+$/.test(source) ? source : value;
}

/**
 * The response a value was parsed from, parsed again with every integer past
 * 2^53 kept as its digits. Undefined for a value no response produced.
 */
export function exactParse(value: unknown): unknown {
	if (value === null || typeof value !== 'object') return undefined;
	const text = sources.get(value);
	return text === undefined ? undefined : JSON.parse(text, keepIntegerDigits);
}

/**
 * `plain` with each integer field taken from `exact` where the exact read
 * kept digits a double would round. An integer field holds up to 19 digits
 * and a double 15 or 16, so a save of the plain value would write a rounded
 * number back. Only integer fields change: a json field holds whatever
 * numbers its author wrote, and they stay numbers.
 */
export function withExactIntegers(
	fields: readonly SchemaField[],
	plain: Record<string, unknown>,
	exact: unknown,
): Record<string, unknown> {
	if (exact === null || typeof exact !== 'object') return plain;
	const from = exact as Record<string, unknown>;
	let out = plain;
	for (const f of fields) {
		if (f.field_type !== 'integer' || typeof from[f.name] !== 'string') continue;
		if (out === plain) out = { ...plain };
		out[f.name] = from[f.name];
	}
	return out;
}

const NO_SEAT = 'This engine has no admin seat left for this account.';
const UNREACHABLE = 'Access to the admin is blocked for this account or network.';

/**
 * The sentence for a 402 on the session check. The engine answers one when it
 * admits an account from a trusted sign-in provider into an instance whose
 * admin seats are all taken, and the body carries the limit and the count. A
 * body that names neither a cap nor a capability gets the seat sentence,
 * because that is the 402 this check is known to meet.
 */
function sessionRefusal(e: ApiError): string {
	const refused = refusalOf(e);
	if (!refused || (refused.kind === 'feature' && !refused.feature)) return NO_SEAT;
	return refusalText(refused);
}

/**
 * The account a session belongs to, or null when the engine says the session
 * is over.
 *
 * Only a 401 says that. The engine answers 503 when its database cannot check
 * a session, so that an outage signs nobody out, and a console that read every
 * failure as a dead session would undo it: one database blip would send every
 * reader to the sign-in page. Three other answers are refusals rather than
 * outages, and each throws its own page: a 402 when no admin seat is left, a
 * 403 from an address rule or a firewall in front of the engine, and a 429 for
 * the request rate. Any other failure, an engine that did not answer included,
 * throws the outage page. None of them touches the cookie.
 */
export async function sessionUser(client: HttpClient): Promise<User | null> {
	try {
		return await getMe(client);
	} catch (e) {
		if (e instanceof ApiError) {
			if (e.status === 401) return null;
			if (e.status === 402) error(402, sessionRefusal(e));
			if (e.status === 403) error(403, UNREACHABLE);
			if (e.status === 429) error(429, BUSY.body);
		}
		error(503, OUTAGE.body);
	}
}

/*
 * The session check each request's loads have made, by request and token. The
 * shell's load and a page's load can each need the account within one
 * request, and each used to ask the engine again. A request asks once, and
 * the next request asks again, so a session the engine ended is refused on
 * the very next page. The token is part of the key because a request that
 * signs in or renews sets a new cookie partway through.
 *
 * An action never fills it. A write can end or demote the caller's own
 * session, such as a super admin setting their own password, and the page
 * that renders after the write in the same request has to see the account as
 * the engine holds it then, which may be no account at all.
 */
const sessionReads = new WeakMap<Request, { token: string; user: Promise<User | null> }>();

function loadSessionUser(event: RequestEvent): Promise<User | null> {
	const token = sessionToken(event);
	const held = event.request ? sessionReads.get(event.request) : undefined;
	if (held && held.token === token) return held.user;
	const user = sessionUser(authedClient(event));
	if (event.request && token) sessionReads.set(event.request, { token, user });
	return user;
}

/**
 * The session's account for a server load, read once per request.
 *
 * A page that wants only the account reads it here instead of awaiting the
 * shell's data. SvelteKit keeps the shell's data in the browser between admin
 * pages, so the server holds none of it on a client-side navigation, and a
 * load that awaits it makes the server run the whole shell again first.
 *
 * Without a session it sends the reader to sign in. When the engine says the
 * session is over it clears the cookie and sends the reader to sign in again.
 * A check the engine refused or could not answer throws its own page, and the
 * cookie outlives it.
 */
export async function loadUser(event: RequestEvent): Promise<User> {
	if (!sessionToken(event)) {
		redirect(302, '/login');
	}
	const user = await loadSessionUser(event);
	if (!user) {
		clearSessionCookie(event);
		// The address is read only here, on the way out, so a session that
		// stands does not make the load depend on it and re-run on every
		// navigation.
		redirect(302, sessionEndedTarget(event.url, event.request.method));
	}
	return user;
}

/**
 * Require a valid session. Returns the authenticated user, throws 401 when the
 * engine ended the session, and throws whatever page `sessionUser` throws when
 * the engine refused the check or could not answer it. Every call asks the
 * engine, because the write it guards may change the answer.
 */
export async function requireUser(event: RequestEvent): Promise<User> {
	const user = await sessionUser(authedClient(event));
	if (!user) {
		error(401, SESSION_ENDED);
	}
	return user;
}

/**
 * Require the session user to hold at least one of the given roles.
 * Throws 401 if unauthenticated, 403 if authenticated but unauthorized, and
 * the session check's own page if the engine refused it or could not answer.
 *
 * Defense-in-depth: the Go backend is the authoritative authorization
 * boundary. This guards the UI's server actions so privileged operations
 * cannot be driven by a direct POST from a lower-privileged session.
 */
export async function requireRole(event: RequestEvent, roles: string[]): Promise<User> {
	return assertRole(await requireUser(event), roles);
}

/**
 * Throw 403 unless the user holds at least one of the given roles. A load
 * takes the user from `loadUser` and checks it here.
 */
export function assertRole(user: User, roles: string[]): User {
	if (!roles.some((r) => user.roles.includes(r))) {
		error(403, `Only ${rolesInWords(roles)} can do this.`);
	}
	return user;
}

/**
 * Strip the columns the engine writes itself from a user-supplied content
 * payload, so a crafted form cannot set an entry's id, tenant, timestamps or
 * published state. The backend remains authoritative for per-field write
 * ACLs.
 *
 * Only those names are taken out, because the engine keeps each as a column
 * of its own and none can hold a user's field. _locale stays: the editor
 * sends it to name the language of the entry.
 */
const PROTECTED_FIELDS = new Set(['id', '_status', 'created_at', 'updated_at', 'deleted_at', 'tenant_id']);

export function stripProtectedFields(data: Record<string, unknown>): Record<string, unknown> {
	return Object.fromEntries(Object.entries(data).filter(([k]) => !PROTECTED_FIELDS.has(k)));
}
