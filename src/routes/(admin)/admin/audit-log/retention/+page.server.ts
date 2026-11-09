import type { PageServerLoad, Actions } from './$types';
import { fail } from '@sveltejs/kit';
import { authedClient, requireRole } from '$lib/server/authz';
import { actionFailure, tagged } from '$lib/server/action-error';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import {
	archiveFailures,
	createHold,
	createPolicy,
	deletePolicy,
	enforceNow,
	entriesDeleted,
	listHolds,
	listPolicies,
	releaseHold,
	type LegalHold,
	type RetentionPolicy,
} from '$lib/api/retention';
import { type Gate, GATE_OK, gateOf, section, type Section } from '$lib/api/gate';
import { rowsOf } from '$lib/api/list';
import { couldNotLoad } from '$lib/outage';
import { asked } from '$lib/server/asked';

export const load: PageServerLoad = async (event) => {
	const { plugins } = await event.parent();

	const client = authedClient(event);
	let policies: RetentionPolicy[] = [];
	// The shell says why the page is unavailable while its plugin does not run.
	let gate: Gate = notRunning(plugins, PLUGIN.audit) ? { state: 'absent' } : GATE_OK;
	if (gate.state === 'ok') {
		try {
			policies = rowsOf(await listPolicies(client));
		} catch (err) {
			gate = gateOf(err, couldNotLoad('the retention rules'));
		}
	}

	// The two halves have to be read together or the page lies: a policy alone
	// does not mean entries are being deleted, because a hold overrides it.
	// An unread hold list is never drawn as no holds.
	const holds: Section<LegalHold[]> =
		gate.state === 'ok'
			? await section(
					listHolds(client).then((h) => rowsOf(h)),
					couldNotLoad('the legal holds')
				)
			: { ok: false, gate };

	return { policies, holds, gate };
};

export const actions: Actions = {
	createPolicy: async (event) => {
		await requireRole(event, ['super_admin']);
		const client = authedClient(event);
		const form = await event.request.formData();

		const days = Number(form.get('retention_days'));
		if (!Number.isFinite(days) || days < 0 || !Number.isInteger(days)) {
			return fail(400, { action: 'createPolicy' as const, error: 'Enter a whole number of days, 0 or more.' });
		}
		const archival = form.get('archival_enabled') === 'true';
		const storage = String(form.get('archival_storage') ?? '').trim();
		if (archival && !storage) {
			return fail(400, {
				action: 'createPolicy' as const,
				error: 'Enter a storage backend to archive to, or turn archiving off.',
			});
		}

		try {
			await createPolicy(client, {
				event_type: String(form.get('event_type') ?? '').trim(),
				resource_type: String(form.get('resource_type') ?? '').trim(),
				retention_days: days,
				archival_enabled: archival,
				archival_storage: storage,
				archival_path_prefix: String(form.get('archival_path_prefix') ?? '').trim(),
			});
		} catch (err) {
			return tagged('createPolicy', actionFailure(err, 'Could not create the policy. Try again.'));
		}
		return { saved: 'policy' };
	},

	deletePolicy: asked(
		{
			question: 'Delete this policy?',
			detail: 'Entries it covered are no longer deleted, and the audit log grows until another policy covers them.',
			label: 'Delete',
		},
		async (event) => {
			await requireRole(event, ['super_admin']);
			const client = authedClient(event);
			const form = await event.request.formData();
			const id = String(form.get('id') ?? '');
			if (!id) return fail(400, { action: 'deletePolicy' as const, error: 'This form is missing its policy. Reload the page and try again.' });
			try {
				await deletePolicy(client, id);
			} catch (err) {
				return tagged('deletePolicy', actionFailure(err, 'Could not delete the policy. Try again.'));
			}
			return { removed: id };
		},
	),

	createHold: async (event) => {
		await requireRole(event, ['super_admin']);
		const client = authedClient(event);
		const form = await event.request.formData();
		const name = String(form.get('name') ?? '').trim();
		if (!name) {
			return fail(400, { action: 'createHold' as const, error: 'Enter a name for the hold.' });
		}
		try {
			await createHold(client, {
				name,
				description: String(form.get('description') ?? '').trim(),
				filter_action: String(form.get('filter_action') ?? '').trim(),
				filter_resource_type: String(form.get('filter_resource_type') ?? '').trim(),
				filter_resource_id: String(form.get('filter_resource_id') ?? '').trim(),
				filter_tenant_id: String(form.get('filter_tenant_id') ?? '').trim(),
			});
		} catch (err) {
			return tagged('createHold', actionFailure(err, 'Could not create the hold. Try again.'));
		}
		return { saved: name };
	},

	releaseHold: asked(
		{
			question: 'Release this legal hold?',
			detail: 'Entries this hold protected can be deleted again. If a retention policy covers them, the next enforcement run deletes them permanently.',
			label: 'Release',
		},
		async (event) => {
			await requireRole(event, ['super_admin']);
			const client = authedClient(event);
			const form = await event.request.formData();
			const id = String(form.get('id') ?? '');
			if (!id) return fail(400, { action: 'releaseHold' as const, error: 'This form is missing its hold. Reload the page and try again.' });
			try {
				await releaseHold(client, id);
			} catch (err) {
				return tagged('releaseHold', actionFailure(err, 'Could not release the hold. Try again.'));
			}
			return { released: id };
		},
	),

	// Deletes. Not a dry run, and nothing undoes it.
	enforce: asked(
		{
			question: 'Enforce retention now?',
			detail: 'Every audit entry past its retention window and not under a legal hold is deleted. This cannot be undone.',
			label: 'Delete them',
		},
		async (event) => {
			await requireRole(event, ['super_admin']);
			const client = authedClient(event);
			try {
				const run = await enforceNow(client);
				return {
					enforced: true,
					deleted: entriesDeleted(run),
					policies: run.policies_processed ?? 0,
					archiveFailed: archiveFailures(run),
				};
			} catch (err) {
				return tagged('enforce', actionFailure(err, 'Could not enforce retention. Try again.'));
			}
		},
	),
};
