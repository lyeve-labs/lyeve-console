import type { PageServerLoad, Actions } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { authedClient, requireRole } from '$lib/server/authz';
import { actionFailure, tagged } from '$lib/server/action-error';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import {
	createExperiment,
	deleteExperiment,
	listExperiments,
	transition,
	updateExperiment,
	type Experiment,
	type Transition,
} from '$lib/api/ab-testing';
import { type Gate, GATE_OK, section } from '$lib/api/gate';
import { couldNotLoad } from '$lib/outage';
import { pageOf, pageWindow, pastEndOffset, withOffset } from '$lib/api/list';
import { asked } from '$lib/server/asked';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const MOVES: readonly Transition[] = ['start', 'pause', 'resume', 'stop'];

/**
 * The significance threshold is a confidence level, which is how the engine
 * reads it: a variant is significant when its p-value is below one minus the
 * threshold, so 0.95 asks for p below 0.05. Below 0.5 a coin toss passes, and
 * at 1 nothing ever does. The engine takes the whole range, because a restore
 * writes back whatever was stored.
 */
const DEFAULT_CONFIDENCE = 0.95;
const MIN_CONFIDENCE = 0.5;
const MAX_CONFIDENCE = 0.999;

/** A field left empty takes the fallback. One that does not parse is NaN. */
function numberOr(raw: FormDataEntryValue | null, fallback: number): number {
	const text = String(raw ?? '').trim();
	return text === '' ? fallback : Number(text);
}

export const load: PageServerLoad = async (event) => {
	const { plugins } = await event.parent();
	const { limit, offset } = pageWindow(event.url, DEFAULT_LIMIT, MAX_LIMIT);

	// The shell says why the page is unavailable while its plugin does not run.
	if (notRunning(plugins, PLUGIN.abTesting)) {
		return {
			experiments: [] as Experiment[],
			total: null as number | null,
			limit,
			offset,
			hasMore: false,
			gate: { state: 'absent' } as Gate,
		};
	}

	const client = authedClient(event);
	const read = await section(
		listExperiments(client, limit + 1, offset).then((res) => pageOf(res, limit, offset)),
		couldNotLoad('experiments'),
	);
	if (!read.ok) {
		return { experiments: [] as Experiment[], total: null as number | null, limit, offset, hasMore: false, gate: read.gate };
	}
	const page = read.value;
	const back = pastEndOffset(page.rows.length, limit, offset, page.total);
	if (back !== null) redirect(307, withOffset(event.url, back));

	return { experiments: page.rows, total: page.total, limit, offset, hasMore: page.hasMore, gate: GATE_OK };
};

async function save(event: Parameters<Actions[string]>[0], id: string | null) {
	await requireRole(event, ['admin', 'super_admin']);
	// The drawer shows a failure only when it carries this tag, so a failed
	// delete or move never appears in it.
	const action = 'save';
	const client = authedClient(event);
	const form = await event.request.formData();

	const name = String(form.get('name') ?? '').trim();
	if (!name) return fail(400, { action, error: 'Enter a name for the experiment.' });

	const threshold = numberOr(form.get('significance_threshold'), DEFAULT_CONFIDENCE);
	if (!Number.isFinite(threshold) || threshold < MIN_CONFIDENCE || threshold > MAX_CONFIDENCE) {
		return fail(400, {
			action,
			error: `Enter a confidence level from ${MIN_CONFIDENCE} to ${MAX_CONFIDENCE}, such as ${DEFAULT_CONFIDENCE}.`,
		});
	}

	const minSample = Math.floor(numberOr(form.get('min_sample_size'), 100));
	if (!Number.isFinite(minSample) || minSample < 1) {
		return fail(400, { action, error: 'Enter at least 1 for the minimum exposures.' });
	}

	// The plugin reads an absent description as "keep" and an empty string as
	// a clear, so an edit sends the field as it stands, empty included.
	const description = String(form.get('description') ?? '').trim();
	const body = {
		name,
		description: id ? description : description || undefined,
		auto_stop_enabled: form.get('auto_stop_enabled') === 'true',
		significance_threshold: threshold,
		min_sample_size: minSample,
	};

	try {
		if (id) await updateExperiment(client, id, body);
		else await createExperiment(client, body);
	} catch (err) {
		return tagged(action, actionFailure(err, 'Could not save the experiment. Try again.'));
	}
	return { saved: name };
}

export const actions: Actions = {
	create: (event) => save(event, null),

	update: async (event) => {
		const form = await event.request.clone().formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { action: 'save', error: 'This form is missing its experiment. Reload the page and try again.' });
		return save(event, id);
	},

	delete: asked(
		{
			question: 'Delete this experiment?',
			detail: 'Its variants, metrics and recorded exposures are deleted too.',
			label: 'Delete',
		},
		async (event) => {
			await requireRole(event, ['admin', 'super_admin']);
			const client = authedClient(event);
			const form = await event.request.formData();
			const id = String(form.get('id') ?? '');
			if (!id) return fail(400, { action: 'delete', error: 'This form is missing its experiment. Reload the page and try again.' });
			try {
				await deleteExperiment(client, id);
			} catch (err) {
				return tagged('delete', actionFailure(err, 'Could not delete the experiment. Try again.'));
			}
			return { removed: id };
		},
	),

	// One action for all four moves. The engine decides whether a move is legal
	// and answers 409 naming both statuses when it is not, so the message it
	// sends is relayed rather than replaced: it says more than this side knows.
	move: asked(
		{
			question: 'Stop this experiment?',
			detail: 'A stopped experiment cannot be started again. Pause it instead if you mean to come back to it.',
			label: 'Stop',
		},
		async (event) => {
			await requireRole(event, ['admin', 'super_admin']);
			const client = authedClient(event);
			const form = await event.request.formData();
			const id = String(form.get('id') ?? '');
			const move = String(form.get('move') ?? '') as Transition;
			if (!id) return fail(400, { action: 'move', error: 'This form is missing its experiment. Reload the page and try again.' });
			if (!MOVES.includes(move)) return fail(400, { action: 'move', error: 'That change is not available for this experiment. Reload the page and try again.' });
			try {
				await transition(client, id, move);
			} catch (err) {
				return tagged('move', actionFailure(err, 'Could not change the experiment. Try again.'));
			}
			return { moved: move };
		},
		(form) => form.get('move') === 'stop',
	),
};
