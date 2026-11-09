import type { PageServerLoad, Actions } from './$types';
import type { Permission, Schema } from '@lyeve-labs/client';
import { getSchemas, listPermissions, upsertPermission, deletePermission } from '@lyeve-labs/client-rest';
import { refusalOf } from '$lib/api/refusal';
import { fail, error, isHttpError, isRedirect } from '@sveltejs/kit';
import { authedClient, loadUser, requireRole } from '$lib/server/authz';
import { listAllFlows } from '$lib/api/flows';
import type { FlowOption } from '$lib/flow/types';
import { isFlowResource } from '$lib/flow/permissions';
import { getRoleLimits, type RoleLimits } from '$lib/api/permissions';
import { actionFailure, tagged } from '$lib/server/action-error';
import { gateOf, section, type Gate } from '$lib/api/gate';

// Static text. The engine's own message can carry driver or upstream detail
// that has no place in a page, and the operator's next step is the same
// whatever the cause.
const LOAD_FAILED = 'Could not load permission rules.';

export const load: PageServerLoad = async (event) => {
	const user = await loadUser(event);
	if (!user.roles.includes('super_admin')) {
		error(403, 'Only a super admin can manage row-level permissions.');
	}
	const client = authedClient(event);
	// The plugin states the role ceiling and how many roles already hold a
	// rule, the numbers it checks a new role against. A failed read, a plugin
	// without the route among them, states no ceiling: the plugin still
	// refuses a role past one, and the page reports that refusal.
	const limits = await getRoleLimits(client).catch((): RoleLimits | null => null);
	const roleCap = limits?.roles.limit ?? 0;
	const roleCount = limits?.roles.current ?? null;
	try {
		// The flows are resources beside the schemas. An instance without the
		// flow plugin answers 404 for the list, which is an empty picker, not
		// a failed read of the rules. Any other failure is said in the rule
		// form, which then offers the schemas alone.
		const [permissions, schemas, flowRead] = await Promise.all([
			listPermissions(client),
			getSchemas(client),
			section(listAllFlows(client), 'Could not load flows.'),
		]);
		const flows: FlowOption[] = flowRead.ok ? flowRead.value : [];
		const flowsFailed = !flowRead.ok && flowRead.gate.state !== 'absent';
		return { permissions, schemas, flows, flowsFailed, roleCap, roleCount, loadGate: null as Gate | null };
	} catch (err) {
		if (isRedirect(err) || isHttpError(err)) throw err;
		// An empty list alone draws exactly the matrix an instance with no rules
		// draws. On a 503 or an expired session that would tell the operator
		// nothing is restricted, and the next click would grant a rule on top of
		// rules still in the database, so the failure is named, and a busy
		// engine reads apart from a down one or an absent plugin.
		return {
			permissions: [] as Permission[],
			schemas: [] as Schema[],
			flows: [] as FlowOption[],
			flowsFailed: false,
			roleCap,
			roleCount,
			loadGate: gateOf(err, LOAD_FAILED) as Gate | null,
		};
	}
};

// The plugin refuses a role past the ceiling with 402 and a body naming the
// cap and both numbers, which the page prints.
function isRoleCapRefusal(e: unknown): boolean {
	return refusalOf(e)?.kind === 'cap';
}

export const actions: Actions = {
	upsert: async (event) => {
		await requireRole(event, ['super_admin']);
		const { request } = event;
		const form = await request.formData();
		const client = authedClient(event);

		const fieldMaskRaw = (form.get('field_mask') as string) ?? '';
		const actions = form.getAll('actions').map(String).filter(Boolean);
		// The role arrives typed by hand from the add-role form. Untrimmed,
		// "editor " becomes a second role the matrix lists next to "editor" and
		// nothing ever matches it.
		const role = ((form.get('role') as string) ?? '').trim();
		const schemaName = ((form.get('schema_name') as string) ?? '').trim();
		// The rule drawer and the new role drawer both post here. The failure
		// names the one that posted, so it shows in that drawer only.
		const action = form.get('drawer') === 'role' ? 'role' : 'rule';
		if (!role || !schemaName) {
			return fail(422, { action, error: action === 'role' ? 'Enter a role name.' : 'Choose a resource first.' });
		}
		// The engine's validator refuses activate on anything but a flow
		// resource. Refusing it here keeps the message about the form.
		if (actions.includes('activate') && !isFlowResource(schemaName)) {
			return fail(422, { action, error: 'Activate applies only to flows.' });
		}

		try {
			await upsertPermission(
				{
					role,
					schema_name: schemaName,
					actions,
					field_mask: fieldMaskRaw ? fieldMaskRaw.split(',').map((s) => s.trim()).filter(Boolean) : [],
				},
				client,
			);
		} catch (e: unknown) {
			if (isRoleCapRefusal(e)) {
				const refused = refusalOf(e);
				return fail(402, { action, roleCapReached: true, refused });
			}
			// Any other 402 is a license refusal, which the drawer renders with
			// its numbers and its link rather than as the engine's sentence.
			const failure = actionFailure(e, 'Could not save the rule. Try again.');
			return fail(failure.status, { ...failure.data, action });
		}
		return { success: true };
	},

	delete: async (event) => {
		await requireRole(event, ['super_admin']);
		const { request } = event;
		const form = await request.formData();
		const client = authedClient(event);
		const id = form.get('id') as string;
		try {
			await deletePermission(id, client);
		} catch (e: unknown) {
			return tagged('delete', actionFailure(e, 'Could not remove the rule. Try again.'));
		}
		return { success: true };
	},
};
