import type { PageServerLoad, Actions } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { authedClient, requireRole } from '$lib/server/authz';
import { actionFailure, tagged } from '$lib/server/action-error';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import {
	cancelJob,
	getJob,
	listJobs,
	listRows,
	rollbackJob,
	type ImportJob,
	type ImportRow,
	type ImportSchema,
	type MappingTemplate,
} from '$lib/api/bulk-import';
import { type Gate, GATE_OK, section, type Section } from '$lib/api/gate';
import { pageOf, pageWindow, pastEndOffset, withOffset } from '$lib/api/list';
import { couldNotLoad } from '$lib/outage';
import { readSchemas, readTemplates } from './reads.server';
import { asked } from '$lib/server/asked';

/** The job the history's Rows button opened, with the rows it rejected and skipped. */
export interface ImportDetail {
	job: ImportJob;
	rejected: ImportRow[];
	rejectedTotal: number;
	skipped: ImportRow[];
	skippedTotal: number;
}

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
/** How many rejected rows the detail panel lists. The download has them all. */
const DETAIL_ROWS = 100;

export const load: PageServerLoad = async (event) => {
	// Re-run while an import is still going, without reloading the layouts.
	event.depends('app:imports');
	const { plugins } = await event.parent();
	const { limit, offset } = pageWindow(event.url, DEFAULT_LIMIT, MAX_LIMIT);

	const client = authedClient(event);
	// The shell says why the page is unavailable while its plugin does not run.
	const jobsRead = notRunning(plugins, PLUGIN.bulkImport)
		? null
		: await section(
				listJobs(client, limit + 1, offset).then((res) => pageOf(res, limit, offset)),
				couldNotLoad('imports'),
			);
	const gate: Gate = !jobsRead ? { state: 'absent' } : jobsRead.ok ? GATE_OK : jobsRead.gate;
	const page = jobsRead?.ok ? jobsRead.value : null;
	if (page) {
		const back = pastEndOffset(page.rows.length, limit, offset, page.total);
		if (back !== null) redirect(307, withOffset(event.url, back));
	}
	const jobs: ImportJob[] = page?.rows ?? [];
	const total = page?.total ?? null;
	const hasMore = page?.hasMore ?? false;

	const schemas: Section<ImportSchema[]> = gate.state === 'ok' ? await readSchemas(client) : { ok: false, gate };

	// Read here so the panel is a link, not a script. A failed read still
	// opens the panel, which says why it holds no rows.
	let detail: Section<ImportDetail> | null = null;
	const jobId = event.url.searchParams.get('job');
	if (jobId && gate.state === 'ok') {
		detail = await section(
			Promise.all([
				getJob(client, jobId),
				listRows(client, jobId, 'errored', DETAIL_ROWS),
				listRows(client, jobId, 'skipped', DETAIL_ROWS),
			]).then(([job, rejected, skipped]) => ({
				job,
				rejected: rejected.rows,
				rejectedTotal: rejected.total,
				skipped: skipped.rows,
				skippedTotal: skipped.total,
			})),
			couldNotLoad('the rows of this import')
		);
	}

	// The wizard offers the saved mappings, and whether this install may name
	// a paid transform. An unread list offers none, and the wizard says so
	// unless the plugin serves no templates or the reader may not read them.
	const templates = gate.state === 'ok' ? await readTemplates(client) : null;

	return {
		jobs,
		total,
		limit,
		offset,
		hasMore,
		gate,
		schemas,
		detail,
		templates: templates?.rows ?? ([] as MappingTemplate[]),
		templatesFailed: ['busy', 'unavailable', 'error'].includes(templates?.gate?.state ?? ''),
		licensed: templates?.licensed ?? null,
	};
};

export const actions: Actions = {
	cancel: asked(
		{
			question: 'Cancel this import?',
			detail: 'The import stops where it is. Rows it already wrote stay, and canceling does not undo them.',
			label: 'Cancel import',
		},
		async (event) => {
			await requireRole(event, ['admin', 'super_admin']);
			const client = authedClient(event);
			const form = await event.request.formData();
			const id = String(form.get('id') ?? '');
			if (!id) return fail(400, { action: 'cancel', error: 'This form is missing its import. Reload the page and try again.' });
			try {
				await cancelJob(client, id);
			} catch (err) {
				return tagged('cancel', actionFailure(err, 'Could not cancel the import. Try again.'));
			}
			return { canceled: id };
		},
	),

	// Removes the entries the job created. Offered only where there is one to
	// remove, since a dry run wrote nothing and a rollback of one would be a
	// no-op dressed as a repair. The engine takes it from any admin, so the
	// admin who ran a bad import can undo it.
	rollback: asked(
		{
			question: 'Roll back this import?',
			detail: 'The entries it created are deleted, with any edits made to them since. Entries it updated keep the imported values. The history of the import stays.',
			label: 'Roll back',
		},
		async (event) => {
			await requireRole(event, ['admin', 'super_admin']);
			const client = authedClient(event);
			const form = await event.request.formData();
			const id = String(form.get('id') ?? '');
			if (!id) return fail(400, { action: 'rollback', error: 'This form is missing its import. Reload the page and try again.' });
			try {
				await rollbackJob(client, id);
			} catch (err) {
				return tagged('rollback', actionFailure(err, 'Could not roll back the import. Try again.'));
			}
			return { rolledBack: id };
		},
	),
};
