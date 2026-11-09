import { redirect, fail } from '@sveltejs/kit';
import { authedClient, sessionUser } from '$lib/server/authz';
import type { PageServerLoad, Actions } from './$types';
import { createClient, ApiError } from '@lyeve-labs/client';
import { mfaVerify, isMFAChallenge, type LoginResponse } from '@lyeve-labs/client-rest';
import { checkRateLimit } from '$lib/server/rate-limit';
import { clientAddressOf } from '$lib/server/engine';
import { secondFactorFailure } from '$lib/server/second-factor';
import { clearSessionCookie, setRefreshCookie, setSessionCookie, sessionToken } from '$lib/server/session-cookie';
import { adminReturnPath } from '$lib/server/local-path';
import { LANDING } from '$lib/landing';
import { challengeFrom } from '$lib/captcha';
import { organizationFromUrl } from '$lib/organization';
import { askedOrganization, asksOrganization } from '$lib/server/sign-in-organization';
import { outageFor } from '$lib/outage';

const SIGN_IN_UNAVAILABLE = outageFor('you cannot sign in yet');

/**
 * The page a sign-in returns to: the `next` query when it is an admin page,
 * and the dashboard otherwise.
 */
function returnTo(url: URL | undefined): string {
	return adminReturnPath(url?.searchParams.get('next'), LANDING);
}

/**
 * Enabled provider names from one of the public sign-in routes.
 *
 * Both routes answer a bare array of objects carrying a name and nothing else,
 * because the login page is unauthenticated and a provider list is the most it
 * may learn. Anything other than a 200 is treated as "no providers": the
 * engine may refuse, and a login form that failed because a provider route
 * refused would lock out the password path as well.
 */
async function providerNames(
	fetch: typeof globalThis.fetch,
	url: string
): Promise<string[]> {
	try {
		const res = await fetch(url);
		if (!res.ok) return [];
		const data = (await res.json()) as { name?: string }[] | null;
		return (data ?? []).map((p) => p.name).filter((n): n is string => !!n);
	} catch {
		// The engine may not be up yet. The password form still has to render.
		return [];
	}
}

/**
 * Whether a plugin's public sign-in route is mounted, for an engine that keeps
 * no list of them. The recovery routes take POST only, so a GET answers 405
 * while the plugin runs and 404 when it does not, and asks the plugin for
 * nothing. Only a definite 404 hides the link: any other answer, or none,
 * leaves it, because the form reports a refusal anyway.
 */
async function routeMounted(fetch: typeof globalThis.fetch, url: string): Promise<boolean> {
	try {
		return (await fetch(url)).status !== 404;
	} catch {
		return true;
	}
}

/**
 * The public sign-in routes the engine's plugins mounted, as `METHOD path`, or
 * null when this engine keeps no such list. The engine counts every refused
 * request as a failed one, so asking each route with a request it refuses made
 * each visit to this page read as failures on the dashboard.
 */
async function signInRoutes(fetch: typeof globalThis.fetch): Promise<Set<string> | null> {
	try {
		const res = await fetch('/api/admin/auth/sign-in-routes');
		if (!res.ok) return null;
		const body = (await res.json()) as { routes?: { method?: string; path?: string }[] } | null;
		if (!Array.isArray(body?.routes)) return null;
		return new Set(body.routes.map((r) => `${r.method} ${r.path}`));
	} catch {
		return null;
	}
}

export const load: PageServerLoad = async (event) => {
	const { fetch, cookies } = event;

	// Already logged in, or only holding a cookie that says so? A session the
	// engine has revoked or expired still looks like one from here, and sending
	// its holder to /admin means bouncing straight back, forever. Ask the engine
	// before trusting it, and drop what it rejects so the form renders. An
	// engine that cannot answer has rejected nothing, so the cookie stays and
	// the reader sees the outage page.
	const token = sessionToken(event);
	if (token) {
		const user = await sessionUser(authedClient(event));
		if (user) {
			redirect(302, returnTo(event.url));
		}
		clearSessionCookie(event);
	}

	// Sign-in buttons come from the plugins' own public routes. Either may
	// refuse, so a non-ok response means no button and never an error on the
	// form: somebody with a password must still be able to get in when SSO is
	// unavailable.
	// A route the engine's list leaves out is not asked at all.
	const mounted = await signInRoutes(fetch);
	const providers = (url: string) => (!mounted || mounted.has(`GET ${url}`) ? providerNames(fetch, url) : []);
	const recovery = (url: string) => (mounted ? mounted.has(`POST ${url}`) : routeMounted(fetch, url));
	const [oauthProviders, samlProviders, passwordReset, magicLink] = await Promise.all([
		providers('/api/admin/auth/oauth-providers'),
		providers('/api/admin/auth/saml-providers'),
		recovery('/api/admin/auth/password-reset/request'),
		recovery('/api/admin/auth/magic-link/request'),
	]);

	// A link that names the organization fills the field in, and the reader can
	// change or clear it. A console that does not ask for one carries none on.
	const organization = asksOrganization();
	return {
		oauthProviders,
		samlProviders,
		passwordReset,
		magicLink,
		ended: event.url?.searchParams.has('ended') === true,
		organization,
		carried: organization ? organizationFromUrl(event.url) : '',
	};
};

export const actions: Actions = {
	default: async (event) => {
		const { request, fetch, cookies } = event;

		// Rate limit login attempts per IP to deter credential stuffing.
		const ip = clientAddressOf(event);
		const limit = checkRateLimit(ip);
		if (!limit.allowed) {
			return fail(429, { error: 'Too many attempts. Try again later.', retryAfterSec: limit.retryAfterSec });
		}

		const form = await request.formData();
		const challengeToken = form.get('challenge_token') as string | null;

		// A challenge token means the password was already accepted, so only the code is checked.
		if (challengeToken) {
			const code = form.get('code') as string;
			if (!code) return { error: 'Enter the verification code.', mfa_required: true, challenge_token: challengeToken };
			try {
				const res: { token: string; refresh_token?: string } = await mfaVerify(challengeToken, code, createClient(fetch));
				setSessionCookie(event, res.token);
				setRefreshCookie(event, res.refresh_token);
			} catch (e) {
				const failed = secondFactorFailure(e);
				if (failed.restart) return fail(failed.status, { error: failed.error });
				return fail(failed.status, { error: failed.error, mfa_required: true, challenge_token: challengeToken });
			}
			redirect(302, returnTo(event.url));
		}

		const email = form.get('email') as string;
		const password = form.get('password') as string;

		const typed = String(form.get('tenant') ?? '').trim();
		if (!email || !password) {
			return { error: 'Enter your email and password.', tenant: typed };
		}
		// Only the shape is checked. Whether the organization exists is never
		// asked, and a wrong one is refused by the engine exactly as a wrong
		// password is.
		const organization = askedOrganization(form);
		if (!organization.ok) return fail(400, { error: organization.error, tenant: typed });

		// The captcha plugin reads the token from the login body itself, so it
		// travels beside the credentials rather than in a header. Absent until
		// the engine has asked for a challenge.
		const captchaToken = String(form.get('captcha_token') ?? '').trim();
		const body: Record<string, string> = { email, password };
		if (captchaToken) body.captcha_token = captchaToken;
		if (organization.value) body.tenant = organization.value;

		const client = createClient(fetch);
		try {
			const res = await client.post<LoginResponse & { refresh_token?: string }>('/api/admin/auth/login', body);
			if (isMFAChallenge(res)) {
				// Return challenge token to trigger TOTP step in the UI.
				return { mfa_required: true, challenge_token: res.challenge_token };
			}
			setSessionCookie(event, res.token);
			setRefreshCookie(event, res.refresh_token);
		} catch (e) {
			// Only a rejected credential should read as a rejected credential.
			// The engine rate-limits this endpoint at 5 attempts, and reporting
			// that as a bad password sends people to reset a password that was
			// never wrong. A 5xx reported the same way hides an outage, and so
			// does an engine that never answered.
			if (e instanceof ApiError) {
				// After repeated failures the engine asks for a challenge. A 400
				// carrying it means the token was missing or refused. A 401
				// carrying it means the password was wrong and the next attempt
				// has to pass the check as well. Either way the form has to show
				// the widget, or the user stays locked out for the whole window.
				const captcha = challengeFrom(e.body);
				if (captcha) {
					return fail(e.status === 401 ? 401 : 400, {
						error:
							e.status === 401
								? 'Incorrect email or password. Complete the security check to try again.'
								: 'Complete the security check to sign in.',
						captcha,
						email,
						tenant: typed,
					});
				}
				if (e.status === 429) {
					return fail(429, { error: 'Too many attempts. Try again in a moment.' });
				}
				if (e.status >= 500) {
					return fail(e.status, { error: SIGN_IN_UNAVAILABLE });
				}
			} else {
				return fail(503, { error: SIGN_IN_UNAVAILABLE });
			}
			return { error: 'Incorrect email or password.', tenant: typed };
		}

		redirect(302, returnTo(event.url));
	},
};

