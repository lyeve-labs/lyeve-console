import { fail, redirect } from '@sveltejs/kit';
import { ApiError, createClient } from '@lyeve-labs/client';
import { mfaVerify } from '@lyeve-labs/client-rest';
import { errorCodeOf } from '$lib/api/limits';
import { isMagicLinkMFAChallenge, verifyMagicLink } from '$lib/api/magic-link';
import { recoveryRefusal } from '$lib/server/recovery';
import { checkRateLimit } from '$lib/server/rate-limit';
import { secondFactorFailure } from '$lib/server/second-factor';
import { setRefreshCookie, setSessionCookie } from '$lib/server/session-cookie';
import { LANDING } from '$lib/landing';
import type { Actions, PageServerLoad } from './$types';

const EXPIRED = 'This sign-in link no longer works. Request a new one.';
const NO_EMAIL_SIGN_IN = 'You cannot sign in to this account with an emailed link. Sign in with your password instead.';

// Opening the link only shows a button. Redeeming spends the token, and a mail
// scanner that fetches every link in a message would spend it before the
// person ever clicked, so the redemption waits for a submit.
export const load: PageServerLoad = ({ url }) => {
	return { token: url.searchParams.get('token') ?? '' };
};

export const actions: Actions = {
	verify: async (event) => {
		const limit = checkRateLimit(event.getClientAddress());
		if (!limit.allowed) return fail(429, { error: 'Too many attempts. Try again later.' });

		const form = await event.request.formData();
		const token = String(form.get('token') ?? '').trim();
		if (!token) return fail(400, { error: EXPIRED });

		try {
			const res = await verifyMagicLink(createClient(event.fetch), token);
			if (isMagicLinkMFAChallenge(res)) {
				return { mfa_required: true, challenge_token: res.challenge_token };
			}
			setSessionCookie(event, res.access_token);
			setRefreshCookie(event, res.refresh_token);
		} catch (e) {
			const refused = recoveryRefusal(e, 'Email sign-in');
			if (refused) return fail(refused.status, { error: refused.error });
			// A 403 is a refusal of the account, not of the link: one with no
			// account in the link's tenant, or one that is disabled or expired.
			// The link is spent, and every new one ends the same way.
			if (e instanceof ApiError && e.status === 403 && errorCodeOf(e) === 'forbidden') {
				return fail(403, { error: NO_EMAIL_SIGN_IN, password: true });
			}
			return fail(400, { error: EXPIRED });
		}
		redirect(303, LANDING);
	},

	mfa: async (event) => {
		const limit = checkRateLimit(event.getClientAddress());
		if (!limit.allowed) return fail(429, { error: 'Too many attempts. Try again later.' });

		const form = await event.request.formData();
		const challengeToken = String(form.get('challenge_token') ?? '');
		const code = String(form.get('code') ?? '').trim();
		if (!challengeToken) return fail(400, { error: EXPIRED });
		if (!code) {
			return fail(400, { error: 'Enter the verification code.', mfa_required: true, challenge_token: challengeToken });
		}

		try {
			const res: { token: string; refresh_token?: string } = await mfaVerify(challengeToken, code, createClient(event.fetch));
			setSessionCookie(event, res.token);
			setRefreshCookie(event, res.refresh_token);
		} catch (e) {
			// The link was spent when the challenge was issued, so a new sign-in
			// starts from a new link.
			const failed = secondFactorFailure(e, 'request a new link to sign in again');
			if (failed.restart) return fail(failed.status, { error: failed.error });
			return fail(failed.status, { error: failed.error, mfa_required: true, challenge_token: challengeToken });
		}
		redirect(303, LANDING);
	},
};
