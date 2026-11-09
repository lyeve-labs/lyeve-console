import { redirect, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { createClient, ApiError } from '@lyeve-labs/client';
import { checkRateLimit } from '$lib/server/rate-limit';
import { claimSetup, getSetupModeStatus } from '$lib/api/setup';
import { passwordTooLong } from '$lib/api/users';
import { readEngineSetup, safeNext } from '$lib/server/setup-gate';
import { LANDING } from '$lib/landing';
import { setRefreshCookie, setSessionCookie } from '$lib/server/session-cookie';
import { actionFailure } from '$lib/server/action-error';

export const load: PageServerLoad = async ({ fetch, url }) => {
	const next = safeNext(url.searchParams.get('next'));
	const read = await readEngineSetup(fetch);
	if (read.state === 'ready') {
		redirect(303, next ?? '/login');
	}
	// A rate-limited engine cannot say where setup stands. The screen shows it
	// as not answering yet and polls until it does.
	const state = read.state === 'busy' ? 'unreachable' : read.state;
	return { state, tokenSource: read.tokenSource, next };
};

const TOKEN_REFUSED =
	'That setup token is wrong. Copy it again from the place shown under the field.';

const ENGINE_SILENT = 'Could not reach the engine. If you just restarted it, wait a moment and try again.';

function limited(ip: string) {
	const limit = checkRateLimit(ip);
	return limit.allowed
		? null
		: fail(429, { error: 'Too many attempts. Try again later.', retryAfterSec: limit.retryAfterSec });
}

export const actions: Actions = {
	// Reads what an engine in setup mode is missing. The generated secrets come
	// back on the first read only, so they live in this action's result and in
	// nothing the admin stores.
	status: async (event) => {
		const refused = limited(event.getClientAddress());
		if (refused) return refused;

		const form = await event.request.formData();
		const setupToken = String(form.get('setup_token') ?? '').trim();
		if (!setupToken) {
			return fail(400, { error: 'Enter the setup token.' });
		}
		try {
			const status = await getSetupModeStatus(setupToken, createClient(event.fetch));
			return { status };
		} catch (err) {
			if (err instanceof ApiError && err.status === 401) {
				return fail(401, { error: TOKEN_REFUSED });
			}
			if (err instanceof ApiError && err.status === 404) {
				// Not in setup mode any more: the engine restarted with its
				// settings. The next load shows the step that applies.
				return { status: null };
			}
			return fail(503, { error: ENGINE_SILENT });
		}
	},

	create: async (event) => {
		const { request, fetch } = event;

		// Setup is one-shot per instance, so repeated POSTs are almost
		// certainly abuse.
		const refused = limited(event.getClientAddress());
		if (refused) return refused;

		const form = await request.formData();
		const email = form.get('email') as string;
		const password = form.get('password') as string;
		const confirm = form.get('confirm') as string;
		const setupToken = String(form.get('setup_token') ?? '').trim();

		if (!setupToken) {
			return { error: 'Enter the setup token.' };
		}
		if (!email || !password) {
			return { error: 'Enter your email and password.' };
		}
		if (password !== confirm) {
			return { error: 'The passwords do not match.' };
		}
		// The engine's hasher reads 72 bytes at most and fails a longer password
		// with a 500 that names no rule, so the limit is checked here.
		const tooLong = passwordTooLong(password);
		if (tooLong) return fail(400, { error: tooLong, fields: { password: tooLong } });

		const client = createClient(fetch);
		try {
			const res: { token: string; refresh_token?: string } = await claimSetup({ email, password, setup_token: setupToken }, client);
			setSessionCookie(event, res.token);
			setRefreshCookie(event, res.refresh_token);
		} catch (err) {
			if (err instanceof ApiError && err.status === 401) {
				return fail(401, { error: TOKEN_REFUSED });
			}
			if (err instanceof ApiError && err.status === 409) {
				redirect(303, '/login');
			}
			// The password policy is the engine's and can be configured, so its
			// 422 names the rule. Repeating a length here would be wrong on any
			// install that changed it.
			if (err instanceof ApiError && err.status === 422) {
				const failed = actionFailure(err, 'This password does not meet the password policy.', 422);
				return fail(failed.status, failed.data);
			}
			// A 5xx or no answer at all says nothing about the form, so the
			// operator is told to wait rather than to change it. An account
			// created before the answer was lost shows on the retry: the engine
			// answers 409, and the branch above sends the operator to sign in.
			if (!(err instanceof ApiError) || err.status >= 500) {
				return fail(503, { error: ENGINE_SILENT });
			}
			return { error: 'Could not finish setup. Try again.' };
		}

		redirect(303, LANDING);
	},
};
