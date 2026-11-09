import type { Actions, PageServerLoad } from './$types';
import { error, fail, redirect } from '@sveltejs/kit';
import { ApiError, type HttpClient } from '@lyeve-labs/client';
import { authedClient, requireUser } from '$lib/server/authz';
import { actionError, actionFailure } from '$lib/server/action-error';
import { GATE_OK, gateOf, section, type Gate } from '$lib/api/gate';
import { rowsOf, type ListEnvelope } from '$lib/api/list';
import {
	addReleaseItem,
	cancelRelease,
	conflictsOf,
	deleteRelease,
	editable,
	getRelease,
	publishRelease,
	releaseConflicts,
	removeReleaseItem,
	scheduleRelease,
	unscheduleRelease,
	updateRelease,
	type ReleaseConflict,
} from '$lib/api/content-releases';
import { couldNotLoad } from '$lib/outage';

/** What a row of the release names, read from the entry itself. */
export interface EntryLabel {
	title: string;
	schema: string;
	status: string;
}

// A release holds up to 500 entries. The page names the first hundred and
// shows the rest by id, so one load never fans out past that.
const NAMED = 100;

/** An entry the Include entry drawer offers. */
export interface EntryChoice {
	id: string;
	title: string;
	slug: string;
	schema: string;
}

/**
 * How many entries the drawer offers. The engine lists every collection by the
 * time an entry last changed, so these are the most recent. An older entry is
 * added from its own page.
 */
const CHOICES = 200;

/**
 * The entries a release can take, the ones it already holds left out. Null
 * when the read failed, and the drawer then asks for an id.
 */
async function entryChoices(client: HttpClient, holding: Set<string>): Promise<EntryChoice[] | null> {
	try {
		const res = await client.get<ListEnvelope<{ id?: unknown; title?: unknown; slug?: unknown; schema?: unknown }>>(
			`/api/admin/content?limit=${CHOICES}&offset=0`,
		);
		const text = (v: unknown) => (typeof v === 'string' ? v : '');
		return rowsOf(res)
			.filter((e): e is typeof e & { id: string } => typeof e.id === 'string' && !holding.has(e.id))
			.map((e) => ({ id: e.id, title: text(e.title), slug: text(e.slug), schema: text(e.schema) }));
	} catch {
		return null;
	}
}

async function entryLabel(client: HttpClient, id: string): Promise<EntryLabel | null> {
	try {
		const e = await client.get<{ title?: unknown; schema?: unknown; status?: unknown }>(
			`/api/admin/content/${encodeURIComponent(id)}`,
		);
		return {
			title: typeof e.title === 'string' ? e.title : '',
			schema: typeof e.schema === 'string' ? e.schema : '',
			status: typeof e.status === 'string' ? e.status : '',
		};
	} catch {
		return null;
	}
}

/** What the page says when the conflicts could not be read, which is never a report that there are none. */
const CONFLICTS_FAILED = 'Could not check for conflicts. They are checked again when the release publishes.';

export const load: PageServerLoad = async (event) => {
	const client = authedClient(event);
	let release;
	try {
		release = await getRelease(client, event.params.id);
	} catch (err) {
		if (err instanceof ApiError && err.status === 404) error(404, 'Release not found');
		const gate = gateOf(err, couldNotLoad('the release'));
		return {
			release: null,
			gate,
			conflicts: [] as ReleaseConflict[],
			conflictsRead: false,
			conflictsGate: GATE_OK as Gate,
			labels: {} as Record<string, EntryLabel | null>,
			choices: null as EntryChoice[] | null,
		};
	}
	const items = release.items ?? [];
	const [conflicts, named, choices] = await Promise.all([
		section(releaseConflicts(client, release.id), CONFLICTS_FAILED),
		Promise.all(items.slice(0, NAMED).map(async (it) => [it.entry_id, await entryLabel(client, it.entry_id)] as const)),
		// Only a release that can still change takes entries.
		editable(release) ? entryChoices(client, new Set(items.map((it) => it.entry_id))) : Promise.resolve(null),
	]);
	return {
		release,
		gate: { state: 'ok' } as const,
		conflicts: conflicts.ok ? conflicts.value : [],
		conflictsRead: conflicts.ok,
		conflictsGate: conflicts.ok ? GATE_OK : conflicts.gate,
		labels: Object.fromEntries(named) as Record<string, EntryLabel | null>,
		choices,
	};
};

/**
 * The failure for a schedule or a publish. A 409 carries the conflicts that
 * stopped it, which the page lists against the entries they name.
 */
function goOutFailure(action: string, err: unknown, fallback: string) {
	const conflicts = conflictsOf(err);
	if (conflicts) {
		return fail(409, { action, error: actionError(err, fallback), conflicts });
	}
	return failed(action, err, fallback);
}

/**
 * A refused write named by its action. The edit and include drawers share
 * one `form` result with the hidden publish, cancel, delete and remove forms,
 * so each drawer shows only its own action's failure.
 */
function failed(action: string, err: unknown, fallback: string) {
	const out = actionFailure(err, fallback);
	return fail(out.status, { ...out.data, action });
}


export const actions: Actions = {
	update: async (event) => {
		await requireUser(event);
		const form = await event.request.formData();
		const name = String(form.get('name') ?? '').trim();
		const description = String(form.get('description') ?? '').trim();
		if (!name) return fail(400, { action: 'update', error: 'Check the highlighted fields.', fields: { name: 'Enter a name.' } });
		try {
			await updateRelease(authedClient(event), event.params.id, { name, description });
		} catch (err) {
			return failed('update', err, 'Could not save the release. Try again.');
		}
		return { saved: true };
	},

	addItem: async (event) => {
		await requireUser(event);
		const form = await event.request.formData();
		const entryId = String(form.get('entry_id') ?? '').trim();
		const action = String(form.get('action') ?? '');
		if (!entryId) return fail(400, { action: 'addItem', error: 'Check the highlighted fields.', fields: { entry_id: 'Choose an entry.' } });
		if (action !== 'publish' && action !== 'unpublish') {
			return fail(400, { action: 'addItem', error: 'Choose whether the release publishes or unpublishes this entry.' });
		}
		try {
			await addReleaseItem(authedClient(event), event.params.id, entryId, action);
		} catch (err) {
			return failed('addItem', err, 'Could not add the entry. Try again.');
		}
		return { added: entryId };
	},

	removeItem: async (event) => {
		await requireUser(event);
		const form = await event.request.formData();
		const entryId = String(form.get('entry_id') ?? '').trim();
		if (!entryId) return fail(400, { action: 'removeItem', error: 'This form is missing its entry. Reload the page and try again.' });
		try {
			await removeReleaseItem(authedClient(event), event.params.id, entryId);
		} catch (err) {
			return failed('removeItem', err, 'Could not remove the entry. Try again.');
		}
		return { removed: entryId };
	},

	schedule: async (event) => {
		await requireUser(event);
		const form = await event.request.formData();
		// The browser converts the picked local time to UTC, because the server
		// does not know the operator's time zone.
		const at = String(form.get('publish_at') ?? '').trim();
		if (!at || Number.isNaN(Date.parse(at))) {
			return fail(400, { action: 'schedule', error: 'Check the highlighted fields.', fields: { publish_at: 'Choose when the release publishes.' } });
		}
		try {
			await scheduleRelease(authedClient(event), event.params.id, new Date(at).toISOString());
		} catch (err) {
			return goOutFailure('schedule', err, 'Could not schedule the release. Try again.');
		}
		return { scheduled: true };
	},

	unschedule: async (event) => {
		await requireUser(event);
		try {
			await unscheduleRelease(authedClient(event), event.params.id);
		} catch (err) {
			return failed('unschedule', err, 'Could not remove the schedule. Try again.');
		}
		return { unscheduled: true };
	},

	publish: async (event) => {
		await requireUser(event);
		try {
			await publishRelease(authedClient(event), event.params.id);
		} catch (err) {
			return goOutFailure('publish', err, 'Could not publish the release. Try again.');
		}
		return { published: true };
	},

	cancel: async (event) => {
		await requireUser(event);
		try {
			await cancelRelease(authedClient(event), event.params.id);
		} catch (err) {
			return failed('cancel', err, 'Could not cancel the release. Try again.');
		}
		return { canceled: true };
	},

	delete: async (event) => {
		await requireUser(event);
		try {
			await deleteRelease(authedClient(event), event.params.id);
		} catch (err) {
			return failed('delete', err, 'Could not delete the release. Try again.');
		}
		redirect(303, '/admin/releases');
	},
};


