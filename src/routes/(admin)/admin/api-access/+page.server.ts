import type { Actions, PageServerLoad } from './$types';
import { fail } from '@sveltejs/kit';
import { authedClient, loadUser } from '#lib/server/authz.ts';
import { actionError } from '#lib/server/action-error.ts';

export const load: PageServerLoad = async (event) => {
	const user = await loadUser(event);
	return { user };
};

export const actions: Actions = {
	/**
	 * Issues a Bearer token the way an external app would get one: from an
	 * email and a password, with no session behind it. The call runs on the
	 * server, so a 5xx body never reaches the page as it was sent.
	 */
	// The request goes out through event.fetch, which forwards the session
	// cookie, so the engine applies its CSRF check and the token has to ride along.
	token: async (event) => {
		const form = await event.request.formData();
		const email = String(form.get('email') ?? '').trim();
		const password = String(form.get('password') ?? '');
		if (!email || !password) return fail(400, { tokenError: 'Enter the account email and password.' });
		try {
			const r = await authedClient(event).post<{ token: string }>('/api/v1/auth/token', { email, password });
			return { token: r.token };
		} catch (err) {
			return fail(400, { tokenError: actionError(err, 'Could not create the token. Try again.') });
		}
	},
};
