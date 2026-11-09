import type { PageServerLoad, Actions } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { authedClient, requireRole } from '$lib/server/authz';
import { actionFailure, tagged } from '$lib/server/action-error';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import {
	getTenantUsage,
	listQuotas,
	listRequests,
	listTenantUsage,
	deleteQuota,
	quotaFrom,
	reviewRequest,
	upsertQuota,
	type Quota,
	type QuotaRequest,
	type TenantUsage,
} from '$lib/api/usage';
import { type Gate, GATE_OK, section, type Section } from '$lib/api/gate';
import { rowsOf, pageWindow, pastEndOffset, statedTotal, totalOf, withOffset } from '$lib/api/list';
import { listPeople } from '$lib/server/people';
import { couldNotLoad } from '$lib/outage';
import { asked } from '$lib/server/asked';

/** What the page says in place of a requests read that failed. */
const REQUESTS_FAILED = couldNotLoad('the requests for more quota');

/** What the page says in place of a usage read that failed. */
const USAGE_FAILED = couldNotLoad('usage per tenant');

/** A read the page did not make, said the same way a refusal would be. */
const UNREAD: Section<never> = { ok: false, gate: { state: 'absent' } };

export const load: PageServerLoad = async (event) => {
	const { plugins, user } = await event.parent();
	// The plugin serves the quota reads to an admin as well, scoped to the
	// caller's tenant, and every write to a super admin only. Anybody else is
	// told rather than shown three failed reads.
	const superAdmin = user.roles.includes('super_admin');
	const permitted = superAdmin || user.roles.includes('admin');

	if (!permitted) {
		return {
			quotas: [] as Quota[],
			quotaTotal: 0,
			limit: 50,
			offset: 0,
			requests: UNREAD as Section<QuotaRequest[]>,
			requestTotal: null as number | null,
			usage: UNREAD as Section<TenantUsage[]>,
			people: {} as Record<string, string>,
			gate: GATE_OK as Gate,
			permitted,
		};
	}

	const client = authedClient(event);
	// The endpoint pages at 50 by default, so a read that names no window
	// shows the first 50 quotas and calls them every tenant's.
	const { limit, offset } = pageWindow(event.url, 50, 500);
	let quotas: Quota[] = [];
	let quotaTotal = 0;
	// The shell says why the page is unavailable while its plugin does not run.
	let gate: Gate = notRunning(plugins, PLUGIN.usage) ? { state: 'absent' } : GATE_OK;
	if (gate.state === 'ok') {
		const read = await section(listQuotas(client, limit, offset), couldNotLoad('usage'));
		if (read.ok) {
			quotas = rowsOf(read.value);
			quotaTotal = Math.max(totalOf(read.value), offset + quotas.length);
			// A page past the end is not an instance with no quota set.
			const back = pastEndOffset(quotas.length, limit, offset, statedTotal(read.value));
			if (back !== null) redirect(307, withOffset(event.url, back));
		} else {
			gate = read.gate;
		}
	}

	// Pending requests are the queue somebody has to act on, so an unread list
	// is never drawn as an empty one. Only the pending ones are asked for, so
	// one waiting behind a page of answered requests is still read.
	// A request names its requester by account id, so the directory turns the
	// ids into emails.
	const ok = gate.state === 'ok';
	// A quota row draws its usage beside its limit. Every tenant's usage is a
	// super admin's read, and an admin reads their own tenant's. The session
	// does not carry the tenant, but an admin's quota list holds only their
	// own tenant's row, so that row names it. With no row there is nothing to
	// draw the usage beside, so nothing is asked.
	const ownTenant = superAdmin ? '' : (quotas[0]?.tenant_id ?? '');
	const NO_USAGE: Section<TenantUsage[]> = { ok: true, value: [] };
	const usageRead = !ok
		? Promise.resolve(UNREAD)
		: superAdmin
			? section(listTenantUsage(client).then((u) => rowsOf(u)), USAGE_FAILED)
			: ownTenant
				? section(getTenantUsage(client, ownTenant).then((u) => [u]), USAGE_FAILED)
				: Promise.resolve(NO_USAGE);
	const [requestRead, usage, people] = await Promise.all([
		ok ? section(listRequests(client, 'pending'), REQUESTS_FAILED) : Promise.resolve(UNREAD),
		usageRead,
		ok ? listPeople(client) : Promise.resolve([]),
	]);
	const requests: Section<QuotaRequest[]> = requestRead.ok ? { ok: true, value: rowsOf(requestRead.value) } : requestRead;

	return {
		quotas,
		quotaTotal,
		limit,
		offset,
		requests,
		requestTotal: requestRead.ok ? statedTotal(requestRead.value) : null,
		usage: usage as Section<TenantUsage[]>,
		people: Object.fromEntries([
			...people.map((p) => [p.id, p.email] as const),
			...(user.email ? [[user.id, user.email] as const] : []),
		]) as Record<string, string>,
		gate,
		permitted,
	};
};

export const actions: Actions = {
	review: asked(
		{
			question: 'Approve this request?',
			detail: 'The tenant\'s limits are raised to what it asked for.',
			label: 'Approve',
		},
		async (event) => {
			await requireRole(event, ['super_admin']);
			const client = authedClient(event);
			const form = await event.request.formData();
			const id = String(form.get('id') ?? '');
			const decision = String(form.get('decision') ?? '');
			if (!id) return fail(400, { action: 'review', error: 'This form is missing its request. Reload the page and try again.' });
			if (decision !== 'approve' && decision !== 'deny') {
				return fail(400, { action: 'review', error: 'Choose approve or deny.' });
			}
			try {
				await reviewRequest(client, id, decision === 'approve');
			} catch (err) {
				return tagged('review', actionFailure(err, 'Could not review the request. Try again.'));
			}
			return { reviewed: id };
		},
		(form) => form.get('decision') === 'approve',
	),

	quota: async (event) => {
		await requireRole(event, ['super_admin']);
		const form = await event.request.formData();
		const tenant = String(form.get('tenant_id') ?? '').trim();
		if (!tenant) {
			return fail(400, { action: 'quota', error: 'Check the highlighted fields.', fields: { tenant_id: 'Choose a tenant.' } });
		}
		try {
			await upsertQuota(authedClient(event), tenant, quotaFrom(form));
		} catch (err) {
			return tagged('quota', actionFailure(err, 'Could not save the quota. Try again.'));
		}
		return { quotaSaved: tenant };
	},

	clearQuota: async (event) => {
		await requireRole(event, ['super_admin']);
		const form = await event.request.formData();
		const tenant = String(form.get('tenant_id') ?? '').trim();
		if (!tenant) return fail(400, { action: 'clearQuota', error: 'This form is missing its tenant. Reload the page and try again.' });
		try {
			await deleteQuota(authedClient(event), tenant);
		} catch (err) {
			return tagged('clearQuota', actionFailure(err, 'Could not delete the quota. Try again.'));
		}
		return { quotaCleared: tenant };
	},
};
