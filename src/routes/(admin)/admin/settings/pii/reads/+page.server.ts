import type { PageServerLoad } from './$types';
import { isRedirect, redirect } from '@sveltejs/kit';
import { authedClient } from '$lib/server/authz';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import { listAccessLog, type AccessEntry } from '$lib/api/pii-mask';
import { type Gate, GATE_OK, gateOf } from '$lib/api/gate';
import { pageWindow, pastEndOffset, withOffset } from '$lib/api/list';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 199;

export const load: PageServerLoad = async (event) => {
	const { plugins } = await event.parent();
	const { limit, offset } = pageWindow(event.url, DEFAULT_LIMIT, MAX_LIMIT);

	// The shell says why the page is unavailable while its plugin does not run.
	if (notRunning(plugins, PLUGIN.piiMask)) {
		return { entries: [] as AccessEntry[], total: 0, limit, offset, gate: { state: 'absent' } as Gate };
	}

	let entries: AccessEntry[] = [];
	let total = 0;
	let gate: Gate = GATE_OK;
	try {
		const page = await listAccessLog(authedClient(event), limit, offset);
		entries = page.data ?? [];
		const back = pastEndOffset(entries.length, limit, offset, page.total_count ?? null);
		if (back !== null) redirect(307, withOffset(event.url, back));
		total = Math.max(page.total_count ?? 0, offset + entries.length);
	} catch (err) {
		if (isRedirect(err)) throw err;
		// Masking runs whether or not its log can be read, so the failure says so.
		gate = gateOf(err, 'Could not load the unmasked reads. Masking is still running.');
	}

	return { entries, total, limit, offset, gate };
};
