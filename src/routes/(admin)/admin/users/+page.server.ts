import type { PageServerLoad, Actions } from './$types';
import { ApiError } from '@lyeve-labs/client';
import { createUser, updateUserRoles, deleteUser, listTenants, type Tenant } from '@lyeve-labs/client-rest';
import { fail, error, redirect } from '@sveltejs/kit';
import { authedClient, requireRole } from '$lib/server/authz';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import { actionError, actionFailure, tagged } from '$lib/server/action-error';
import { checked } from '$lib/checkbox';
import { passwordTooLong, setUserPassword, type ListedUser } from '$lib/api/users';
import { seatRefusal } from '$lib/api/admin-seats';
import { refusalText } from '$lib/api/refusal';
import { section, type Section } from '$lib/api/gate';
import { pageWindow, pastEndOffset, withOffset } from '$lib/api/list';
import { couldNotLoad } from '$lib/outage';
import { rolesInWords } from '$lib/roles';
import { asked } from '$lib/server/asked';

/** The engine's own page size when a request names none. */
const DEFAULT_LIMIT = 25;

/**
 * One below the engine's ceiling of 200, because the request below asks for a
 * row past the page to learn whether another page exists. At the ceiling that
 * extra row would be clamped away and the last page would always look like the
 * last page.
 */
const MAX_LIMIT = 199;

export const load: PageServerLoad = async (event) => {
	const { url, parent } = event;
	const { user, plugins } = await parent();
	if (!user.roles.includes('super_admin')) {
		error(403, `Only ${rolesInWords(['super_admin'])} can open this page.`);
	}

	const client = authedClient(event);

	// Snapped to a page boundary, so the pager numbers the rows on screen.
	const { limit, offset } = pageWindow(url, DEFAULT_LIMIT, MAX_LIMIT);

	/*
	 * The users endpoint answers with a bare array and no row count, so there is
	 * no collection total to state and no numbered pager that could be built
	 * without inventing one. Asking for a single row past the page is the only
	 * honest thing available: it says whether a next page exists and nothing
	 * more. Without it, a page that ends at the engine's default looks complete.
	 */
	const [rows, tenants] = await Promise.all([
		section(
			client.get<ListedUser[]>(`/api/admin/users?limit=${limit + 1}&offset=${offset}`),
			couldNotLoad('the accounts')
		),
		// An account belongs to one tenant. With several, the engine cannot
		// tell which one a new account is for unless the form names it.
		notRunning(plugins, PLUGIN.multitenant)
			? Promise.resolve<Section<Tenant[]>>({ ok: true, value: [] })
			: section(
					listTenants(client, 500, 0).then((r) => (Array.isArray(r?.items) ? r.items : [])),
					couldNotLoad('the tenants')
				),
	]);
	const page = rows.ok && Array.isArray(rows.value) ? rows.value : [];
	const hasMore = page.length > limit;
	if (rows.ok) {
		const back = pastEndOffset(page.length, limit, offset, null);
		if (back !== null) redirect(307, withOffset(url, back));
	}

	const users: Section<ListedUser[]> = rows.ok ? { ok: true, value: page.slice(0, limit) } : rows;
	const choices: Section<{ slug: string; name: string }[]> = tenants.ok
		? { ok: true, value: tenants.value.filter((t) => !t.archived).map((t) => ({ slug: t.slug, name: t.name })) }
		: tenants;
	return { users, limit, offset, hasMore, tenants: choices };
};

export const actions: Actions = {
	create: async (event) => {
		await requireRole(event, ['super_admin']);
		const { request } = event;
		const client = authedClient(event);
		const form = await request.formData();
		const email = String(form.get('email') ?? '').trim();
		const password = String(form.get('password') ?? '');
		// The roles field arrives once per ticked checkbox. A single comma
		// separated value still parses, so a form posted without JavaScript and
		// the API's own callers keep working.
		const roles = form
			.getAll('roles')
			.flatMap((value) => String(value).split(','))
			.map((role) => role.trim())
			.filter(Boolean);

		/*
		 * Per field, not one sentence for the form. A single banner saying both
		 * rules leaves the operator to work out which of the two controls it is
		 * about, so each control carries its own message.
		 */
		const fields: Record<string, string> = {};
		if (!email) fields.email = 'Enter an email address.';
		// The engine judges the password, its minimum included, since an install
		// may set that, and its refusal lands on this field below. Past the
		// hasher's limit it fails without naming a rule, so that one is caught here.
		if (!password) fields.password = 'Enter a password.';
		else if (passwordTooLong(password)) fields.password = passwordTooLong(password) ?? '';
		// The form offers the choice only where there is one to make, and then
		// it is required: the engine refuses an account that names no tenant.
		const tenant = String(form.get('tenant_id') ?? '').trim();
		if (form.get('tenant_required') === '1' && !tenant) fields.tenant_id = 'Choose the tenant this account belongs to';
		if (Object.keys(fields).length > 0) {
			return fail(400, { action: 'create', error: 'Check the highlighted fields.', fields });
		}
		// The engine honors X-Tenant-ID from a super admin only, and checks the
		// slug against its roster.
		const target = tenant ? authedClient(event, { 'X-Tenant-ID': tenant }) : client;
		try {
			// The engine makes an account sent no role an editor, so the least
			// privileged role is named instead.
			await createUser(email, password, roles.length ? roles : ['viewer'], target);
			return { ok: true };
		} catch (err) {
			const full = seatRefusal(err);
			if (full) return fail(402, { action: 'create', error: refusalText(full), refused: full });
			// The email is checked above, so a 422 is the password policy.
			if (err instanceof ApiError && err.status === 422) {
				return fail(422, {
					action: 'create',
					error: 'Check the highlighted field.',
					fields: { password: actionError(err, 'This password does not meet the password policy.') },
				});
			}
			return tagged('create', actionFailure(err, 'Could not create the user. Try again.'));
		}
	},

	updateRoles: async (event) => {
		await requireRole(event, ['super_admin']);
		const { request } = event;
		const client = authedClient(event);
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		// One value per ticked box from the drawer, or one comma separated
		// value from a caller without JavaScript. Both parse.
		const roles = form
			.getAll('roles')
			.flatMap((value) => String(value).split(','))
			.map((r) => r.trim())
			.filter(Boolean);
		try {
			await updateUserRoles(id, roles, client);
			return { ok: true };
		} catch (err) {
			const full = seatRefusal(err);
			if (full) return fail(402, { action: 'updateRoles', error: refusalText(full), refused: full });
			return tagged('updateRoles', actionFailure(err, 'Could not save the roles. Try again.'));
		}
	},

	delete: asked(
		{
			question: 'Delete this user?',
			detail: 'Their sessions end immediately and their audit trail is kept. This cannot be undone.',
			label: 'Delete',
		},
		async (event) => {
			await requireRole(event, ['super_admin']);
			const { request } = event;
			const client = authedClient(event);
			const form = await request.formData();
			const id = String(form.get('id') ?? '');
			try {
				await deleteUser(id, client);
				return { ok: true };
			} catch (err) {
				return tagged('delete', actionFailure(err, 'Could not delete the user. Try again.'));
			}
		},
	),

	setPassword: async (event) => {
		await requireRole(event, ['super_admin']);
		const { request } = event;
		const client = authedClient(event);
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		const password = String(form.get('new_password') ?? '');
		// The field is named apart from the create form's so a refusal lands
		// on the control that was submitted and never on the other drawer's.
		const problem = password ? passwordTooLong(password) : 'Enter a password.';
		if (problem) {
			return fail(400, {
				action: 'setPassword',
				error: 'Check the highlighted field.',
				fields: { new_password: problem },
			});
		}
		// A checkbox posts nothing when it is cleared, so absent means keep.
		const removePasskeys = checked(form, 'remove_passkeys');
		try {
			const saved = await setUserPassword(id, password, client, removePasskeys);
			return { ok: true, passkeysRemoved: saved?.passkeys_removed ?? 0 };
		} catch (err) {
			/*
			 * The policy lives in the engine, and its 422 names the rule that
			 * refused the password. That sentence belongs on the control, where
			 * the operator is about to type again, not in a banner above the
			 * page. Every other refusal (an unknown account, a bad body) is
			 * about the request rather than the password and goes to the banner.
			 */
			if (err instanceof ApiError && err.status === 422) {
				return fail(422, {
					action: 'setPassword',
					error: 'Check the highlighted field.',
					fields: { new_password: actionError(err, 'This password does not meet the password policy.') },
				});
			}
			return tagged('setPassword', actionFailure(err, 'Could not set the password. Try again.'));
		}
	},
};
