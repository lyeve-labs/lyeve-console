import type { PageServerLoad, Actions } from './$types';
import { fail } from '@sveltejs/kit';
import { authedClient, requireRole } from '$lib/server/authz';
import { actionFailure, tagged } from '$lib/server/action-error';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import {
	generateFeed,
	isAlreadyRunning,
	isUserId,
	readAbStats,
	refreshAll,
	type AbStats,
	readTrending,
	type TrendingItem,
} from '$lib/api/recommendations';
import { type Gate, GATE_OK, section, type Section } from '$lib/api/gate';

/** An account the preview can run for. */
interface Reader {
	id: string;
	email: string;
}

export const load: PageServerLoad = async (event) => {
	const { plugins, user } = await event.parent();
	// Reading the split takes an admin. The recompute and the per-user feed
	// are super admin, so the page says which half is available.
	const canRecompute = user.roles.includes('super_admin');

	// The shell says why the page is unavailable while its plugin does not run.
	if (notRunning(plugins, PLUGIN.recommendations)) {
		return {
			stats: null as AbStats | null,
			gate: { state: 'absent' } as Gate,
			canRecompute,
			trending: { ok: false, gate: { state: 'absent' } } as Section<TrendingItem[]>,
			readers: { ok: true, value: [] } as Section<Reader[]>,
		};
	}

	const client = authedClient(event);
	/*
	 * The accounts the preview can be run for.
	 *
	 * Offering accounts by name spares the operator a trip to another page to
	 * copy a UUID. The engine answers with a bare array and no total, so this is
	 * the first page of accounts rather than all of them, and the field still
	 * accepts a typed id for an account past it.
	 *
	 * Only for the role that may run the preview. An admin who cannot generate a
	 * feed has no reason to be handed a roster of accounts.
	 */
	const readersRead: Promise<Section<Reader[]>> = canRecompute
		? section(
				client
					.get<Reader[]>('/api/admin/users?limit=200')
					.then((rows) => (Array.isArray(rows) ? rows : [])),
				'Could not load the accounts.',
			)
		: Promise.resolve({ ok: true, value: [] });
	// The three reads are independent: a list the reader cannot see is no
	// reason to hide the split, and the reverse.
	const [trending, readers, split] = await Promise.all([
		section(readTrending(client), 'Could not load the trending list.'),
		readersRead,
		section(readAbStats(client), 'Could not load the recommendation split.'),
	]);
	return {
		stats: split.ok ? split.value : null,
		gate: split.ok ? GATE_OK : split.gate,
		canRecompute,
		trending,
		readers,
	};
};

export const actions: Actions = {
	// A 409 here means somebody else pressed the button first. Reporting it as
	// a failure sends an operator looking for a fault that is not there, so it
	// is answered as its own outcome.
	refresh: async (event) => {
		await requireRole(event, ['super_admin']);
		const client = authedClient(event);
		try {
			const result = await refreshAll(client);
			return {
				refreshed: true,
				pairs: result.similarity_pairs_computed,
				trending: result.trending_items_computed,
				feeds: result.feeds_generated,
				ms: result.duration_ms,
			};
		} catch (err) {
			if (isAlreadyRunning(err)) {
				return fail(409, {
					action: 'refresh',
					error: 'A recompute is already running. Wait for it to finish.',
				});
			}
			return tagged('refresh', actionFailure(err, 'Could not start the recompute. Try again.'));
		}
	},

	preview: async (event) => {
		await requireRole(event, ['super_admin']);
		const client = authedClient(event);
		const form = await event.request.formData();
		const userId = String(form.get('user_id') ?? '').trim();
		if (!userId) return fail(400, { action: 'preview', error: 'Enter a user id.' });
		if (!isUserId(userId)) {
			return fail(400, { action: 'preview', error: 'That is not a user id. Choose a reader by email, or paste the id from the Users page.' });
		}
		try {
			const entries = await generateFeed(client, userId);
			return { previewFor: userId, feed: entries ?? [] };
		} catch (err) {
			return tagged('preview', actionFailure(err, 'Could not generate the feed. Try again.'));
		}
	},
};
