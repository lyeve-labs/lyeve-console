import type { Actions, PageServerLoad } from './$types';
import { error, fail, redirect } from '@sveltejs/kit';
import { ApiError } from '@lyeve-labs/client';
import { listTenants, type Tenant } from '@lyeve-labs/client-rest';
import { authedClient, loadUser, requireRole } from '$lib/server/authz';
import {
	allowedIPsProblem,
	createAdminToken,
	describeRefusal,
	listAdminGrants,
	listAdminTokenRequests,
	listAdminTokens,
	parseAllowedIPs,
	resolveExpiry,
	revokeAdminToken,
	rotateAdminToken,
	type AdminToken,
	type AdminTokenIssued,
	type AdminTokenRequest,
	type StepUp,
} from '$lib/api/admin-tokens';
import { pageWindow, pastEndOffset, rowsOf, statedTotal, totalOf, withOffset } from '$lib/api/list';
import { gateOf, section, type Gate, type Section } from '$lib/api/gate';
import { couldNotLoad } from '$lib/outage';
import { rolesInWords } from '$lib/roles';
import { asked } from '$lib/server/asked';

/** The engine pages this list at fifty and refuses more than a hundred. */
const PAGE = 50;
const MAX_PAGE = 100;
const OWNER_ROLES = ['admin', 'super_admin'];

export interface RequestLog {
	token: string;
	rows: AdminTokenRequest[];
	total: number;
	limit: number;
	offset: number;
	/** Why the log did not load. A 404 reads as absent: the token is gone, or the reader cannot view it. */
	gate?: Gate;
}

export const load: PageServerLoad = async (event) => {
	const { url } = event;
	const user = await loadUser(event);
	if (!user.roles.some((r) => OWNER_ROLES.includes(r))) error(403, `Only ${rolesInWords(OWNER_ROLES)} can open this page.`);
	const superAdmin = user.roles.includes('super_admin');
	const client = authedClient(event);
	const { limit, offset } = pageWindow(url, PAGE, MAX_PAGE);

	const [list, grants, mfa, tenants] = await Promise.all([
		section(listAdminTokens(client, limit, offset), couldNotLoad('the admin tokens')),
		// The grants are the create form's only required choice, so a failed
		// read is said in the form rather than drawn as a catalog with none.
		section(listAdminGrants(client), 'Could not load the grants, so you cannot create a token. Reload the page to try again.'),
		// Which step-up the engine will ask for. An unreadable status leaves it
		// unknown: the form asks for the password, and an engine that wants a
		// code says so and the form switches.
		client
			.get<{ enabled: boolean }>('/api/admin/mfa/status')
			.then((s) => s.enabled === true)
			.catch(() => false),
		superAdmin
			? section(
					listTenants(client, 500, 0).then((r) => r.items),
					couldNotLoad('the tenants')
				)
			: Promise.resolve<Section<Tenant[]>>({ ok: true, value: [] }),
	]);
	const rows: AdminToken[] = list.ok ? rowsOf(list.value) : [];
	if (list.ok) {
		const back = pastEndOffset(rows.length, limit, offset, statedTotal(list.value));
		if (back !== null) redirect(307, withOffset(url, back));
	}
	const tokens: Section<AdminToken[]> = list.ok ? { ok: true, value: rows } : list;
	const total = list.ok ? Math.max(totalOf(list.value), offset + rows.length) : 0;
	const tenantChoices: Section<{ slug: string; name: string }[]> = tenants.ok
		? { ok: true, value: tenants.value.filter((t) => !t.archived).map((t) => ({ slug: t.slug, name: t.name })) }
		: tenants;

	// The request log opens in a drawer over the list, and the URL names it
	// so the load reads it and the pager inside it works as links.
	let log: RequestLog | null = null;
	const logToken = url.searchParams.get('log');
	if (logToken) {
		const logOffset = Math.max(0, Number(url.searchParams.get('log_offset')) || 0);
		const read = await listAdminTokenRequests(client, logToken, PAGE, logOffset).then(
			(res) => ({ ok: true as const, res }),
			(err: unknown) => ({ ok: false as const, err })
		);
		if (read.ok) {
			const logRows = rowsOf(read.res);
			// A log_offset past the end would draw "No requests yet" for a token
			// that has some, so it goes back to the last page that holds rows.
			const back = pastEndOffset(logRows.length, PAGE, logOffset, statedTotal(read.res));
			if (back !== null) {
				const next = new URL(url);
				if (back > 0) next.searchParams.set('log_offset', String(back));
				else next.searchParams.delete('log_offset');
				redirect(307, `${next.pathname}${next.search}`);
			}
			log = {
				token: logToken,
				rows: logRows,
				total: Math.max(totalOf(read.res), logOffset + logRows.length),
				limit: PAGE,
				offset: logOffset,
			};
		} else {
			log = {
				token: logToken,
				rows: [],
				total: 0,
				limit: PAGE,
				offset: logOffset,
				gate: gateOf(read.err, couldNotLoad('the request log')),
			};
		}
	}

	return {
		tokens,
		total,
		limit,
		offset,
		grants,
		mfaEnrolled: mfa,
		tenants: tenantChoices,
		log,
		adminOrigin: url.origin,
	};
};

/** The step-up answer the form carries, or the field it is missing from. */
function stepUpOf(data: FormData): { stepUp: StepUp; step: 'password' | 'mfa_code' } | { missing: Record<string, string>; step: 'password' | 'mfa_code' } {
	const step = data.get('step') === 'mfa_code' ? 'mfa_code' : 'password';
	if (step === 'mfa_code') {
		const code = String(data.get('mfa_code') ?? '').trim();
		if (!code) return { step, missing: { mfa_code: 'Enter the current code from your authenticator app.' } };
		return { step, stepUp: { mfa_code: code } };
	}
	const password = String(data.get('password') ?? '');
	if (!password) return { step, missing: { password: 'Enter your current password.' } };
	return { step, stepUp: { password } };
}

/** What a successful create or rotate hands the page: the token, once. */
function issued(t: AdminTokenIssued, rotated: boolean) {
	return { issued: { token: t.token, name: t.name, expires_at: t.expires_at, rotated } };
}

function refused(err: unknown, step: 'password' | 'mfa_code', action: string) {
	const status = err instanceof ApiError ? err.status : 500;
	const refusal = describeRefusal(status, err instanceof ApiError ? err.message : '', step);
	return fail(status === 429 ? 429 : 400, { action, ...refusal });
}

export const actions: Actions = {
	create: async (event) => {
		await requireRole(event, OWNER_ROLES);
		const data = await event.request.formData();
		const fields: Record<string, string> = {};

		const name = String(data.get('name') ?? '').trim();
		if (!name) fields.name = 'Name the token.';
		else if (name.length > 255) fields.name = 'Name the token in at most 255 characters.';
		const grants = data.getAll('grants').map(String).filter(Boolean);
		if (grants.length === 0) fields.grants = 'Choose at least one grant.';
		const expiry = resolveExpiry(String(data.get('expiry') ?? ''), String(data.get('expires_at') ?? ''));
		if ('problem' in expiry) fields.expires_at = expiry.problem;
		const ipText = String(data.get('allowed_ips') ?? '');
		const ipProblem = allowedIPsProblem(ipText);
		if (ipProblem) fields.allowed_ips = ipProblem;
		const step = stepUpOf(data);
		if ('missing' in step) Object.assign(fields, step.missing);
		if (Object.keys(fields).length > 0 || 'problem' in expiry || 'missing' in step) {
			return fail(400, { action: 'create', error: 'Check the highlighted fields.', fields });
		}

		const tenant = String(data.get('tenant_id') ?? '').trim();
		try {
			const t = await createAdminToken(authedClient(event), {
				name,
				grants,
				expires_at: expiry.expires_at,
				allowed_ips: parseAllowedIPs(ipText).entries,
				...(tenant ? { tenant_id: tenant } : {}),
				...step.stepUp,
			});
			return issued(t, false);
		} catch (err) {
			return refused(err, step.step, 'create');
		}
	},

	rotate: async (event) => {
		await requireRole(event, OWNER_ROLES);
		const data = await event.request.formData();
		const id = String(data.get('id') ?? '');
		const fields: Record<string, string> = {};
		const expiry = resolveExpiry(String(data.get('expiry') ?? ''), String(data.get('expires_at') ?? ''));
		if ('problem' in expiry) fields.expires_at = expiry.problem;
		const step = stepUpOf(data);
		if ('missing' in step) Object.assign(fields, step.missing);
		if (!id || 'problem' in expiry || 'missing' in step) {
			return fail(400, { action: 'rotate', error: 'Check the highlighted fields.', fields });
		}
		try {
			const t = await rotateAdminToken(authedClient(event), id, { expires_at: expiry.expires_at, ...step.stepUp });
			return issued(t, true);
		} catch (err) {
			return refused(err, step.step, 'rotate');
		}
	},

	revoke: asked(
		{
			question: 'Revoke this token?',
			detail: 'Anything calling the admin API with it is refused from now on. The token stays listed as revoked and cannot be used again.',
			label: 'Revoke',
		},
		async (event) => {
			await requireRole(event, OWNER_ROLES);
			const data = await event.request.formData();
			const id = String(data.get('id') ?? '');
			try {
				await revokeAdminToken(authedClient(event), id);
				return { revoked: true };
			} catch (err) {
				const status = err instanceof ApiError ? err.status : 500;
				const message =
					status === 409
						? 'This token was already revoked.'
						: status === 403
							? 'Only the owner of a token or a super admin can revoke it.'
							: status >= 500
								? 'Check whether the token was revoked, then try again.'
								: 'Could not revoke the token. Try again.';
				return fail(400, { action: 'revoke', error: message, fields: {} });
			}
		},
	),
};
