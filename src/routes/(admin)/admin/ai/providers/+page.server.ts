import type { Actions, PageServerLoad } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { authedClient, requireRole } from '$lib/server/authz';
import { aiActionError, aiGate } from '$lib/server/ai-load';
import { GATE_OK, section } from '$lib/api/gate';
import { readProviderForm } from '$lib/server/ai-provider-form';
import { pageWindow, pastEndOffset, withOffset } from '$lib/api/list';
import { createProvider, getAiDashboard, listProviders, type AiDashboard, type AiProvider } from '$lib/api/ai';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export const load: PageServerLoad = async (event) => {
	const client = authedClient(event);
	const { limit, offset } = pageWindow(event.url, DEFAULT_LIMIT, MAX_LIMIT);

	const page = await section(listProviders(client, { limit: limit + 1, offset }), (err) => aiGate(err, event, 'providers'));
	const gate = page.ok ? GATE_OK : page.gate;
	const providers = page.ok ? page.value.rows.slice(0, limit) : [];
	const total = page.ok ? page.value.total : null;
	const hasMore = page.ok && (total === null ? page.value.rows.length > limit : offset + providers.length < total);

	const back = pastEndOffset(providers.length, limit, offset, total);
	if (back !== null) redirect(307, withOffset(event.url, back));

	// The spend row is a courtesy. A page of providers stands without it.
	const dashboard: AiDashboard | null = gate.state === 'ok' ? await getAiDashboard(client).catch(() => null) : null;

	return { gate, providers, total, limit, offset, hasMore, dashboard };
};

export const actions: Actions = {
	create: async (event) => {
		const user = await requireRole(event, ['super_admin']);
		const client = authedClient(event);
		const data = await event.request.formData();
		const read = readProviderForm(data, null, user.roles.includes('super_admin'));
		if ('error' in read) return fail(400, { error: read.error });
		let created: AiProvider;
		try {
			created = await createProvider(client, read.input);
		} catch (err) {
			return fail(400, { error: aiActionError(err, 'Could not create the provider. Try again.', 'super_admin') });
		}
		redirect(303, `/admin/ai/providers/${encodeURIComponent(created.id)}`);
	},
};
