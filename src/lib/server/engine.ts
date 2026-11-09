import { createHash, createHmac } from 'node:crypto';
import type { RequestEvent } from '@sveltejs/kit';

/** Where every relative /api/ call made on the server goes, when it is set. */
const INTERNAL_URL = process.env.CORE_INTERNAL_URL;

/**
 * Where server-side code reaches the engine's admin listener. Without
 * CORE_INTERNAL_URL it falls back to where the dev server's proxy sends the
 * browser's /api/admin calls.
 */
export const ENGINE_URL = INTERNAL_URL || process.env.PROXY_ADMIN_TARGET || 'http://localhost:3001';

/**
 * Where the Content API answers, which is a different listener from the admin
 * one: the engine binds /api/admin on ADMIN_LISTEN_ADDR and everything under
 * /api/v1 on API_LISTEN_ADDR, and a deployment may put them on different hosts
 * entirely.
 *
 * The browser never needs this, because the proxy in front of a deployment
 * routes both from one origin and the dev server's proxy does the same. Server
 * code does: SvelteKit resolves a relative fetch against its own router first,
 * so a request for /api/v1/... made from an action answers 404 from this
 * application rather than reaching either listener.
 *
 * The fallback is for dev only. In a container it is this console's own
 * port, so a production server refuses to start without the variable (see
 * contentApiAddressProblem).
 */
export const CONTENT_API_URL =
	process.env.CORE_API_INTERNAL_URL || process.env.PROXY_API_TARGET || 'http://localhost:3002';

/** The port adapter-node listens on when PORT is unset. */
const ADAPTER_DEFAULT_PORT = '3000';

/**
 * Why CORE_API_INTERNAL_URL cannot reach the Content API, or null when it can.
 *
 * Unset, the console falls back to localhost:3002, which is the engine on a
 * developer's machine and this console itself in the official image, where
 * PORT is 3002. Every call then answers from this application and the API
 * reference reports its 404 as the engine's. The same holds for any loopback
 * or own-hostname address on the port this server listens on.
 *
 * An address that reaches this console through a proxy, such as its public
 * URL in front of an ingress that routes /api/v1, is not refused: the proxy
 * decides where it goes, and this server cannot see that.
 */
export function contentApiAddressProblem(
	env: Record<string, string | undefined>,
	ownHostname: string
): string | null {
	const raw = env.CORE_API_INTERNAL_URL?.trim();
	const remedy =
		'Set it to the base URL that serves the engine\'s /api/v1, which is usually the same ' +
		'proxy CORE_INTERNAL_URL names.';
	if (!raw) return `CORE_API_INTERNAL_URL is unset, so /api/v1 calls would reach this console. ${remedy}`;

	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return `CORE_API_INTERNAL_URL is not a URL: ${raw}. ${remedy}`;
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		return `CORE_API_INTERNAL_URL must be http or https, not ${url.protocol}. ${remedy}`;
	}

	const port = url.port || (url.protocol === 'https:' ? '443' : '80');
	const ownPort = env.PORT?.trim() || ADAPTER_DEFAULT_PORT;
	const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
	const self =
		host === 'localhost' ||
		host.endsWith('.localhost') ||
		host.startsWith('127.') ||
		host === '::1' ||
		host === '0.0.0.0' ||
		host === '::' ||
		host === ownHostname.toLowerCase() ||
		host === env.HOST?.trim().toLowerCase();
	if (self && port === ownPort) {
		return `CORE_API_INTERNAL_URL (${url.origin}) is this console, which listens on port ${ownPort}. ${remedy}`;
	}
	return null;
}

/**
 * The listener that serves a path.
 *
 * /api/admin is the admin one and everything else under /api is the content
 * one, which is the same split the dev proxy and the deployment proxy make.
 */
export function engineOriginFor(path: string): string {
	return path.startsWith('/api/admin') ? ENGINE_URL : CONTENT_API_URL;
}

/**
 * Where a relative /api/ call made on the server goes. CORE_INTERNAL_URL takes
 * every one, as the proxy in front of a deployment does. Without it each goes
 * to the listener that serves it, which is where the dev server's proxy sends
 * the same call from the browser. A relative call is never left to this
 * console: it has no route for the engine's paths, and a renewal sent to
 * itself would wait on itself.
 */
export function engineBaseFor(path: string): string {
	return INTERNAL_URL || engineOriginFor(path);
}

/**
 * The secret this console shares with the engine. Every request it makes on
 * a browser's behalf is signed with it and names the browser's address, so
 * the engine's login limiter and device risk count each user rather than
 * this server. Unset, nothing is signed and the engine sees this server.
 * ADMIN_CONSOLE_KEY is the old name, read when the new one is unset or empty.
 */
const CONSOLE_KEY = process.env.LYEVE_CONSOLE_KEY || process.env.ADMIN_CONSOLE_KEY || '';

export const CONSOLE_CLIENT_HEADER = 'x-lyeve-console-client';
export const CONSOLE_TIME_HEADER = 'x-lyeve-console-time';
export const CONSOLE_SIGNATURE_HEADER = 'x-lyeve-console-signature';
export const CONSOLE_HOST_HEADER = 'x-lyeve-console-host';
export const CONSOLE_HOST_SIGNATURE_HEADER = 'x-lyeve-console-host-signature';

/**
 * The signature the engine recomputes: the method, the decoded path, the raw
 * query, the address vouched for and a digest of the Authorization header, so
 * a captured signature cannot vouch for another address, route or session.
 * The path is signed decoded because the proxy in front of the engine may
 * re-escape characters this server sent raw.
 */
export function consoleSignature(
	key: string,
	unixTime: string,
	method: string,
	path: string,
	rawQuery: string,
	clientAddress: string,
	authorization: string
): string {
	const authDigest = createHash('sha256').update(authorization).digest('hex');
	return createHmac('sha256', key)
		.update(
			`lyeve-console-v1\n${unixTime}\n${method}\n${path}\n${rawQuery}\n${clientAddress}\n${authDigest}`
		)
		.digest('hex');
}

/**
 * The signature over the host the browser addressed. This server calls the
 * engine at an internal address, so the engine reads its own name in the
 * Host header and, on an instance with several tenants, resolves no tenant
 * for a page nobody has signed in to yet. The host travels beside the
 * request's signature and is bound to it, so it vouches for this one request
 * and nothing else. An engine that does not check it ignores both headers.
 */
export function consoleHostSignature(key: string, unixTime: string, requestSignature: string, host: string): string {
	return createHmac('sha256', key).update(`lyeve-console-host-v1\n${unixTime}\n${requestSignature}\n${host}`).digest('hex');
}

/** Who a request to the engine is for: the browser's address and the host it opened. */
export interface EngineCaller {
	address: string;
	host?: string;
}

/** The path as the engine reads it after decoding, which is what is signed. */
function decodedPath(pathname: string): string {
	try {
		return decodeURIComponent(pathname);
	} catch {
		return pathname;
	}
}

/**
 * Sign a request bound for the engine in place. Any console headers the
 * browser sent are dropped first, so a caller cannot choose the address or
 * the host the engine sees even when this console holds no key.
 */
export function signEngineRequest(
	headers: Headers,
	method: string,
	url: URL,
	caller: EngineCaller,
	key: string = CONSOLE_KEY,
	now: number = Date.now()
): void {
	headers.delete(CONSOLE_CLIENT_HEADER);
	headers.delete(CONSOLE_TIME_HEADER);
	headers.delete(CONSOLE_SIGNATURE_HEADER);
	headers.delete(CONSOLE_HOST_HEADER);
	headers.delete(CONSOLE_HOST_SIGNATURE_HEADER);
	if (!key || !caller.address) return;
	const unixTime = String(Math.floor(now / 1000));
	const signature = consoleSignature(
		key,
		unixTime,
		method.toUpperCase(),
		decodedPath(url.pathname),
		url.search.replace(/^\?/, ''),
		caller.address,
		headers.get('authorization') ?? ''
	);
	headers.set(CONSOLE_CLIENT_HEADER, caller.address);
	headers.set(CONSOLE_TIME_HEADER, unixTime);
	headers.set(CONSOLE_SIGNATURE_HEADER, signature);
	if (caller.host) {
		headers.set(CONSOLE_HOST_HEADER, caller.host);
		headers.set(CONSOLE_HOST_SIGNATURE_HEADER, consoleHostSignature(key, unixTime, signature, caller.host));
	}
}

/**
 * The caller behind event: the browser's address, and the host it opened this
 * console on. The host is what the engine resolves a tenant from before
 * sign-in. Behind a proxy the adapter reads it from the header its
 * HOST_HEADER names. An ORIGIN setting fixes it to one name, so every
 * signed-out page shows the brand and sign-in providers of whichever tenant
 * that name is mapped to, and the stock ones when it maps to none. An instance
 * that serves each tenant its admin on the tenant's own domain leaves ORIGIN
 * unset.
 */
export function callerOf(event: Pick<RequestEvent, 'getClientAddress'> & Partial<Pick<RequestEvent, 'url'>>): EngineCaller {
	return { address: clientAddressOf(event), host: event.url?.host || undefined };
}

/** The browser's address, or empty when the adapter cannot tell. */
export function clientAddressOf(event: Pick<RequestEvent, 'getClientAddress'>): string {
	try {
		return event.getClientAddress();
	} catch {
		return '';
	}
}

/**
 * Call the engine out of process with the session as a bearer, signed for
 * the browser behind event. The global fetch keeps the browser's cookies off
 * the call, which would otherwise flip the engine to cookie auth and its
 * double-submit CSRF check.
 */
export function engineFetch(
	event: Pick<RequestEvent, 'getClientAddress'> & Partial<Pick<RequestEvent, 'url'>>,
	path: string,
	init: RequestInit & { token: string }
): Promise<Response> {
	const { token, ...rest } = init;
	const url = new URL(path, ENGINE_URL);
	const headers = new Headers(rest.headers);
	headers.set('Authorization', `Bearer ${token}`);
	signEngineRequest(headers, rest.method ?? 'GET', url, callerOf(event));
	return fetch(url.href, { ...rest, headers });
}

/**
 * How long the engine has to answer the console's readiness probe. A probe
 * that waits on a stalled engine holds a connection for every check, and the
 * image's health check gives up at five seconds.
 */
export const ENGINE_READY_TIMEOUT_MS = 3000;
