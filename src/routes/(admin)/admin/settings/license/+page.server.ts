import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { authedClient, loadUser, requireRole } from '$lib/server/authz';
import { ApiError } from '@lyeve-labs/client';
import { getEntitlements } from '@lyeve-labs/client-rest';
import type { LicenseEntitlements } from '$lib/entitlements';
import { sessionToken } from '$lib/server/session-cookie';
import { actionError } from '$lib/server/action-error';
import { forbiddenText } from '$lib/api/gate';

const RENEW_FAILED = 'Could not apply the license. The current license is unchanged.';

/**
 * A failure nobody worded, or an answer that never came, does not say
 * whether the engine stored the key: it may still verify and store it after
 * the admin stops waiting.
 */
const RENEW_UNCONFIRMED = 'Could not confirm the license. Reload the page to see which license is active.';

/**
 * How long a renewal may take. The engine may spend up to 15 seconds asking
 * the license server before it verifies and stores the key, so the client's
 * default of 15 seconds would give up while the key still applies.
 */
const RENEW_TIMEOUT_MS = 45_000;

/**
 * The failures of a key exchange the license module words for the operator,
 * each with what it means for trying again. Matched by the exact message, so
 * a 502 or 503 from anything in front of the engine keeps the static sentence.
 */
const EXCHANGE_FAILURES: Readonly<Record<string, string>> = {
	'the license server could not be reached':
		'Could not reach the license server, so the key was not checked. The current license is unchanged. Try again.',
	'the license server returned a token that does not verify':
		'Could not verify the license returned for this key. The current license is unchanged. Trying the same key again fails the same way.',
	'license key exchange is not configured on this engine':
		'This engine cannot exchange a key with the license server. Paste the license token instead. The current license is unchanged.',
	// The same refusal from an engine released before the API said "engine".
	'license key exchange is not configured on this instance':
		'This engine cannot exchange a key with the license server. Paste the license token instead. The current license is unchanged.',
};

/** Roles the engine gives the entitlements to. Nobody else has a license to read. */
const READER_ROLES = ['admin', 'super_admin'];

export const load: PageServerLoad = async (event) => {
	const user = await loadUser(event);
	if (!user.roles.some((role) => READER_ROLES.includes(role))) {
		error(403, forbiddenText('this page', READER_ROLES));
	}

	// Read here rather than taken from the shell, which kept its answer across
	// every navigation since the document loaded.
	const entitlements: LicenseEntitlements | null = await getEntitlements(authedClient(event)).catch(() => null);

	// A build that links no license module has no license to show, so the page
	// is not there. An engine that does not say keeps the page.
	if (entitlements?.license_module === false) error(404, 'This page does not exist.');

	return { entitlements };
};

/** What the engine answers a renewal with. The token itself never comes back. */
interface RenewResult {
	plan: string;
	state: string;
	features: string[];
	license_source?: string;
	expires_at?: string;
}

export const actions: Actions = {
	// Posts the pasted token or key to the engine, which decides whether it
	// applies. It relicenses the whole install, so only a super admin may
	// submit it, and the engine refuses anyone else as well.
	renew: async (event) => {
		const { request } = event;
		if (!sessionToken(event)) return fail(401, { error: 'Not authenticated' });
		await requireRole(event, ['super_admin']);

		const data = await request.formData();
		const licenseKey = data.get('license_key')?.toString()?.trim();
		if (!licenseKey) return fail(400, { error: 'Enter a license token or key.' });

		const client = authedClient(event);
		try {
			const result = await client.post<RenewResult>(
				'/api/admin/license/renew',
				{ license_key: licenseKey },
				{ signal: AbortSignal.timeout(RENEW_TIMEOUT_MS) },
			);
			return { success: true, ...result };
		} catch (e) {
			// The license module words its refusal for the operator, so a
			// refusal is shown as it was sent. A failure of the engine is not
			// written for the operator, and its text never reaches the page.
			const status = e instanceof ApiError ? (e.status < 500 ? e.status : 502) : 500;
			if (e instanceof ApiError && e.status < 500) return fail(status, { error: actionError(e, RENEW_FAILED) });
			const exchange = e instanceof ApiError ? EXCHANGE_FAILURES[e.message] : undefined;
			return fail(status, { error: exchange ?? RENEW_UNCONFIRMED });
		}
	},
};
