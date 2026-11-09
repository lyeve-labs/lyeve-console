import type { PageServerLoad, Actions } from './$types';
import { fail } from '@sveltejs/kit';
import { authedClient, requireRole } from '$lib/server/authz';
import { actionError } from '$lib/server/action-error';
import { createSynonym, deleteSynonym, listSynonymGroups, parseTerms, type SynonymList } from '$lib/api/search-settings';
import { section } from '$lib/api/gate';
import { couldNotLoad } from '$lib/outage';
import { attempt } from '../attempt.server';
import { asked } from '$lib/server/asked';

export const load: PageServerLoad = async (event) => {
	const client = authedClient(event);
	// A failed read is drawn as its gate, never as no groups.
	const synonyms = await section<SynonymList>(attempt(() => listSynonymGroups(client)), couldNotLoad('synonym groups'));
	return { synonyms };
};

export const actions: Actions = {
	createSynonym: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const form = await event.request.formData();
		const baseTerm = String(form.get('base_term') ?? '').trim();
		const synonyms = parseTerms(String(form.get('synonyms') ?? ''));
		const fields: Record<string, string> = {};
		if (!baseTerm) fields.base_term = 'Enter a base term.';
		if (synonyms.length === 0) fields.synonyms = 'Enter at least one term.';
		if (Object.keys(fields).length > 0) return fail(400, { synonymError: 'Check the highlighted fields.', fields });
		try {
			await createSynonym(authedClient(event), baseTerm, baseTerm, synonyms);
			return { synonymSaved: true };
		} catch (err) {
			return fail(400, { synonymError: actionError(err, 'Could not save the synonym. Try again.') });
		}
	},

	deleteSynonym: asked(
		{
			question: 'Delete the synonyms of this term?',
			detail: 'Searches for it match only the term itself.',
			label: 'Delete',
		},
		async (event) => {
			await requireRole(event, ['admin', 'super_admin']);
			const form = await event.request.formData();
			try {
				await deleteSynonym(authedClient(event), String(form.get('id') ?? ''));
				return { synonymDeleted: true };
			} catch (err) {
				return fail(400, { synonymDeleteError: actionError(err, 'Could not delete the synonym. Try again.') });
			}
		},
	),
};
