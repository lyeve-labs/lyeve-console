import type { Actions, PageServerLoad, RequestEvent } from './$types';
import { error, fail, redirect } from '@sveltejs/kit';
import { ApiError } from '@lyeve-labs/client';
import { authedClient, requireRole, requireUser } from '$lib/server/authz';
import { aiActionError, aiGate } from '$lib/server/ai-load';
import { GATE_OK, section } from '$lib/api/gate';
import { readProviderForm } from '$lib/server/ai-provider-form';
import { couldNotLoad } from '$lib/outage';
import { deleteProvider, getCapabilities, getProvider, listModels, updateProvider, type AiProvider } from '$lib/api/ai';

export const load: PageServerLoad = async (event) => {
	const { aiSettings } = await event.parent();
	const client = authedClient(event);
	const read = await section(getProvider(client, event.params.id), (err) => {
		// The tenant gate and a missing row both answer 404. The settings read
		// from the layout, which the gate leaves open, says which it was.
		if (err instanceof ApiError && err.status === 404 && aiSettings?.enabled !== false) {
			error(404, 'This provider no longer exists.');
		}
		return aiGate(err, event, 'providers');
	});
	return { gate: read.ok ? GATE_OK : read.gate, provider: read.ok ? read.value : null };
};

async function existing(event: RequestEvent): Promise<AiProvider | null> {
	return getProvider(authedClient(event), event.params.id).catch(() => null);
}

export const actions: Actions = {
	update: async (event) => {
		const user = await requireRole(event, ['super_admin']);
		const client = authedClient(event);
		const data = await event.request.formData();
		const read = readProviderForm(data, await existing(event), user.roles.includes('super_admin'));
		if ('error' in read) return fail(400, { scope: 'config', error: read.error });
		try {
			await updateProvider(client, event.params.id, read.input);
		} catch (err) {
			return fail(400, { scope: 'config', error: aiActionError(err, 'Could not save the provider. Try again.', 'super_admin') });
		}
		return { scope: 'config', saved: true };
	},

	delete: async (event) => {
		await requireRole(event, ['super_admin']);
		try {
			await deleteProvider(authedClient(event), event.params.id);
		} catch (err) {
			return fail(400, { scope: 'delete', error: aiActionError(err, 'Could not delete the provider. Try again.', 'super_admin') });
		}
		redirect(303, '/admin/ai/providers');
	},

	// Reads a button asks for: the provider's own model list and what one
	// model can do. Both are answered on the form prop and never stored.
	models: async (event) => {
		await requireUser(event);
		try {
			const models = await listModels(authedClient(event), event.params.id);
			return { scope: 'models', models };
		} catch (err) {
			return fail(400, { scope: 'models', error: aiActionError(err, couldNotLoad('the models from this provider')) });
		}
	},

	capabilities: async (event) => {
		await requireUser(event);
		const data = await event.request.formData();
		const model = String(data.get('model') ?? '').trim() || undefined;
		try {
			const capabilities = await getCapabilities(authedClient(event), event.params.id, model);
			return { scope: 'capabilities', capabilities };
		} catch (err) {
			return fail(400, { scope: 'capabilities', error: aiActionError(err, couldNotLoad('the capabilities')) });
		}
	},
};
