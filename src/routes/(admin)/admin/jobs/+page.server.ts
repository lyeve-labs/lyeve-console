import type { PageServerLoad, Actions } from './$types';
import { error, fail, redirect } from '@sveltejs/kit';
import type { HttpClient } from '@lyeve-labs/client';
import { authedClient, loadUser, requireRole } from '$lib/server/authz';
import { actionFailure } from '$lib/server/action-error';
import { checked } from '$lib/checkbox';
import { alertsFrom, type AlertConfig } from '$lib/api/cron-alerts';
import { section, type Gate, type Section } from '$lib/api/gate';
import { pageOf, pageWindow, pastEndOffset, withOffset } from '$lib/api/list';
import { couldNotLoad } from '$lib/outage';
import { asked } from '$lib/server/asked';

export interface Job {
	id: string;
	name: string;
	description: string;
	schedule: string;
	endpoint: string;
	payload: Record<string, unknown> | null;
	enabled: boolean;
	last_run_at: string | null;
	last_status: string | null;
	created_at: string;
	updated_at: string;
	/** Failure alerts, absent when the engine does not send them. */
	alerts?: AlertConfig | null;
	consecutive_failures?: number;
}

/** The page size when a request names none. */
const DEFAULT_LIMIT = 50;

/**
 * One below the engine's list ceiling, because the request below asks for a row
 * past the page to learn whether another page exists. At the ceiling that extra
 * row would be clamped away and the last page would always look like the last
 * page.
 */
const MAX_LIMIT = 199;

/** What the page says for a list read that failed for no reason it can name. */
const LIST_FAILED = couldNotLoad('jobs');

async function listJobs(
	client: HttpClient,
	limit: number,
	offset: number
): Promise<Job[]> {
	// GET /api/admin/jobs returns a bare array. Reading a `jobs` wrapper that
	// is not there resolves to undefined and renders an empty list.
	const res = await client.get<Job[] | { jobs: Job[] }>(
		`/api/admin/jobs?limit=${limit}&offset=${offset}`
	);
	return Array.isArray(res) ? res : (res?.jobs ?? []);
}

export const load: PageServerLoad = async (event) => {
	const { url } = event;
	const user = await loadUser(event);
	if (!user.roles.includes('super_admin')) error(403, 'Only a super admin can open this page.');
	const client = authedClient(event);
	const { limit, offset } = pageWindow(url, DEFAULT_LIMIT, MAX_LIMIT);

	/*
	 * Neither shape this endpoint answers with carries a row count, so there is
	 * no collection total to state and a numbered pager could only be built by
	 * inventing one. The extra row asked for here is a probe: it says whether a
	 * next page exists and nothing more, and it is dropped before the page sees
	 * it.
	 */
	const read = await section(listJobs(client, limit + 1, offset), LIST_FAILED);
	// The page draws the gate in place of the list. Nothing was read, so the
	// drawer stays shut whatever the address asks for.
	if (!read.ok) return { jobs: read, limit, offset, hasMore: false, openNew: false, openJob: null, openGate: null };
	const page = pageOf<Job>(read.value, limit, offset);
	const back = pastEndOffset(page.rows.length, limit, offset, null);
	if (back !== null) redirect(307, withOffset(url, back));

	// The drawer is addressable. `?new=1` opens it empty and `?edit=<id>` opens
	// it on that job, which is how the dashboard's "Open job" link lands on the
	// list. A job off this page is read on its own so the link still opens it.
	const openNew = url.searchParams.get('new') === '1';
	const editId = url.searchParams.get('edit');
	let openJob: Job | null = null;
	let openGate: Gate | null = null;
	if (editId) {
		const onPage = page.rows.find((j) => j.id === editId);
		const linked = onPage ? { ok: true as const, value: onPage } : await readJob(client, editId);
		if (linked.ok) openJob = linked.value;
		else openGate = linked.gate;
	}
	// Typed, because a bare literal widens `ok` to boolean and the page could
	// no longer tell the two cases apart.
	const jobs: Section<Job[]> = { ok: true, value: page.rows };
	return { jobs, limit, offset, hasMore: page.hasMore, openNew, openJob, openGate };
};

/** The job a link names, or why the drawer cannot open on it. An answer without a job is one that was not found. */
async function readJob(client: HttpClient, id: string): Promise<Section<Job>> {
	// GET /api/admin/jobs/{id} returns the job itself. Reading a `job`
	// wrapper that is not there yields undefined, and the edit form would
	// render every field blank for a job that exists.
	const read = await section(client.get<Job | { job: Job }>(`/api/admin/jobs/${encodeURIComponent(id)}`), couldNotLoad('the linked job'));
	if (!read.ok) return read;
	const job = 'job' in read.value ? read.value.job : read.value;
	return job?.id ? { ok: true, value: job } : { ok: false, gate: { state: 'absent' } };
}

/** Which write a failure came from, so the drawer shows only its own. */
type JobAction = 'create' | 'update' | 'delete';

/** A failed write, tagged with the action that failed. */
function failed(action: JobAction, err: unknown, fallback: string) {
	const out = actionFailure(err, fallback);
	return fail(out.status, { ...out.data, action });
}

/** The body both writes send, or the one sentence that stops them. */
function jobBody(form: FormData): { body: Record<string, unknown> } | { error: string } {
	const body: Record<string, unknown> = {
		name: String(form.get('name') ?? '').trim(),
		description: String(form.get('description') ?? '').trim(),
		schedule: String(form.get('schedule') ?? '').trim(),
		endpoint: String(form.get('endpoint') ?? '').trim(),
		enabled: checked(form, 'enabled'),
		payload: null,
	};
	const payloadRaw = String(form.get('payload') ?? '').trim();
	if (payloadRaw) {
		try {
			body.payload = JSON.parse(payloadRaw);
		} catch {
			return { error: 'Enter the payload as valid JSON.' };
		}
	} else if (form.get('had_payload') === 'true') {
		// The cron plugin reads a null payload as "leave it", so a cleared
		// field would keep the old payload. An empty object is the nearest
		// clear it accepts, and the form says so.
		body.payload = {};
	}
	if (!body.name || !body.schedule || !body.endpoint) {
		return { error: 'Enter a name, a cron schedule and an endpoint URL.' };
	}
	const alerts = alertsFrom(form);
	if (alerts !== undefined) body.alerts = alerts;
	return { body };
}

/** A job write's answer, which carries the webhook signing secret only once. */
type SavedJob = { name?: string; alert_signing_secret?: string } | undefined;

/**
 * The write that sets a new alert webhook is the only answer that carries its
 * signing secret, so the page shows it instead of redirecting past it.
 */
function signingReveal(saved: NonNullable<SavedJob>) {
	return { signingFor: String(saved.name ?? ''), signingSecret: String(saved.alert_signing_secret) };
}

export const actions: Actions = {
	create: async (event) => {
		await requireRole(event, ['super_admin']);
		const client = authedClient(event);
		const parsed = jobBody(await event.request.formData());
		if ('error' in parsed) return fail(400, { error: parsed.error, action: 'create' as const });
		let saved: SavedJob;
		try {
			saved = await client.post<SavedJob>('/api/admin/jobs', parsed.body);
		} catch (err) {
			return failed('create', err, 'Could not create the job. Try again.');
		}
		if (saved?.alert_signing_secret) return signingReveal(saved);
		redirect(303, '/admin/jobs');
	},

	update: async (event) => {
		await requireRole(event, ['super_admin']);
		const client = authedClient(event);
		const form = await event.request.formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { error: 'This form is missing its job. Reload the page and try again.', action: 'update' as const });
		const parsed = jobBody(form);
		if ('error' in parsed) return fail(400, { error: parsed.error, action: 'update' as const });
		let saved: SavedJob;
		try {
			saved = await client.put<SavedJob>(`/api/admin/jobs/${encodeURIComponent(id)}`, parsed.body);
		} catch (err) {
			return failed('update', err, 'Could not save the job. Try again.');
		}
		if (saved?.alert_signing_secret) return signingReveal(saved);
		redirect(303, '/admin/jobs');
	},

	delete: asked(
		{
			question: 'Delete this job?',
			detail: 'Its schedule stops and its run history is deleted. This cannot be undone.',
			label: 'Delete',
		},
		async (event) => {
			await requireRole(event, ['super_admin']);
			const { request } = event;
			const client = authedClient(event);
			const form = await request.formData();
			const id = form.get('id') as string;
			if (!id) return fail(400, { error: 'This form is missing its job. Reload the page and try again.', action: 'delete' as const });
			try {
				await client.delete(`/api/admin/jobs/${encodeURIComponent(id)}`);
			} catch (err) {
				const failed = actionFailure(err, 'Could not delete the job. Try again.');
				return fail(failed.status, { ...failed.data, action: 'delete' as const });
			}
			redirect(303, '/admin/jobs');
		},
	),
};
