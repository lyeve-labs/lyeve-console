import type { Actions, PageServerLoad } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { ApiError } from '@lyeve-labs/client';
import { authedClient } from '$lib/server/authz';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning, runs } from '$lib/plugins';
import { describeRefusal } from '$lib/api/admin-tokens';
import { isOutage, section } from '$lib/api/gate';
import { errorCodeOf } from '$lib/api/limits';
import { pageOf, pageWindow, pastEndOffset, withOffset } from '$lib/api/list';
import { normalizeUserCode } from '$lib/device-login';
import {
	SAID,
	WITHHELD,
	approveRequest,
	connectionsGate,
	declineRequest,
	getRequest,
	listConnections,
	revokeAllConnections,
	revokeConnection,
	type ApproveStepUp,
	type Connection,
	type ConnectionRequest,
	type ConnectionsGate,
} from '$lib/api/connected-editors';
import { isOwner, refusalSentence } from './shared.server';
import { asked } from '$lib/server/asked';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

export const load: PageServerLoad = async (event) => {
	const { plugins, user } = await event.parent();
	const { limit, offset } = pageWindow(event.url, DEFAULT_LIMIT, MAX_LIMIT);
	const owner = isOwner(user?.roles);
	const base = {
		limit,
		offset,
		owner,
		email: user?.email ?? '',
		roles: user?.roles ?? [],
		// A super admin acts in one tenant at a time, and an approval binds that one.
		tenant: runs(plugins, PLUGIN.multitenant) ? (user?.tenant_id ?? '') : '',
		// The builder links here to open the drawer. The code never travels in the URL.
		openApprove: event.url.searchParams.has('approve'),
	};

	// The shell says why the page is unavailable while its plugin does not run.
	if (notRunning(plugins, PLUGIN.builder)) {
		return {
			...base,
			connections: [] as Connection[],
			total: null as number | null,
			hasMore: false,
			gate: { state: 'absent' } as ConnectionsGate,
			mfaEnrolled: false,
		};
	}

	const client = authedClient(event);
	// Which confirmation the approval will ask for. An unreadable status asks
	// for the password, and an account that has MFA is told so by the refusal.
	const mfa = client
		.get<{ enabled: boolean }>('/api/admin/mfa/status')
		.then((s) => s.enabled === true)
		.catch(() => false);

	const page = await section(
		listConnections(client, limit, offset).then((answer) => pageOf(answer, limit, offset)),
		connectionsGate,
	);
	if (page.ok) {
		const back = pastEndOffset(page.value.rows.length, limit, offset, page.value.total);
		if (back !== null) redirect(307, withOffset(event.url, back));
	}

	return {
		...base,
		connections: page.ok ? page.value.rows : [],
		total: page.ok ? page.value.total : null,
		hasMore: page.ok && page.value.hasMore,
		gate: page.ok ? ({ state: 'ok' } as ConnectionsGate) : page.gate,
		mfaEnrolled: await mfa,
	};
};

/** Whether a request whose code ran out at `expiresAt` has run out by now. */
function ranOut(expiresAt: string): boolean {
	const at = Date.parse(expiresAt);
	return !Number.isNaN(at) && at <= Date.now();
}

/** The drawer's answer for a code the engine does not hold: unknown, or one that ran out while it was open. */
function missing(code: string, expiresAt: string) {
	return ranOut(expiresAt)
		? fail(404, { drawer: { code, expired: true } })
		: fail(404, { drawer: { code, codeError: SAID.unknown } });
}

/** Reads the request again after a refusal that changed it, so the drawer shows what the engine holds now. */
async function relook(client: ReturnType<typeof authedClient>, code: string): Promise<ConnectionRequest | null> {
	try {
		return await getRequest(client, code);
	} catch {
		return null;
	}
}

/** The confirmation the approve form carries, or the field to fill in. */
function stepUpOf(form: FormData): { step: 'password' | 'mfa_code'; stepUp?: ApproveStepUp } {
	if (form.get('step') === 'mfa_code') {
		const code = String(form.get('mfa_code') ?? '').trim();
		return code ? { step: 'mfa_code', stepUp: { mfa_code: code } } : { step: 'mfa_code' };
	}
	const password = String(form.get('password') ?? '');
	return password ? { step: 'password', stepUp: { password } } : { step: 'password' };
}

/**
 * Where a refused confirmation lands: the field, in the admin's words when it
 * has them and in the engine's otherwise, and which factor to ask for next.
 * The engine names the factor an account must use when the wrong one came.
 */
function stepUpRefusal(e: ApiError, step: 'password' | 'mfa_code') {
	const r = describeRefusal(e.status, e.message, step);
	const field = r.fields.password ?? r.fields.mfa_code ?? (e.message.trim() || SAID.stepUpMissing);
	let needsMfa = step === 'mfa_code';
	if (/MFA enrolled/i.test(e.message)) needsMfa = true;
	if (/no authenticator/i.test(e.message)) needsMfa = false;
	return { field, needsMfa };
}

// No requireRole here. Every route reads the person from the session and
// answers for itself: anyone at editor or above approves and sees their own
// connections, and owners see all of them.
export const actions: Actions = {
	lookup: async (event) => {
		const form = await event.request.formData();
		const raw = String(form.get('code') ?? '');
		const code = normalizeUserCode(raw);
		if (!code) return fail(400, { drawer: { code: raw, codeError: SAID.malformed } });
		try {
			return { drawer: { code, request: await getRequest(authedClient(event), code) } };
		} catch (e) {
			if (errorCodeOf(e) === 'request_unknown') return fail(404, { drawer: { code, codeError: SAID.unknown } });
			if (errorCodeOf(e) === WITHHELD) return fail(403, { drawer: { code, withheld: true } });
			if (isOutage(e)) return fail(503, { drawer: { code, codeError: SAID.lookupFailed } });
			return fail(e instanceof ApiError ? e.status : 400, {
				drawer: { code, codeError: refusalSentence(e, SAID.lookupFailed) },
			});
		}
	},

	approve: async (event) => {
		const form = await event.request.formData();
		const code = normalizeUserCode(String(form.get('code') ?? ''));
		if (!code) return fail(400, { drawer: { code: String(form.get('code') ?? ''), codeError: SAID.malformed } });
		const expiresAt = String(form.get('code_expires_at') ?? '');
		const fingerprint = String(form.get('fingerprint') ?? '');
		const lifetime = Number(form.get('lifetime_days'));
		const step = stepUpOf(form);
		if (!step.stepUp) {
			return fail(400, { drawer: { code, stepUp: { field: SAID.stepUpMissing, needsMfa: step.step === 'mfa_code' } } });
		}
		const client = authedClient(event);
		try {
			const out = await approveRequest(client, code, { fingerprint, lifetime_days: lifetime, ...step.stepUp });
			return { approved: { expires_at: out.expires_at } };
		} catch (e) {
			const reason = errorCodeOf(e);
			if (e instanceof ApiError) {
				switch (reason) {
					case 'step_up_required':
						return fail(403, { drawer: { code, stepUp: { field: SAID.stepUpMissing, needsMfa: step.step === 'mfa_code' } } });
					case 'step_up_refused':
						return fail(e.status, { drawer: { code, stepUp: stepUpRefusal(e, step.step) } });
					case 'approval_unavailable':
						return fail(503, { drawer: { code, approvalUnavailable: true } });
					case 'check_unavailable':
						return fail(503, { drawer: { code, checkUnavailable: true } });
					case 'request_unknown':
						return missing(code, expiresAt);
					case 'request_decided':
						return fail(409, { drawer: { code, decided: true } });
					case 'key_changed':
						return fail(409, { drawer: { code, keyChanged: true, request: await relook(client, code) } });
					case 'lifetime_invalid':
						return fail(422, { drawer: { code, lifetimeChanged: true, request: await relook(client, code) } });
					case WITHHELD:
						return fail(403, { drawer: { code, withheld: true } });
				}
			}
			if (isOutage(e)) return fail(503, { drawer: { code, error: SAID.approveOutage } });
			return fail(e instanceof ApiError ? e.status : 400, {
				drawer: { code, error: refusalSentence(e, 'Could not approve the connection. Try again.') },
			});
		}
	},

	decline: async (event) => {
		const form = await event.request.formData();
		const code = normalizeUserCode(String(form.get('code') ?? ''));
		if (!code) return fail(400, { drawer: { code: String(form.get('code') ?? ''), codeError: SAID.malformed } });
		try {
			await declineRequest(authedClient(event), code);
			return { declined: true };
		} catch (e) {
			const reason = errorCodeOf(e);
			if (reason === 'request_unknown') return missing(code, String(form.get('code_expires_at') ?? ''));
			if (reason === 'request_decided') return fail(409, { drawer: { code, decided: true } });
			if (reason === WITHHELD) return fail(403, { drawer: { code, withheld: true } });
			if (isOutage(e)) return fail(503, { drawer: { code, error: SAID.declineOutage } });
			return fail(e instanceof ApiError ? e.status : 400, {
				drawer: { code, error: refusalSentence(e, 'Could not decline the request. Try again.') },
			});
		}
	},

	revoke: asked(
		{
			question: 'Revoke this builder connection?',
			detail: 'That browser stops editing immediately.',
			label: 'Revoke',
		},
		async (event) => {
			const form = await event.request.formData();
			const id = String(form.get('id') ?? '');
			const person = String(form.get('person') ?? '');
			if (!id) return fail(400, { revokeError: 'This form is missing its connection. Reload the page and try again.' });
			try {
				await revokeConnection(authedClient(event), id);
			} catch (e) {
				if (errorCodeOf(e) === WITHHELD) return fail(403, { revokeError: SAID.withheld });
				if (isOutage(e)) return fail(503, { revokeError: SAID.revokeOutage });
				return fail(e instanceof ApiError ? e.status : 400, {
					revokeError: refusalSentence(e, 'Could not revoke the connection. Try again.'),
				});
			}
			return { revoked: person };
		},
	),

	revokeAll: asked(
		{
			question: 'Revoke all builder connections?',
			detail: 'Every connected browser stops editing immediately, and every waiting request is declined.',
			label: 'Revoke all',
		},
		async (event) => {
			try {
				const out = await revokeAllConnections(authedClient(event));
				return { revokedAll: out.revoked };
			} catch (e) {
				if (errorCodeOf(e) === WITHHELD) return fail(403, { revokeError: SAID.withheld });
				if (isOutage(e)) return fail(503, { revokeAllError: SAID.revokeAllFailed });
				return fail(e instanceof ApiError ? e.status : 400, {
					revokeAllError: refusalSentence(e, 'Could not revoke the connections. Try again.'),
				});
			}
		},
	),
};
