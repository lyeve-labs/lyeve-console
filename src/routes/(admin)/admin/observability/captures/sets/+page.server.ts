import type { PageServerLoad, Actions } from './$types';
import { fail } from '@sveltejs/kit';
import { errorCodeOf } from '$lib/api/limits';
import { authedClient, requireRole } from '$lib/server/authz';
import { actionFailure } from '$lib/server/action-error';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import { CONFIRM_WRITES, deleteReplaySet, listReplaySets, replaySet, type ReplaySet } from '$lib/api/request-capture';
import { type Gate, GATE_OK, gateOf } from '$lib/api/gate';
import { couldNotLoad } from '$lib/outage';
import { asked } from '$lib/server/asked';

export const load: PageServerLoad = async (event) => {
	const { plugins } = await event.parent();
	const empty = { sets: [] as ReplaySet[], setsRead: false, setsGate: null as Gate | null, licensed: null as boolean | null };

	// The shell says why the page is unavailable while its plugin does not run.
	if (notRunning(plugins, PLUGIN.requestCapture)) {
		return { ...empty, gate: { state: 'absent' } as Gate };
	}

	// A failed read says so in the section and never reads as having none.
	try {
		const read = await listReplaySets(authedClient(event));
		return {
			sets: read?.data ?? [],
			setsRead: true,
			setsGate: null as Gate | null,
			licensed: typeof read?.licensed === 'boolean' ? read.licensed : null,
			gate: GATE_OK,
		};
	} catch (err) {
		return { ...empty, setsGate: gateOf(err, couldNotLoad('replay sets')), gate: GATE_OK };
	}
};

function idOf(form: FormData): string {
	return String(form.get('id') ?? '').trim();
}

export const actions: Actions = {
	deleteSet: asked(
		{
			question: 'Delete this replay set?',
			detail: 'Its captures are kept. Only the set is deleted.',
			label: 'Delete',
		},
		async (event) => {
			await requireRole(event, ['admin', 'super_admin']);
			const form = await event.request.formData();
			const id = idOf(form);
			if (!id) return fail(400, { error: 'This form is missing its replay set. Reload the page and try again.' });
			try {
				await deleteReplaySet(authedClient(event), id);
			} catch (err) {
				return actionFailure(err, 'Could not delete the replay set. Try again.');
			}
			return { removedSet: id };
		},
	),

	replaySet: asked(
		{
			question: 'Replay this set?',
			detail: 'Every request in the set runs again with your credentials in place of the ones that were redacted.',
			label: 'Replay',
		},
		async (event) => {
			await requireRole(event, ['admin', 'super_admin']);
			const form = await event.request.formData();
			const id = idOf(form);
			if (!id) return fail(400, { error: 'This form is missing its replay set. Reload the page and try again.' });
			const writes = form.get('confirm_mutating') === 'true';
			try {
				const out = await replaySet(authedClient(event), id, writes);
				return { replay: out };
			} catch (err) {
				// The plugin refuses a set holding a write before any of it runs,
				// so asking again with the writes confirmed is safe.
				if (!writes && errorCodeOf(err) === CONFIRM_WRITES) {
					return fail(428, {
						error: 'This set includes a request that writes data. Replaying it repeats the write.',
						needsWrites: id,
					});
				}
				return actionFailure(err, 'Could not replay the set. Try again.');
			}
		},
	),
};
