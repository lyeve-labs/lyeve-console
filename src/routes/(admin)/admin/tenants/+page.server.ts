import type { PageServerLoad, Actions } from './$types';
import { fail, error, redirect } from '@sveltejs/kit';
import { authedClient, loadUser, requireRole } from '$lib/server/authz';
import {
	listTenants,
	createTenant,
	updateTenant,
	deleteTenant,
	type Tenant
} from '@lyeve-labs/client-rest';
import { ApiError } from '@lyeve-labs/client';
import { actionFailure, tagged } from '$lib/server/action-error';
import { getProvisioning, tenantRefusal } from '$lib/api/tenants';
import { refusalText } from '$lib/api/refusal';
import { section, type Gate, type Section } from '$lib/api/gate';
import { pageWindow, pastEndOffset, withOffset } from '$lib/api/list';
import { couldNotLoad } from '$lib/outage';
import { asked } from '$lib/server/asked';

/** The engine's own page size when a request names none. */
const DEFAULT_LIMIT = 50;

/**
 * The engine's ceiling on a page. It clamps a larger request rather than
 * refusing it, so asking for more comes back silently short.
 */
const MAX_LIMIT = 500;

/** What the page says for a list read that failed for no reason it can name. */
const LIST_FAILED = couldNotLoad('the tenants');

/** What the page says when it cannot tell whether a tenant may be created. */
const PROVISIONING_FAILED = 'Could not check whether new tenants can be created.';

/** The slug rule, as the Slug field states it when the engine refuses a slug. */
const SLUG_RULE = 'Use lowercase letters, digits and underscores, starting with a letter, in at most 63 characters.';

/** The plan the plugin stores for a tenant created with none. */
const DEFAULT_PLAN = 'free';

/**
 * The failure of a create the plugin refused. A slug the engine does not
 * accept lands on the Slug field. A refusal for the license renders with the
 * link the plugin sent, so the operator sees what lifts it rather than a bare
 * sentence. The tenant ceiling, which the plugin answers with a sentence and
 * no cap, reads as a limit reached.
 */
function createFailure(err: unknown) {
	if (err instanceof ApiError && err.status === 400 && err.message?.startsWith('invalid slug')) {
		return fail(400, { action: 'create', error: 'Check the highlighted fields.', fields: { slug: SLUG_RULE } });
	}
	const refused = tenantRefusal(err);
	if (refused) return fail(402, { action: 'create', error: refusalText(refused), refused });
	return tagged('create', actionFailure(err, 'Could not create the tenant. Try again.'));
}

export const load: PageServerLoad = async (event) => {
	const { url } = event;
	const user = await loadUser(event);
	if (!user.roles.includes('super_admin')) error(403, 'Only a super admin can open this page.');
	const client = authedClient(event);

	const { limit, offset } = pageWindow(url, DEFAULT_LIMIT, MAX_LIMIT);

	// The plugin says whether a create would pass, so the page offers one only
	// then, and where it would not, the link to what lifts it. Only a refusal
	// says creating is not enabled. A plugin without the route says nothing
	// about the license, and any other failure is unread: each keeps its gate,
	// so the page says what happened rather than calling the instance
	// unlicensed.
	const [read, provisioning] = await Promise.all([
		section(listTenants(client, limit, offset), LIST_FAILED),
		section(getProvisioning(client), PROVISIONING_FAILED),
	]);
	const canProvision = provisioning.ok && provisioning.value.enabled;
	// A read that says no and a refusal both name where creating is turned on.
	const provisioningUrl = provisioning.ok
		? provisioning.value.upgradeUrl
		: provisioning.gate.state === 'locked'
			? provisioning.gate.upgradeUrl
			: '';
	const provisionGate: Gate | null =
		!provisioning.ok && provisioning.gate.state !== 'locked'
			? provisioning.gate
			: null;
	// The page draws the gate in place of the list and offers no create.
	if (!read.ok) return { tenants: read, limit, offset, total: 0, canProvision: false, provisionGate: null, provisioningUrl };
	const result = read.value;
	// A page past the end is not an instance with no tenants, so the request
	// goes back to the last page that holds rows.
	const back = pastEndOffset(result.items.length, limit, offset, result.total > 0 ? result.total : null);
	if (back !== null) redirect(307, withOffset(url, back));

	// The envelope carries the collection count, so one server page is never
	// described as the whole instance. What has been read is the floor, for an
	// answer that omits the count.
	const total = Math.max(result.total, offset + result.items.length);

	// Typed, because a bare literal widens `ok` to boolean and the page could
	// no longer tell the two cases apart.
	const tenants: Section<Tenant[]> = { ok: true, value: result.items };
	return { tenants, limit, offset, total, canProvision, provisionGate, provisioningUrl };
};

export const actions: Actions = {
	create: async (event) => {
		await requireRole(event, ['super_admin']);
		const { request } = event;
		const client = authedClient(event);
		const data = await request.formData();
		const slug = String(data.get('slug') ?? '').trim();
		const name = String(data.get('name') ?? '').trim();
		const plan = String(data.get('plan') ?? '').trim();
		/*
		 * Per field, not one sentence for the form. A single banner naming both
		 * rules leaves the operator to work out which of the two controls it is
		 * about, so each control carries its own message.
		 */
		const fields: Record<string, string> = {};
		if (!slug) fields.slug = 'Enter a slug.';
		if (!name) fields.name = 'Enter a display name.';
		if (Object.keys(fields).length > 0) {
			return fail(400, { action: 'create', error: 'Check the highlighted fields.', fields });
		}
		try {
			await createTenant({ slug, name, plan: plan || undefined }, client);
		} catch (err) {
			return createFailure(err);
		}
	},

	update: async (event) => {
		await requireRole(event, ['super_admin']);
		const { request } = event;
		const client = authedClient(event);
		const data = await request.formData();
		const id = String(data.get('id') ?? '');
		const name = String(data.get('name') ?? '').trim();
		const plan = String(data.get('plan') ?? '').trim();
		if (!name) return fail(400, { action: 'update', error: 'Check the highlighted fields.', fields: { name: 'Enter a display name.' } });
		try {
			// The plugin keeps the stored plan when the key is absent, so an
			// emptied field sends the plan a create with none is given.
			await updateTenant(id, { name, plan: plan || DEFAULT_PLAN }, client);
		} catch (err) {
			const failed = actionFailure(err, 'Could not save the tenant. Try again.');
			return fail(failed.status, { action: 'update', ...failed.data });
		}
	},

	toggle: async (event) => {
		await requireRole(event, ['super_admin']);
		const { request } = event;
		const client = authedClient(event);
		const data = await request.formData();
		const id = String(data.get('id') ?? '');
		const enabled = data.get('enabled') === 'true';
		try {
			await updateTenant(id, { enabled: !enabled }, client);
		} catch (err) {
			const failed = actionFailure(err, enabled ? 'Could not disable the tenant. Try again.' : 'Could not enable the tenant. Try again.');
			return fail(failed.status, { action: 'toggle', ...failed.data });
		}
	},

	delete: asked(
		{
			question: 'Delete this tenant?',
			detail: "All of its data and users are deleted. Its stored files stay in the storage backend until that backend's own lifecycle rules remove them.",
			label: 'Delete',
		},
		async (event) => {
			await requireRole(event, ['super_admin']);
			const { request } = event;
			const client = authedClient(event);
			const data = await request.formData();
			const id = String(data.get('id') ?? '');
			try {
				await deleteTenant(id, client);
			} catch (err) {
				const failed = actionFailure(err, 'Could not delete the tenant. Try again.');
				return fail(failed.status, { action: 'delete', ...failed.data });
			}
		},
	),
};
