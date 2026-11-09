import type { PageServerLoad, Actions } from './$types';
import { fail } from '@sveltejs/kit';
import { authedClient, requireRole } from '$lib/server/authz';
import { actionFailure } from '$lib/server/action-error';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import {
	listProviders,
	readStats,
	resetCircuit,
	type CacheProvider,
	type CacheStats,
	type InactiveProvider,
} from '$lib/api/cache';
import { type Gate, GATE_OK, section } from '$lib/api/gate';
import { rowsOf } from '$lib/api/list';
import { couldNotLoad } from '$lib/outage';

export const load: PageServerLoad = async (event) => {
	const { plugins, user } = await event.parent();
	// The counters describe every tenant, so the engine serves them to a super
	// admin only. A tenant admin's overview is the providers, and never asks
	// for the rest.
	const superAdmin = user?.roles?.includes('super_admin') ?? false;

	const client = authedClient(event);
	// The shell says why the page is unavailable while its plugin does not run.
	const running = !notRunning(plugins, PLUGIN.cache);
	// The two reads are independent, so they start together. The counters are
	// a super admin's only.
	const [statsRead, providersRead] = running
		? await Promise.all([
				superAdmin ? section(readStats(client), couldNotLoad('the cache status')) : null,
				section(listProviders(client), couldNotLoad('providers')),
			])
		: [null, null];
	const gate: Gate = !running ? { state: 'absent' } : statsRead && !statsRead.ok ? statsRead.gate : GATE_OK;
	const stats: CacheStats | null = statsRead?.ok ? statsRead.value : null;

	// Providers are the half the stats hide: a tripped backend leaves the hit
	// rate plausible because a lower-priority provider picks up. Losing this
	// read must not read as every provider being healthy.
	const unread = { rows: [] as CacheProvider[], read: false, licensed: null as boolean | null, inactive: [] as InactiveProvider[] };
	const providers: typeof unread & { gate: Gate | null } =
		gate.state !== 'ok' || !providersRead
			? { ...unread, gate: null }
			: providersRead.ok
				? {
						rows: rowsOf(providersRead.value),
						read: true,
						licensed: typeof providersRead.value?.licensed === 'boolean' ? providersRead.value.licensed : null,
						inactive: providersRead.value?.inactive ?? [],
						gate: null,
					}
				: { ...unread, gate: providersRead.gate };

	return {
		superAdmin,
		stats,
		providers: providers.rows,
		providersRead: providers.read,
		providersGate: providers.gate,
		providersLicensed: providers.licensed,
		inactive: providers.inactive,
		gate,
	};
};

export const actions: Actions = {
	resetCircuit: async (event) => {
		await requireRole(event, ['super_admin']);
		const client = authedClient(event);
		const form = await event.request.formData();
		const name = String(form.get('name') ?? '').trim();
		if (!name) return fail(400, { error: 'This form is missing its provider. Reload the page and try again.' });
		try {
			await resetCircuit(client, name);
		} catch (err) {
			return actionFailure(err, 'Could not reset the circuit. Try again.');
		}
		return { reset: name };
	},
};
