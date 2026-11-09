import type { PageServerLoad, Actions } from './$types';
import { fail, isRedirect, redirect } from '@sveltejs/kit';
import { authedClient, requireRole } from '$lib/server/authz';
import { actionFailure } from '$lib/server/action-error';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import {
	listKeys,
	readStats,
	releaseKey,
	type IdempotencyKey,
	type IdempotencyStats,
} from '$lib/api/idempotency';
import { type Gate, GATE_OK, gateOf } from '$lib/api/gate';
import { pageOf, pageWindow, pastEndOffset, withOffset } from '$lib/api/list';
import { couldNotLoad } from '$lib/outage';
import { asked } from '$lib/server/asked';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export const load: PageServerLoad = async (event) => {
	const { plugins } = await event.parent();
	const { limit, offset } = pageWindow(event.url, DEFAULT_LIMIT, MAX_LIMIT);

	const client = authedClient(event);
	let keys: IdempotencyKey[] = [];
	let total: number | null = null;
	let hasMore = false;
	// The shell says why the page is unavailable while its plugin does not run.
	let gate: Gate = notRunning(plugins, PLUGIN.idempotency) ? { state: 'absent' } : GATE_OK;
	if (gate.state === 'ok') {
		try {
			const page = pageOf(await listKeys(client, limit + 1, offset), limit, offset);
			keys = page.rows;
			total = page.total;
			hasMore = page.hasMore;
			const back = pastEndOffset(keys.length, limit, offset, total);
			if (back !== null) redirect(307, withOffset(event.url, back));
		} catch (err) {
			if (isRedirect(err)) throw err;
			gate = gateOf(err, couldNotLoad('idempotency keys'));
		}
	}

	// The counters cover every key, the list covers a page. Read separately so
	// a page of fifty cannot be mistaken for the whole store.
	// A failed read keeps its gate, so a role refusal and an outage read
	// differently.
	const stats: { value: IdempotencyStats | null; read: boolean; gate: Gate | null } =
		gate.state === 'ok'
			? await readStats(client)
					.then((s) => ({ value: s, read: true, gate: null }))
					.catch((err: unknown) => ({
						value: null,
						read: false,
						gate: gateOf(err, couldNotLoad('the counters')),
					}))
			: { value: null, read: false, gate: null };

	return {
		keys,
		total,
		limit,
		offset,
		hasMore,
		stats: stats.value,
		statsRead: stats.read,
		statsGate: stats.gate,
		gate,
	};
};

export const actions: Actions = {
	// Releasing a key lets the next request carrying it run the handler again,
	// which is the repair for a key whose process died mid-write and the wrong
	// thing to do to one that is genuinely in flight. The plugin admits any
	// admin to the release, the same readers who can list the keys.
	release: asked(
		{
			question: 'Release this key?',
			detail: 'The next request with this key runs again. If the original request is still running, the write happens twice.',
			label: 'Release',
		},
		async (event) => {
			await requireRole(event, ['admin', 'super_admin']);
			const client = authedClient(event);
			const form = await event.request.formData();
			const key = String(form.get('key') ?? '');
			if (!key) return fail(400, { error: 'This form is missing its key. Reload the page and try again.' });
			try {
				await releaseKey(client, key);
			} catch (err) {
				return actionFailure(err, 'Could not release the key. Try again.');
			}
			return { released: key };
		},
	),
};
