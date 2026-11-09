import type { PageServerLoad, Actions } from './$types';
import { fail } from '@sveltejs/kit';
import { authedClient, requireRole } from '$lib/server/authz';
import { actionError, actionFailure } from '$lib/server/action-error';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import {
	createProvider,
	deleteProvider,
	providerBodyFrom,
	updateProvider,
	listProviders,
	testMessage,
	testPassed,
	testProvider,
	type StorageProvider,
} from '$lib/api/storage';
import { type Gate, GATE_OK, gateOf } from '$lib/api/gate';
import { rowsOf } from '$lib/api/list';
import { asked } from '$lib/server/asked';

export const load: PageServerLoad = async (event) => {
	const { plugins, user } = await event.parent();
	// Creating and changing a provider is super admin only on the engine, so
	// the form is offered to super admins only.
	const canConfigure = (user?.roles ?? []).includes('super_admin');

	const client = authedClient(event);
	let providers: StorageProvider[] = [];
	// The shell says why the page is unavailable while its plugin does not run.
	let gate: Gate = notRunning(plugins, PLUGIN.storage) ? { state: 'absent' } : GATE_OK;
	if (gate.state === 'ok') {
		try {
			providers = rowsOf(await listProviders(client));
		} catch (err) {
			gate = gateOf(err, 'Could not load storage providers.');
		}
	}

	return { providers, gate, canConfigure };
};

export const actions: Actions = {
	// The test route answers 200 for a provider that failed its ping too, so
	// only an explicit healthy in the body is a pass.
	test: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const client = authedClient(event);
		const form = await event.request.formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { error: 'This form is missing its provider. Reload the page and try again.' });
		try {
			const result = await testProvider(client, id);
			if (!testPassed(result)) {
				return fail(400, { error: `The provider test failed: ${testMessage(result)}` });
			}
			return { tested: id };
		} catch (err) {
			const failed = actionFailure(err, 'Could not test the provider. Try again.');
			return fail(failed.status, failed.data);
		}
	},

	create: async (event) => {
		await requireRole(event, ['super_admin']);
		const parsed = providerBodyFrom(await event.request.formData(), true);
		if ('error' in parsed) return fail(400, { action: 'create', providerError: parsed.error });
		try {
			const created = await createProvider(authedClient(event), parsed.body);
			return { saved: created.name ?? parsed.body.name };
		} catch (err) {
			return fail(400, { action: 'create', providerError: actionError(err, 'Could not create the provider. Try again.') });
		}
	},

	update: async (event) => {
		await requireRole(event, ['super_admin']);
		const form = await event.request.formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { action: 'update', providerError: 'This form is missing its provider. Reload the page and try again.' });
		const parsed = providerBodyFrom(form, false);
		if ('error' in parsed) return fail(400, { action: 'update', providerError: parsed.error });
		try {
			await updateProvider(authedClient(event), id, parsed.body);
			return { saved: parsed.body.name };
		} catch (err) {
			return fail(400, { action: 'update', providerError: actionError(err, 'Could not save the provider. Try again.') });
		}
	},

	delete: asked(
		{
			question: 'Delete this provider?',
			detail: 'Files already stored there stay where they are, but this engine can no longer read them.',
			label: 'Delete',
		},
		async (event) => {
			await requireRole(event, ['super_admin']);
			const client = authedClient(event);
			const form = await event.request.formData();
			const id = String(form.get('id') ?? '');
			if (!id) return fail(400, { error: 'This form is missing its provider. Reload the page and try again.' });
			try {
				await deleteProvider(client, id);
			} catch (err) {
				const failed = actionFailure(err, 'Could not delete the provider. Try again.');
				return fail(failed.status, failed.data);
			}
			return { removed: id };
		},
	),
};
