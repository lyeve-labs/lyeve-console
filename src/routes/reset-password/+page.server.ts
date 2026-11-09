import { fail } from '@sveltejs/kit';
import { ApiError, createClient } from '@lyeve-labs/client';
import { confirmPasswordReset, RESET_MIN_PASSWORD_LENGTH } from '$lib/api/password-reset';
import { passwordTooLong } from '$lib/api/users';
import { actionFailure } from '$lib/server/action-error';
import { recoveryRefusal } from '$lib/server/recovery';
import { checkRateLimit } from '$lib/server/rate-limit';
import { organizationFromUrl } from '$lib/organization';
import { asksOrganization } from '$lib/server/sign-in-organization';
import { checked } from '$lib/checkbox';
import type { Actions, PageServerLoad } from './$types';

const EXPIRED = 'This reset link no longer works. Request a new one.';

function apiCode(e: ApiError): string {
	const body = e.body as { code?: unknown } | undefined;
	return typeof body?.code === 'string' ? body.code : '';
}

// The token is read here and only spent by the submit, so a mail scanner that
// opens the link leaves it usable. The token already names the account, so
// this page never asks for an organization. While the console asks for one,
// one the link carries goes on to the sign-in and new-link pages, so they do
// not ask either.
export const load: PageServerLoad = ({ url }) => {
	return {
		token: url.searchParams.get('token') ?? '',
		minLength: RESET_MIN_PASSWORD_LENGTH,
		carried: asksOrganization() ? organizationFromUrl(url) : '',
	};
};

export const actions: Actions = {
	default: async (event) => {
		const limit = checkRateLimit(event.getClientAddress());
		if (!limit.allowed) return fail(429, { error: 'Too many attempts. Try again later.' });

		const form = await event.request.formData();
		const token = String(form.get('token') ?? '').trim();
		const password = String(form.get('password') ?? '');
		const confirm = String(form.get('confirm') ?? '');
		// A checkbox posts nothing when it is cleared, so absent means keep.
		const removePasskeys = checked(form, 'remove_passkeys');

		if (!token) return fail(400, { error: EXPIRED, expired: true });
		if (password.length < RESET_MIN_PASSWORD_LENGTH) {
			return fail(400, { error: `Use at least ${RESET_MIN_PASSWORD_LENGTH} characters.` });
		}
		// Checked here because the engine spends the link before it hashes the
		// password, so a refusal there would cost the reader the link.
		const tooLong = passwordTooLong(password);
		if (tooLong) return fail(400, { error: tooLong });
		if (password !== confirm) return fail(400, { error: 'The passwords do not match.' });

		let removed: number;
		try {
			removed = (await confirmPasswordReset(createClient(event.fetch), token, password, removePasskeys)).passkeys_removed ?? 0;
		} catch (e) {
			const refused = recoveryRefusal(e, 'Password reset');
			if (refused) return fail(refused.status, { error: refused.error });
			// A 422 with an engine code is the engine's password policy, which
			// refuses before the token is claimed. The link still works, so the
			// form stays and shows the engine's sentence. A spent, expired or
			// unknown token answers 400.
			if (e instanceof ApiError && e.status === 422 && apiCode(e)) {
				const failed = actionFailure(e, 'Choose a different password.', 422);
				return fail(failed.status, failed.data);
			}
			return fail(400, { error: EXPIRED, expired: true });
		}
		return { done: true, passkeysRemoved: removed };
	},
};
