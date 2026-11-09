import type { PageServerLoad, Actions } from './$types';
import { fail, isRedirect, redirect } from '@sveltejs/kit';
import { ApiError } from '@lyeve-labs/client';
import { getSchemas } from '@lyeve-labs/client-rest';
import { authedClient, requireRole } from '$lib/server/authz';
import { actionError, actionFailure, tagged } from '$lib/server/action-error';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import {
	cancelJob,
	createSchedule,
	deleteSchedule,
	listJobs,
	listSchedules,
	setScheduleEnabled,
	startExport,
	type ExportJob,
	type ExportSchedule,
} from '$lib/api/data-export';
import { type Gate, GATE_OK, gateOf, section, type Section } from '$lib/api/gate';
import { couldNotLoad } from '$lib/outage';
import { exportConfigFrom } from '$lib/data-export-form';
import { pageWindow, pastEndOffset, withOffset } from '$lib/api/list';
import { asked } from '$lib/server/asked';

/** The plugin's own 503 when every export slot is taken. */
const EXPORTS_BUSY = 'too many concurrent exports running, try again later';

/**
 * Why a start failed, in words the reader can act on. Only the plugin's busy
 * sentence means retry. A 503 with any other sentence is an outage, and its
 * detail stays off the page.
 */
function startError(err: unknown): string {
	if (err instanceof ApiError && err.status === 503) {
		const said = (err.body as { error?: unknown } | undefined)?.error;
		if (said === EXPORTS_BUSY) return 'Too many exports are running. Wait for one to finish, then start this one.';
	}
	return actionError(err, 'Could not start the export. Try again.');
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 199;

export const load: PageServerLoad = async (event) => {
	// The page re-runs this while an export is still going, so it names the
	// dependency it invalidates rather than reloading every layout above it.
	event.depends('app:data-export');
	const { plugins } = await event.parent();
	const { limit, offset } = pageWindow(event.url, DEFAULT_LIMIT, MAX_LIMIT);

	// The shell says why the page is unavailable while its plugin does not run.
	if (notRunning(plugins, PLUGIN.dataExport)) {
		const gate: Gate = { state: 'absent' };
		const schedules: Section<ExportSchedule[]> = { ok: false, gate };
		const schemas: Section<string[]> = { ok: false, gate };
		return { jobs: [] as ExportJob[], schedules, schemas, total: 0, limit, offset, gate };
	}

	const client = authedClient(event);
	let jobs: ExportJob[] = [];
	let total = 0;
	let gate: Gate = GATE_OK;
	try {
		const page = await listJobs(client, limit, offset);
		jobs = page.data;
		total = Math.max(page.total_count, offset + jobs.length);
		const back = pastEndOffset(jobs.length, limit, offset, page.total_count);
		if (back !== null) redirect(307, withOffset(event.url, back));
	} catch (err) {
		if (isRedirect(err)) throw err;
		gate = gateOf(err, couldNotLoad('exports'));
	}

	// Schedules and the schema list are panels beside the jobs. Losing them
	// should not lose the jobs, which are what an operator came to check. Each
	// keeps its own failure, so an unread list is never drawn as an empty one.
	const unread = (): Section<never> => ({ ok: false, gate });
	const [schedules, schemas]: [Section<ExportSchedule[]>, Section<string[]>] =
		gate.state === 'ok'
			? await Promise.all([
					section(
						listSchedules(client).then((p) => p.data),
						couldNotLoad('the schedules')
					),
					section(
						getSchemas(client).then((rows) => rows.map((s) => s.name).sort((a, b) => a.localeCompare(b))),
						couldNotLoad('the content types')
					),
				])
			: [unread(), unread()];

	return { jobs, schedules, schemas, total, limit, offset, gate };
};

export const actions: Actions = {
	start: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const client = authedClient(event);
		const form = await event.request.formData();

		const name = String(form.get('name') ?? '').trim();
		if (!name) {
			return fail(400, { action: 'start' as const, error: 'Enter a name for the export.' });
		}
		const config = exportConfigFrom(form);
		if ('error' in config) return fail(400, { action: 'start' as const, error: config.error });

		try {
			const job = await startExport(client, { name, ...config.config });
			return { started: job.id };
		} catch (err) {
			return fail(400, { action: 'start' as const, error: startError(err) });
		}
	},

	cancel: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const client = authedClient(event);
		const form = await event.request.formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { action: 'cancel' as const, error: 'This form is missing its export. Reload the page and try again.' });
		try {
			await cancelJob(client, id);
			return { canceled: id };
		} catch (err) {
			return tagged('cancel', actionFailure(err, 'Could not cancel the export. Try again.'));
		}
	},

	createSchedule: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const client = authedClient(event);
		const form = await event.request.formData();

		const name = String(form.get('name') ?? '').trim();
		const cron = String(form.get('cron_expression') ?? '').trim();
		if (!name) return fail(400, { action: 'createSchedule' as const, error: 'Enter a name for the schedule.' });
		if (!cron) return fail(400, { action: 'createSchedule' as const, error: 'Choose when the schedule runs.' });
		const config = exportConfigFrom(form);
		if ('error' in config) return fail(400, { action: 'createSchedule' as const, error: config.error });

		try {
			await createSchedule(client, {
				name,
				cron_expression: cron,
				enabled: form.get('enabled') === 'true',
				export_config: config.config,
			});
			return { scheduled: name };
		} catch (err) {
			return tagged('createSchedule', actionFailure(err, 'Could not create the schedule. Try again.'));
		}
	},

	toggleSchedule: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const client = authedClient(event);
		const form = await event.request.formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { action: 'toggleSchedule' as const, error: 'This form is missing its schedule. Reload the page and try again.' });
		const enabled = form.get('enabled') === 'true';
		try {
			await setScheduleEnabled(client, id, enabled);
			return { toggled: id, enabled };
		} catch (err) {
			return tagged('toggleSchedule', actionFailure(err, 'Could not save the schedule. Try again.'));
		}
	},

	deleteSchedule: asked(
		{
			question: 'Delete this schedule?',
			detail: 'No new exports start from it. Exports it already started stay in the list.',
			label: 'Delete',
		},
		async (event) => {
			await requireRole(event, ['admin', 'super_admin']);
			const client = authedClient(event);
			const form = await event.request.formData();
			const id = String(form.get('id') ?? '');
			if (!id) return fail(400, { action: 'deleteSchedule' as const, error: 'This form is missing its schedule. Reload the page and try again.' });
			try {
				await deleteSchedule(client, id);
				return { deleted: id };
			} catch (err) {
				return tagged('deleteSchedule', actionFailure(err, 'Could not delete the schedule. Try again.'));
			}
		},
	),
};
