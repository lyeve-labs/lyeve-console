import type { Actions, PageServerLoad } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { authedClient, requireUser } from '$lib/server/authz';
import { actionFailure, tagged } from '$lib/server/action-error';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import { pageWindow, pastEndOffset, withOffset } from '$lib/api/list';
import {
	deletePersisted,
	listPersisted,
	registerPersisted,
	togglePersisted,
	type PersistedQuery,
} from '$lib/api/graphql';
import { type Gate, GATE_OK, section, type Section } from '$lib/api/gate';
import { asked } from '$lib/server/asked';

/** The persisted queries a page shows, and the most the plugin answers at once. */
const PERSISTED_PAGE = 50;
const PERSISTED_PAGE_MAX = 200;

export const load: PageServerLoad = async (event) => {
	const { plugins } = await event.parent();
	// The shell says why the page is unavailable while its plugin does not run.
	if (notRunning(plugins, PLUGIN.graphql)) {
		const absent: Gate = { state: 'absent' };
		return {
			gate: absent,
			persisted: { ok: false, gate: absent } as Section<PersistedQuery[]>,
			persistedTotal: 0,
			limit: PERSISTED_PAGE,
			offset: 0,
		};
	}

	// The plugin answers at most 200 a page and says how many it holds, so the
	// list pages by that total.
	const { limit, offset } = pageWindow(event.url, PERSISTED_PAGE, PERSISTED_PAGE_MAX);
	let persistedTotal = 0;
	const persisted = await section(
		listPersisted(authedClient(event), limit, offset).then((r) => {
			persistedTotal = r.total;
			return r.data;
		}),
		'Could not load persisted queries.',
	);
	if (persisted.ok) {
		const back = pastEndOffset(persisted.value.length, limit, offset, persistedTotal);
		if (back !== null) redirect(307, withOffset(event.url, back));
	}
	return { gate: GATE_OK, persisted, persistedTotal, limit, offset };
};

const hashOf = async (event: Parameters<Actions[string]>[0]) => String((await event.request.formData()).get('hash') ?? '').trim();

export const actions: Actions = {
	register: async (event) => {
		await requireUser(event);
		const data = await event.request.formData();
		const query = String(data.get('query') ?? '').trim();
		if (!query) return fail(400, { action: 'register', error: 'Paste the query to allow.' });
		try {
			await registerPersisted(authedClient(event), {
				query,
				operation_name: String(data.get('operation_name') ?? '').trim(),
				description: String(data.get('description') ?? '').trim(),
			});
			return { registered: true };
		} catch (err) {
			return tagged('register', actionFailure(err, 'Could not register the query. Try again.'));
		}
	},

	toggle: async (event) => {
		await requireUser(event);
		const hash = await hashOf(event);
		if (!hash) return fail(400, { action: 'toggle', error: 'This form is missing its query. Reload the page and try again.' });
		try {
			await togglePersisted(authedClient(event), hash);
			return { toggled: hash };
		} catch (err) {
			return tagged('toggle', actionFailure(err, 'Could not enable or disable the query. Try again.'));
		}
	},

	delete: asked(
		{
			question: 'Delete this persisted query?',
			detail: 'Clients that send only its hash will be refused.',
			label: 'Delete',
		},
		async (event) => {
			await requireUser(event);
			const hash = await hashOf(event);
			if (!hash) return fail(400, { action: 'delete', error: 'This form is missing its query. Reload the page and try again.' });
			try {
				await deletePersisted(authedClient(event), hash);
				return { deleted: hash };
			} catch (err) {
				return tagged('delete', actionFailure(err, 'Could not delete the query. Try again.'));
			}
		},
	),
};
