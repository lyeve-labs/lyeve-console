import type { PageServerLoad, Actions } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { authedClient, requireRole } from '$lib/server/authz';
import { sessionTenant } from '$lib/server/session-refresh';
import { actionFailure } from '$lib/server/action-error';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import { MAX_SET_CAPTURES, createReplaySet, listCaptures, type Capture } from '$lib/api/request-capture';
import { type Gate, GATE_OK, gateOf } from '$lib/api/gate';
import { pageOf, pageWindow, pastEndOffset, withOffset } from '$lib/api/list';
import { couldNotLoad } from '$lib/outage';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export const load: PageServerLoad = async (event) => {
	const { plugins, user } = await event.parent();
	const { limit, offset } = pageWindow(event.url, DEFAULT_LIMIT, MAX_LIMIT);
	// The plugin applies no tenant filter to a super admin's read that names
	// none, so their list holds every tenant's requests.
	const superAdmin = user?.roles?.includes('super_admin') ?? false;
	// A replay set holds only captures the session's own tenant sent.
	const ownTenant = sessionTenant(event);
	const empty = {
		superAdmin,
		ownTenant,
		captures: [] as Capture[],
		total: null as number | null,
		limit,
		offset,
		hasMore: false,
		licensed: null as boolean | null,
	};

	// The shell says why the page is unavailable while its plugin does not run.
	if (notRunning(plugins, PLUGIN.requestCapture)) {
		return { ...empty, gate: { state: 'absent' } as Gate };
	}

	const client = authedClient(event);
	let gate: Gate = GATE_OK;
	let licensed: boolean | null = null;
	let page = { rows: [] as Capture[], total: null as number | null, hasMore: false };
	try {
		const read = await listCaptures(client, limit + 1, offset);
		const p = pageOf(read, limit, offset);
		page = { rows: p.rows, total: p.total, hasMore: p.hasMore };
		if (typeof read?.licensed === 'boolean') licensed = read.licensed;
	} catch (err) {
		gate = gateOf(err, couldNotLoad('captures'));
	}
	if (gate.state !== 'ok') return { ...empty, gate };
	const back = pastEndOffset(page.rows.length, limit, offset, page.total);
	if (back !== null) redirect(307, withOffset(event.url, back));

	return {
		superAdmin,
		ownTenant,
		captures: page.rows,
		total: page.total,
		limit,
		offset,
		hasMore: page.hasMore,
		licensed,
		gate,
	};
};

export const actions: Actions = {
	// The set is made here because the selection it names lives on this page.
	createSet: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const form = await event.request.formData();
		const name = String(form.get('name') ?? '').trim();
		const ids = [...new Set(form.getAll('capture_id').map((v) => String(v).trim()).filter(Boolean))];
		if (!name) return fail(400, { error: 'Enter a name for the set.', drawer: 'set' });
		if (ids.length === 0) return fail(400, { error: 'Select at least one capture.', drawer: 'set' });
		if (ids.length > MAX_SET_CAPTURES) {
			return fail(400, { error: `Select at most ${MAX_SET_CAPTURES} captures. A replay runs them all in one request.`, drawer: 'set' });
		}
		try {
			await createReplaySet(authedClient(event), { name, capture_ids: ids });
		} catch (err) {
			const failed = actionFailure(err, 'Could not create the replay set. Try again.');
			return fail(failed.status, { ...failed.data, drawer: 'set' });
		}
		return { savedSet: name };
	},
};
