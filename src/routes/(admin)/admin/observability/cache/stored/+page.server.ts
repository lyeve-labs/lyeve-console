import type { PageServerLoad, Actions } from './$types';
import { redirect } from '@sveltejs/kit';
import { authedClient, requireRole } from '$lib/server/authz';
import { sessionTenant } from '$lib/server/session-refresh';
import { actionFailure } from '$lib/server/action-error';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import { flushAll, flushTag, listEntries, type CacheEntry } from '$lib/api/cache';
import { type Gate, GATE_OK, section } from '$lib/api/gate';
import { pageOf, pageWindow, pastEndOffset, withOffset } from '$lib/api/list';
import { couldNotLoad } from '$lib/outage';
import { asked } from '$lib/server/asked';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export const load: PageServerLoad = async (event) => {
	const { plugins, user } = await event.parent();
	const { limit, offset } = pageWindow(event.url, DEFAULT_LIMIT, MAX_LIMIT);
	// The stored keys describe every tenant, so the engine serves them to a
	// super admin only. A tenant admin's page is the flush, and never asks for
	// the keys.
	const superAdmin = user?.roles?.includes('super_admin') ?? false;
	// The plugin flushes only the request's tenant whenever the request names
	// one. A session names its own tenant, and a tenant admin's session always
	// resolves to one. Only a super admin with no tenant of their own can reach
	// the whole store, and only on an install that keeps many tenants.
	const flushScoped = Boolean(sessionTenant(event)) || !superAdmin;

	// The shell says why the page is unavailable while its plugin does not run.
	const running = !notRunning(plugins, PLUGIN.cache);
	const gate: Gate = running ? GATE_OK : { state: 'absent' };
	const entriesRead =
		running && superAdmin
			? await section(listEntries(authedClient(event), limit + 1, offset), couldNotLoad('stored entries'))
			: null;

	// A failed read of the stored keys keeps its reason. Drawn as no rows, it
	// said nothing is cached beside a counter of thousands of entries.
	let entries: { rows: CacheEntry[]; total: number | null; hasMore: boolean } = { rows: [], total: null, hasMore: false };
	let entriesGate: Gate | null = null;
	// A provider that cannot list what it holds answers an empty page with a
	// note. Drawn as an empty list, it said nothing is cached beside a counter
	// of thousands of entries.
	let unlisted = false;
	if (entriesRead) {
		if (entriesRead.ok) {
			unlisted = typeof entriesRead.value?.note === 'string' && entriesRead.value.note !== '';
			entries = pageOf(entriesRead.value, limit, offset);
			const back = pastEndOffset(entries.rows.length, limit, offset, entries.total);
			if (back !== null) redirect(307, withOffset(event.url, back));
		} else {
			entriesGate = entriesRead.gate;
		}
	}

	return {
		superAdmin,
		entries: entries.rows,
		entriesGate,
		unlisted,
		flushScoped,
		total: entries.total,
		limit,
		offset,
		hasMore: entries.hasMore,
		gate,
	};
};

export const actions: Actions = {
	// Flushing is not a clearing convenience. Every flushed key is recomputed
	// on its next request, so this is a deliberate load against the database
	// and the page says so before it happens. The plugin admits a tenant admin
	// and scopes the flush to the tenant.
	flush: asked(
		{
			question: 'Flush these cached entries?',
			detail: 'Each flushed key is computed again on its next request, which adds that load to the database immediately.',
			label: 'Flush',
		},
		async (event) => {
			await requireRole(event, ['admin', 'super_admin']);
			const client = authedClient(event);
			const form = await event.request.formData();
			const tag = String(form.get('tag') ?? '').trim();
			// The plugin scopes only a tenant tag to the tenant. Any other tag is
			// flushed from every tenant's entries, so it stays with a super admin.
			if (tag) await requireRole(event, ['super_admin']);
			try {
				if (tag) await flushTag(client, tag);
				else await flushAll(client);
			} catch (err) {
				return actionFailure(err, 'Could not flush the cache. Try again.');
			}
			return { flushed: tag || 'everything' };
		},
	),
};
