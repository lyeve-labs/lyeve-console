import { fail, redirect } from '@sveltejs/kit';
import { ApiError } from '@lyeve-labs/client';
import { getMe } from '@lyeve-labs/client-rest';
import { authedClient, sessionUser } from '$lib/server/authz';
import { clearSessionCookie, sessionToken } from '$lib/server/session-cookie';
import {
	approveDeviceLogin,
	denyDeviceLogin,
	getDeviceLogin,
	type DeviceLoginRequest,
	type DeviceStepUp,
} from '$lib/api/device-login';
import { describeRefusal } from '$lib/api/admin-tokens';
import { refusalOf, refusalText } from '$lib/api/refusal';
import {
	canApprove,
	isStepUpRefusal,
	loginRedirect,
	normalizeUserCode,
	outcomeForRefusal,
	type DeviceOutcome,
} from '$lib/device-login';
import type { Actions, PageServerLoad } from './$types';

/**
 * What the page is showing: the code field, a request to decide, or an outcome.
 * `busy` is a rate refusal and `refused` a 402. Neither is an outage, and
 * the same request can pass later or on another license.
 */
type View = 'enter' | 'pending' | 'busy' | 'refused' | DeviceOutcome;

/** The view an engine refusal stands for, with the sentence a 402 carries. */
function refusalView(e: ApiError): { view: View; refusal: string } {
	if (e.status === 429) return { view: 'busy', refusal: '' };
	if (e.status === 402) {
		const r = refusalOf(e);
		return {
			view: 'refused',
			refusal: r ? refusalText(r) : 'Device sign-in is not enabled on this engine.',
		};
	}
	return { view: outcomeForRefusal(e.status, e.message), refusal: '' };
}

/*
 * This page sits outside the console frame, like the sign-in page, so the
 * frame's guard does not run for it: it checks the session itself, and sends
 * a signed-out visitor to sign in and back here with the code intact.
 */
export const load: PageServerLoad = async (event) => {
	const { cookies, url } = event;
	if (!sessionToken(event)) {
		redirect(302, loginRedirect(url.pathname, url.search));
	}
	const client = authedClient(event);
	// Only an engine that says the session is over ends it. One that cannot
	// check it throws the outage page, and the cookie outlives the blip.
	const user = await sessionUser(client);
	if (!user) {
		clearSessionCookie(event);
		redirect(302, loginRedirect(url.pathname, url.search));
	}

	const raw = url.searchParams.get('code') ?? '';
	const page = (
		view: View,
		code: string,
		request: DeviceLoginRequest | null = null,
		mfaEnrolled = false,
		refusal = '',
	) => ({
		email: user.email,
		view,
		code,
		request,
		mfaEnrolled,
		refusal,
	});

	if (!canApprove(user.roles)) return page('forbidden', raw);
	if (!raw) return page('enter', '');
	const code = normalizeUserCode(raw);
	if (!code) return page('unknown', raw);
	try {
		// Which confirmation the engine will ask for. An unreadable status asks
		// for the password, and an engine that wants a code says so.
		const [request, mfaEnrolled] = await Promise.all([
			getDeviceLogin(client, code),
			client
				.get<{ enabled: boolean }>('/api/admin/mfa/status')
				.then((s) => s.enabled === true)
				.catch(() => false),
		]);
		return page('pending', code, request, mfaEnrolled);
	} catch (e) {
		if (e instanceof ApiError) {
			const { view, refusal } = refusalView(e);
			return page(view, code, null, false, refusal);
		}
		return page('error', code);
	}
};

/** The confirmation the approve form carries, or the field to fill in. */
function stepUpOf(form: FormData): { step: 'password' | 'mfa_code'; stepUp?: DeviceStepUp; missing?: string } {
	if (form.get('step') === 'mfa_code') {
		const code = String(form.get('mfa_code') ?? '').trim();
		return code
			? { step: 'mfa_code', stepUp: { mfa_code: code } }
			: { step: 'mfa_code', missing: 'Enter the current code from your authenticator app.' };
	}
	const password = String(form.get('password') ?? '');
	return password
		? { step: 'password', stepUp: { password } }
		: { step: 'password', missing: 'Enter your current password.' };
}

/** What the form says when the engine refuses an approval without a sentence. */
const APPROVAL_REFUSED = 'Could not approve this sign-in. The request is still open.';

/**
 * Whether the session's account may still approve. An account that cannot be
 * read counts as one that may, so the refusal is read as the confirmation's.
 */
async function stillApprover(client: ReturnType<typeof authedClient>): Promise<boolean> {
	try {
		return canApprove((await getMe(client)).roles);
	} catch {
		return true;
	}
}

/** Approves or denies the code the form carries, and reports the outcome. */
async function decide(event: Parameters<Actions[string]>[0], approve: boolean) {
	const form = await event.request.formData();
	const code = normalizeUserCode(String(form.get('code') ?? ''));
	if (!code) return fail(404, { outcome: 'unknown' as DeviceOutcome });
	const step = stepUpOf(form);
	if (approve && !step.stepUp) {
		return fail(400, { stepUp: { error: step.missing ?? '', field: step.missing ?? '', needsMfa: step.step === 'mfa_code' } });
	}
	const client = authedClient(event);
	try {
		if (approve && step.stepUp) {
			await approveDeviceLogin(client, code, step.stepUp);
		} else {
			await denyDeviceLogin(client, code);
		}
	} catch (e) {
		if (e instanceof ApiError) {
			// A refused confirmation leaves the request open: say so on the form
			// and keep the card on screen.
			// The engine also answers 403 to an account that lost its admin role
			// after the page loaded, which no confirmation can fix.
			if (approve && e.status === 403 && !(await stillApprover(client))) {
				return fail(403, { outcome: 'forbidden' as DeviceOutcome });
			}
			if (approve && isStepUpRefusal(e.status)) {
				const r = describeRefusal(e.status, e.message, step.step);
				const field = r.fields.password ?? r.fields.mfa_code ?? '';
				const error = e.message.trim() ? r.error : APPROVAL_REFUSED;
				return fail(e.status === 429 ? 429 : 400, {
					stepUp: { error: field ? '' : error, field, needsMfa: !!r.needsMfa || step.step === 'mfa_code' },
				});
			}
			const { view, refusal } = refusalView(e);
			return fail(e.status, refusal ? { outcome: view, refusal } : { outcome: view });
		}
		return fail(503, { outcome: 'error' as DeviceOutcome });
	}
	return { outcome: (approve ? 'approved' : 'denied') as DeviceOutcome };
}

export const actions: Actions = {
	approve: (event) => decide(event, true),
	deny: (event) => decide(event, false),
};
