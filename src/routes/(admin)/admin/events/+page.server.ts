import type { PageServerLoad, Actions } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { authedClient, requireRole } from '$lib/server/authz';
import { actionFailure } from '$lib/server/action-error';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import {
	listEvents,
	listReplays,
	startReplay,
	type EventRow,
	type ReplayRun,
} from '$lib/api/events';
import { type Gate, GATE_OK, section, type Section } from '$lib/api/gate';
import { pageWindow, pastEndOffset, withOffset } from '$lib/api/list';
import { instantFromWallClock } from '$lib/utils/wall-clock';
import { couldNotLoad } from '$lib/outage';
import { asked } from '$lib/server/asked';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 199;

/** How many runs the panel beside the log shows. */
const REPLAY_LIMIT = 10;

/** The latest runs and how many there are in all. */
export interface Runs {
	rows: ReplayRun[];
	total: number;
}

const NO_RUNS: Section<Runs> = { ok: true, value: { rows: [], total: 0 } };

export const load: PageServerLoad = async (event) => {
	const { plugins } = await event.parent();
	const { limit, offset } = pageWindow(event.url, DEFAULT_LIMIT, MAX_LIMIT);

	// The shell says why the page is unavailable while its plugin does not run.
	if (notRunning(plugins, PLUGIN.events)) {
		return {
			events: [] as EventRow[],
			runs: NO_RUNS,
			total: 0,
			limit,
			offset,
			gate: { state: 'absent' } as Gate,
		};
	}

	const client = authedClient(event);
	const read = await section(listEvents(client, limit, offset), couldNotLoad('the event log'));
	if (!read.ok) return { events: [] as EventRow[], runs: NO_RUNS, total: 0, limit, offset, gate: read.gate };

	const events = read.value.data ?? [];
	const back = pastEndOffset(events.length, limit, offset, read.value.total_count ?? null);
	if (back !== null) redirect(307, withOffset(event.url, back));
	const total = Math.max(read.value.total_count ?? 0, offset + events.length);

	// The run list is a panel beside the log. Losing it should not lose the
	// log, which is the page's subject, and it is never drawn as no runs.
	const runs: Section<Runs> = await section(
		listReplays(client, REPLAY_LIMIT, 0).then((p) => {
			const rows = p.data ?? [];
			return { rows, total: Math.max(p.total_count ?? 0, rows.length) };
		}),
		couldNotLoad('replay runs')
	);

	return { events, runs, total, limit, offset, gate: GATE_OK };
};

export const actions: Actions = {
	replay: asked(
		{
			question: 'Replay these events?',
			detail: 'Each event is published again to every webhook, flow, the message broker, realtime clients and email triggers. This cannot be undone.',
			label: 'Replay',
		},
		async (event) => {
			await requireRole(event, ['admin', 'super_admin']);
			const client = authedClient(event);
			const form = await event.request.formData();

			const since = String(form.get('since') ?? '').trim();
			const handler = String(form.get('handler') ?? '').trim();
			// The checkbox is absent when it is cleared, and absent must mean a
			// real replay only when the operator cleared it on purpose. The form
			// posts an explicit value so a missing field cannot fire one.
			const dryRun = String(form.get('dry_run') ?? '') !== 'false';

			if (!since) {
				return fail(400, { error: 'Choose the point to replay from.', fields: { since: 'Required' } });
			}
			const from = instantFromWallClock(since, String(form.get('since_offset') ?? ''));
			if (!from) {
				return fail(400, { error: 'Choose a date and time to replay from.' });
			}
			if (from.getTime() > Date.now()) {
				// The log holds what was published, so a window that starts in the
				// future matches nothing and reads as a silent no-op.
				return fail(400, { error: 'Choose a time in the past.' });
			}

			try {
				const run = await startReplay(client, {
					since: from.toISOString(),
					handler: handler || undefined,
					dry_run: dryRun,
				});
				return { started: run.run_id, dryRun };
			} catch (err) {
				return actionFailure(err, 'Could not start the replay. Try again.');
			}
		},
		(form) => form.get('dry_run') === 'false',
	),
};
