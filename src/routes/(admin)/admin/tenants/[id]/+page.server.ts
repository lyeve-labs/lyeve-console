import type { PageServerLoad, Actions } from './$types';
import { error, fail, redirect } from '@sveltejs/kit';
import { archiveTenant, getEntitlements, getTenant, restoreTenant } from '@lyeve-labs/client-rest';
import { authedClient, loadUser, requireRole } from '$lib/server/authz';
import { actionError } from '$lib/server/action-error';
import { seatRefusal } from '$lib/api/admin-seats';
import { refusalText } from '$lib/api/refusal';
import { section, type Section } from '$lib/api/gate';
import { readError } from '$lib/server/read-error';
import { pageWindow, pastEndOffset, withOffset } from '$lib/api/list';

/** The members page size when a request names none. */
const MEMBERS_LIMIT = 50;

/** The most members one page asks for. */
const MEMBERS_MAX = 200;
import {
	featureChoices,
	findUserByEmail,
	findUserById,
	getTenantFeatures,
	grantMembership,
	listTenantMembers,
	revokeMembership,
	setTenantFeatures,
	superAdminsAmong,
	withheldFrom,
	type FeatureChoice,
	type TenantMember,
} from '$lib/api/tenant-access';
import { couldNotLoad } from '$lib/outage';
import { asked } from '$lib/server/asked';

export const load: PageServerLoad = async (event) => {
	const user = await loadUser(event);
	if (!user.roles.includes('super_admin')) error(403, 'Only a super admin can open this page.');
	const client = authedClient(event);

	// Only the engine's 404 says the tenant does not exist. A refusal or an
	// outage keeps a status of its own.
	const tenant = await getTenant(event.params.id, client).catch((err: unknown) =>
		readError(err, 'This tenant does not exist.'),
	);

	// The members are paged rather than capped, so a tenant with more than one
	// page of accounts shows every one of them a page at a time.
	const { limit, offset } = pageWindow(event.url, MEMBERS_LIMIT, MEMBERS_MAX);

	// Each half is read on its own: a members list that fails is no reason to
	// hide what the tenant may use, and the reverse. The license is read here
	// rather than taken from the shell, which reads a failed read as a license
	// with nothing in it, and an empty list here would offer only what is
	// already withheld.
	const [features, license, members] = await Promise.all([
		section(getTenantFeatures(client, tenant.slug), couldNotLoad("this tenant's features")),
		section(getEntitlements(client), couldNotLoad('the license')),
		section(
			listTenantMembers(client, tenant.slug, limit, offset),
			couldNotLoad("this tenant's members"),
		),
	]);

	// The entitlements are the signed-in super admin's, whose tenant is not
	// this one, so only `features` is read from them: the license, which is
	// the same for every tenant.
	const choices: Section<FeatureChoice[]> = !features.ok
		? features
		: !license.ok
			? license
			: { ok: true, value: featureChoices(features.value.known, license.value.features ?? [], features.value.withheld) };
	if (members.ok) {
		const back = pastEndOffset(members.value.members?.length ?? 0, limit, offset, members.value.total ?? null);
		if (back !== null) redirect(307, withOffset(event.url, back));
	}
	const people: Section<TenantMember[]> = members.ok ? { ok: true, value: members.value.members ?? [] } : members;

	// A home row lists the roles its membership sets, which can leave out the
	// account's own super_admin, and the engine signs the account in here with
	// those roles. Only the account says whether it holds super_admin. A failed
	// read leaves these rows as they are listed: their roles already lack
	// super_admin, so an edit cannot take it away. It is kept as unknown, so
	// the page says it could not tell rather than that nobody lost the role.
	const quiet = people.ok ? people.value.filter((m) => m.home && !m.roles.includes('super_admin')).map((m) => m.id) : [];
	const homeSuperAdmins: string[] | null = await superAdminsAmong(client, quiet).catch(() => null);

	return {
		tenant,
		choices,
		members: people,
		homeSuperAdmins,
		memberTotal: members.ok ? members.value.total : 0,
		limit,
		offset,
	};
};

async function tenantSlug(event: Parameters<Actions[string]>[0]): Promise<string> {
	const tenant = await getTenant(event.params.id ?? '', authedClient(event));
	return tenant.slug;
}

export const actions: Actions = {
	features: async (event) => {
		await requireRole(event, ['super_admin']);
		const form = await event.request.formData();
		const offered = form.getAll('offered').map(String);
		const available = form.getAll('available').map(String);
		try {
			const slug = await tenantSlug(event);
			const saved = await setTenantFeatures(authedClient(event), slug, withheldFrom(offered, available));
			return { featuresSaved: saved.withheld.length };
		} catch (err) {
			return fail(400, { featuresError: actionError(err, "Could not save this tenant's features. Try again.") });
		}
	},

	grant: async (event) => {
		await requireRole(event, ['super_admin']);
		const form = await event.request.formData();
		const email = String(form.get('email') ?? '').trim();
		const userId = String(form.get('user_id') ?? '').trim();
		const roles = form.getAll('roles').map(String).filter(Boolean);
		if (!userId && !email) return fail(400, { action: 'grant', memberError: 'Enter the account email.', fields: { email: 'Enter the account email.' } });
		if (roles.length === 0) return fail(400, { action: 'grant', memberError: 'Choose at least one role.', fields: { roles: 'Choose at least one role.' } });
		const client = authedClient(event);
		try {
			const slug = await tenantSlug(event);
			const found = userId ? await findUserById(client, userId) : await findUserByEmail(client, email);
			if (!found && !userId) {
				return fail(404, { action: 'grant', memberError: `No account uses ${email}. Create it on the Users page first.`, fields: { email: 'No such account' } });
			}
			// An account the lookup did not reach could be a super admin at home
			// here, so nothing is saved for it.
			if (!found) {
				return fail(404, { action: 'grant', memberError: 'This account no longer exists.' });
			}
			// A membership in the home tenant replaces the account's roles when it
			// signs in there. Written for a super admin, it would either drop
			// super_admin or hold it past a removal on the Users page.
			if (found && found.tenant_id === slug && (found.roles ?? []).includes('super_admin')) {
				return fail(409, {
					action: 'grant',
					memberError: `${found.email} is a super admin whose home tenant is this one. Change their roles on the Users page.`,
					fields: userId ? undefined : { email: 'Managed on the Users page' },
				});
			}
			await grantMembership(client, found.id, slug, roles);
			return { memberSaved: true };
		} catch (err) {
			const full = seatRefusal(err);
			if (full) return fail(402, { action: 'grant', memberError: refusalText(full), refused: full });
			return fail(400, { action: 'grant', memberError: actionError(err, 'Could not save the membership. Try again.') });
		}
	},

	revoke: asked(
		{
			question: 'Remove this account from this tenant?',
			detail: 'The account keeps its home tenant and every other membership. Its open sessions here end at their next refresh.',
			label: 'Delete',
		},
		async (event) => {
			await requireRole(event, ['super_admin']);
			const form = await event.request.formData();
			const userId = String(form.get('user_id') ?? '');
			try {
				await revokeMembership(authedClient(event), userId, await tenantSlug(event));
				return { memberRevoked: true };
			} catch (err) {
				return fail(400, { action: 'revoke', memberError: actionError(err, 'Could not remove the membership. Try again.') });
			}
		},
	),

	archive: asked(
		{
			question: 'Archive this tenant?',
			detail: 'The tenant stays readable, but every change is refused until you restore it.',
			label: 'Archive',
		},
		async (event) => {
			await requireRole(event, ['super_admin']);
			try {
				await archiveTenant(event.params.id ?? '', authedClient(event));
				return { archived: true };
			} catch (err) {
				return fail(400, { stateError: actionError(err, 'Could not archive the tenant. Try again.') });
			}
		},
	),

	restore: async (event) => {
		await requireRole(event, ['super_admin']);
		try {
			await restoreTenant(event.params.id ?? '', authedClient(event));
			return { restored: true };
		} catch (err) {
			return fail(400, { stateError: actionError(err, 'Could not restore the tenant. Try again.') });
		}
	},
};
