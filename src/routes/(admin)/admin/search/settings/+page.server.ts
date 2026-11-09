import type { PageServerLoad, Actions } from './$types';
import { fail } from '@sveltejs/kit';
import { getRanking, type RankingConfig } from '@lyeve-labs/client-rest';
import { authedClient, loadUser, requireRole } from '$lib/server/authz';
import { actionError } from '$lib/server/action-error';
import {
	getPublicSchemas,
	listSchemaNames,
	parseWeight,
	reindexSearch,
	setDefaultRanking,
	setPublicSchemas,
} from '$lib/api/search-settings';
import { section } from '$lib/api/gate';
import { couldNotLoad } from '$lib/outage';
import { attempt } from '../attempt.server';

export const load: PageServerLoad = async (event) => {
	const user = await loadUser(event);
	const client = authedClient(event);

	// Each panel is read on its own, so one the engine refuses does not blank
	// the others. A failed read is drawn as its gate, never as empty. The
	// plugin answers its default weights when none are set, so a failed
	// ranking read is a failure and never the defaults.
	const [ranking, publicSchemas, schemas] = await Promise.all([
		section<RankingConfig>(getRanking(client, '*'), couldNotLoad('ranking weights')),
		section(attempt(() => getPublicSchemas(client)), couldNotLoad('the public content type list')),
		section(attempt(() => listSchemaNames(client)), couldNotLoad('schemas')),
	]);

	return {
		ranking,
		publicSchemas,
		schemas,
		canReindex: user?.roles?.includes('super_admin') ?? false,
	};
};

export const actions: Actions = {
	publicSchemas: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const form = await event.request.formData();
		const schemas = form.getAll('schemas').map(String).filter(Boolean);
		try {
			const saved = await setPublicSchemas(authedClient(event), schemas);
			return { publicSaved: saved.length };
		} catch (err) {
			return fail(400, { publicError: actionError(err, 'Could not save the public content types. Try again.') });
		}
	},

	ranking: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const form = await event.request.formData();
		const title = parseWeight(form.get('title_weight'));
		const body = parseWeight(form.get('body_weight'));
		const tag = parseWeight(form.get('tag_weight'));
		if (title === null || body === null || tag === null) {
			return fail(400, { rankingError: 'Enter a weight from 0 to 10 for each field.' });
		}
		try {
			// The plugin replaces the whole row, so the boost rules are read again
			// and sent back. A save that cannot read them stops rather than
			// writing the row with none.
			const client = authedClient(event);
			const current = await getRanking(client, '*');
			await setDefaultRanking(client, { title_weight: title, body_weight: body, tag_weight: tag }, current.boost_rules ?? []);
			return { rankingSaved: true };
		} catch (err) {
			return fail(400, { rankingError: actionError(err, 'Could not save the weights. Try again.') });
		}
	},

	reindex: async (event) => {
		await requireRole(event, ['super_admin']);
		try {
			const res = await reindexSearch(authedClient(event));
			return { reindexed: res.indexed ?? 0, reindexMessage: res.message ?? '' };
		} catch (err) {
			return fail(400, { reindexError: actionError(err, 'Could not rebuild the index. Try again.') });
		}
	},
};
