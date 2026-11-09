import { hostname } from 'node:os';
import { building, dev } from '$app/environment';
import { redirect, type Handle, type HandleFetch, type ServerInit } from '@sveltejs/kit';
import { addressHeaderProblem, cleanupRateLimitStore, WINDOW_MS } from '$lib/server/rate-limit';
import { setupGateRedirect } from '$lib/server/setup-gate';
import { limitBody } from '$lib/server/body-limit';
import {
	callerOf,
	contentApiAddressProblem,
	engineBaseFor,
	signEngineRequest
} from '$lib/server/engine';
import { relayEngineCookies } from '$lib/server/engine-cookies';
import { ensureCsrfCookie, sessionToken } from '$lib/server/session-cookie';
import { refreshSession } from '$lib/server/session-refresh';

// A production server that cannot reach the Content API refuses to start.
// The fallback address is this console's own port in the official image, so
// running on it would answer every /api/v1 call from this application and
// report the result as the engine's. One behind a proxy that hides the
// browser's address refuses too, because the sign-in limit would then lock
// out every visitor at once. A failed start names the variable.
export const init: ServerInit = () => {
	if (dev || building) return;
	const problem = contentApiAddressProblem(process.env, hostname()) ?? addressHeaderProblem(process.env);
	if (problem) throw new Error(problem);
};

// Expired rate-limit buckets are pruned on a timer, or the in-memory map
// grows with every client address, spoofed ones included.
setInterval(cleanupRateLimitStore, WINDOW_MS).unref();

// The Content-Security-Policy is configured in svelte.config.js (kit.csp), not
// with the headers below, so SvelteKit can attach nonces to its own inline
// hydration scripts. Setting script-src here would break it.
export const handle: Handle = async ({ event, resolve }) => {
	// Every page goes to the setup screen until the engine has an account:
	// while it is unreachable, in setup mode, or waiting for its first admin.
	// A request with a session passes an unreachable engine, so the page's own
	// session check shows the outage page instead.
	// This is the only setup check. A data request carries the page's own
	// path here, so client-side navigation is gated the same way.
	const signedIn = sessionToken(event) !== undefined;
	const target = await setupGateRedirect(event.url, event.fetch, Date.now(), signedIn);
	if (target) {
		redirect(303, target);
	}
	await refreshSession(event);
	// After the renewal, so a CSRF cookie the engine answered with it is kept.
	ensureCsrfCookie(event);
	// Before resolve, because SvelteKit runs a form action ahead of every
	// load, so no session check in a layout comes first.
	const refused = await limitBody(event);

	return withSecurityHeaders(refused ?? (await resolve(event)));
};

function setSecurityHeaders(headers: Headers): void {
	headers.set('X-Frame-Options', 'DENY');
	headers.set('X-Content-Type-Options', 'nosniff');
	headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
	headers.set('Cross-Origin-Opener-Policy', 'same-origin');
	// Nothing here is for an index: every screen is behind a session and the
	// login is not a page worth finding. robots.txt says the same to the
	// crawlers that ask first.
	headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
	// HSTS: force HTTPS in production. Gated. $app/environment dev is
	// true during local dev (http://localhost) where the header is harmful.
	if (!dev) {
		headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
	}
}

/**
 * The response with its security headers, or a copy that carries them. A
 * response passed through from fetch, or built by Response.redirect, has
 * immutable headers, and the first set throws before any header is written.
 */
function withSecurityHeaders(response: Response): Response {
	try {
		setSecurityHeaders(response.headers);
		return response;
	} catch {
		const copy = new Response(response.body, response);
		setSecurityHeaders(copy.headers);
		return copy;
	}
}

// Rewrite server-side relative /api/* requests to the engine, at the address
// engineBaseFor names, with or without CORE_INTERNAL_URL.
//
// Without this hook, SvelteKit's event.fetch resolves relative URLs inside
// its own router, and the request runs this app's handle again with the
// browser's cookies. A session renewal made that way waits on itself.
//
// Every call bound for the engine is signed for the browser behind event, so
// the engine counts that browser rather than this server. Only a relative call,
// which resolves against this app's own origin, is the engine's: an absolute
// URL elsewhere that happens to start with /api/ gets neither the rewrite nor
// the browser's address.
export const handleFetch: HandleFetch = async ({ request, fetch, event }) => {
	const parsed = new URL(request.url);
	if (parsed.origin !== event.url.origin || !parsed.pathname.startsWith('/api/')) {
		return fetch(request);
	}
	const target = new URL(parsed.pathname + parsed.search, engineBaseFor(parsed.pathname));
	const outbound = new Request(target, request);
	signEngineRequest(outbound.headers, outbound.method, target, callerOf(event));
	// The engine reads the browser from User-Agent: a sign-in's device and
	// risk score, a trusted device's name, the audit trail. Sent from here,
	// it would read this server's runtime for every person.
	const browser = event.request?.headers.get('user-agent');
	if (browser) outbound.headers.set('user-agent', browser);
	const response = await fetch(outbound);
	// A rewritten call leaves this app, so SvelteKit does not pass the
	// engine's cookies on to the browser. The CSRF pair has to arrive anyway.
	relayEngineCookies(response.headers, event.cookies);
	return response;
};
