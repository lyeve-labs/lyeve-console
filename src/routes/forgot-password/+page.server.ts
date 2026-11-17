import { fail } from '@sveltejs/kit';
import { createClient } from '@lyeve-labs/client';
import { requestPasswordReset } from '#lib/api/password-reset.ts';
import { recoveryRefusal } from '#lib/server/recovery.ts';
import { checkRateLimit } from '#lib/server/rate-limit.ts';
import { organizationFromUrl } from '#lib/organization.ts';
import { askedOrganization, asksOrganization } from '#lib/server/sign-in-organization.ts';
import type { Actions, PageServerLoad } from './$types';

// A link that names the organization fills the field in, and the reader can
// change or clear it. A console that does not ask for one carries none on.
export const load: PageServerLoad = ({ url }) => {
	const organization = asksOrganization();
	return { organization, carried: organization ? organizationFromUrl(url) : '' };
};

export const actions: Actions = {
	default: async (event) => {
		const limit = checkRateLimit(event.getClientAddress());
		if (!limit.allowed) {
			return fail(429, { error: 'Too many attempts. Try again later.', email: '', tenant: '' });
		}

		const form = await event.request.formData();
		const email = String(form.get('email') ?? '').trim();
		const typed = String(form.get('tenant') ?? '').trim();
		if (!email) return fail(400, { error: 'Enter the email address you sign in with.', email, tenant: typed });
		const organization = askedOrganization(form);
		if (!organization.ok) return fail(400, { error: organization.error, email, tenant: typed });

		try {
			await requestPasswordReset(createClient(event.fetch), email, organization.value);
		} catch (e) {
			const refused = recoveryRefusal(e, 'Password reset');
			if (refused) return fail(refused.status, { error: refused.error, email, tenant: typed });
			return fail(400, { error: 'Enter a valid email address.', email, tenant: typed });
		}
		// The engine answers the same whether or not the address has an
		// account or the organization exists, and so does this page.
		return { sent: true, email };
	},
};
