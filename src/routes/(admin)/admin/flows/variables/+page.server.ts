import type { Actions, PageServerLoad } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { authedClient, requireUser } from '$lib/server/authz';
import { actionFailure, tagged } from '$lib/server/action-error';
import { flowLoadOutcome } from '$lib/server/flow-load';
import { checked } from '$lib/checkbox';
import { couldNotLoad } from '$lib/outage';
import { GATE_OK, gateOf, type Gate } from '$lib/api/gate';
import { deleteVariable, listVariables, putVariable, type Variable } from '$lib/api/flows';
import { pageWindow, pastEndOffset, rowsOf, withOffset } from '$lib/api/list';
import { asked } from '$lib/server/asked';

const KEY = /^[a-z][a-z0-9_]{0,39}$/;

/**
 * The window the read names. The plugin answers every variable whatever
 * window it is asked for, so this bounds nothing today. It is the window the
 * flow editor asks for, so the two read the same list should the plugin
 * start to honor it.
 */
const ALL = 500;

/** Whether a variable matches the search: its key, or a value that is not secret. */
function matches(v: Variable, q: string): boolean {
	const needle = q.toLowerCase();
	return v.key.toLowerCase().includes(needle) || (!v.is_secret && (v.value ?? '').toLowerCase().includes(needle));
}

export const load: PageServerLoad = async (event) => {
	const { cookies, url } = event;
	const client = authedClient(event);
	const { limit, offset } = pageWindow(url, 50, 500);
	const q = (url.searchParams.get('q') ?? '').trim();
	let variables: Variable[] = [];
	let total = 0;
	let locked = false;
	// Why the list could not be read. The plugin answers it to an admin only,
	// so a reader below admin sees the role refusal and nothing to create.
	let gate: Gate = GATE_OK;
	try {
		// The plugin answers every variable in one list whatever window is
		// asked for, so the search and the window are applied here. Asking the
		// plugin for a window would hand back the whole list on every page.
		const all = rowsOf(await listVariables(client, ALL, 0));
		const found = q ? all.filter((v) => matches(v, q)) : all;
		total = found.length;
		variables = found.slice(offset, offset + limit);
	} catch (err) {
		({ locked } = flowLoadOutcome(err, { cookies, url }, 'variables'));
		if (!locked) gate = gateOf(err, couldNotLoad('variables'));
	}
	if (gate.state === 'ok' && !locked) {
		const back = pastEndOffset(variables.length, limit, offset, total);
		if (back !== null) redirect(307, withOffset(url, back));
	}
	return { variables, total, limit, offset, q, locked, gate };
};

export const actions: Actions = {
	put: async (event) => {
		await requireUser(event);
		const client = authedClient(event);
		const data = await event.request.formData();
		const key = String(data.get('key') ?? '').trim();
		const value = String(data.get('value') ?? '');
		const isSecret = checked(data, 'is_secret');
		if (!KEY.test(key)) {
			return fail(400, { action: 'put', error: 'Use lower case letters, digits and underscores for the key, starting with a letter.', key });
		}
		// A secret is write-only: the edit form shows an empty field and blank
		// means keep what is stored, so there is nothing to send.
		if (isSecret && !value && data.get('existing') === 'true') return {};
		try {
			await putVariable(client, { key, value, is_secret: isSecret });
		} catch (err) {
			const failed = actionFailure(err, 'Could not save the variable. Try again.');
			return fail(failed.status, { ...failed.data, action: 'put', key });
		}
		return { saved: key };
	},

	delete: asked(
		{
			question: 'Delete this variable?',
			detail: 'Expressions that use it will fail.',
			label: 'Delete',
		},
		async (event) => {
			await requireUser(event);
			const client = authedClient(event);
			const data = await event.request.formData();
			const key = String(data.get('key') ?? '').trim();
			try {
				await deleteVariable(client, key);
			} catch (err) {
				return tagged('delete', actionFailure(err, 'Could not delete the variable. Try again.'));
			}
		},
	),
};
