import { redirect } from '@sveltejs/kit';
import type { Actions } from './$types';
import { createClient } from '@lyeve-labs/client';
import { authedHeaders } from '#lib/server/authz.ts';
import { clearCsrfCookie, clearRefreshCookie, clearSessionCookie, refreshToken, sessionToken } from '#lib/server/session-cookie.ts';

export const actions: Actions = {
	default: async ({ cookies, fetch, url }) => {
		const token = sessionToken({ cookies, url });
		if (token) {
			// Best-effort server-side session revocation so a stolen token does not
			// remain valid after logout. Cookie is cleared regardless. The refresh
			// token goes along, so the engine revokes its family too and nobody can
			// trade it for a new session.
			const headers = authedHeaders({ cookies, url });
			const client = createClient((url, init) =>
				fetch(url, {
					...init,
					headers: { ...init?.headers, ...headers },
				})
			);
			const refresh = refreshToken({ cookies, url });
			await client.post('/api/admin/auth/logout', refresh ? { refresh_token: refresh } : {}).catch(() => {});
		}
		clearSessionCookie({ cookies, url });
		clearRefreshCookie({ cookies, url });
		clearCsrfCookie({ cookies, url });
		redirect(302, '/login');
	},
};
