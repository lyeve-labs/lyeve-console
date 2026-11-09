import type { PageServerLoad } from './$types';
import { getPluginStatus, type PluginStatus } from '@lyeve-labs/client-rest';
import { GATE_OK, gateOf, type Gate } from '$lib/api/gate';
import { authedClient, loadUser } from '$lib/server/authz';
import { couldNotLoad } from '$lib/outage';

/**
 * The plugin status, read on every visit rather than taken from the shell's
 * copy, because this page is where an operator comes to see what the engine
 * reports now. Every row comes from it, so a failed read is said as a failure
 * and the page lists nothing it could not read. The failure is the engine's
 * status sorted into a gate, never its text: a role refusal is not an outage,
 * and a body from a failing engine can carry driver text.
 */
export const load: PageServerLoad = async (event) => {
	await loadUser(event);
	const client = authedClient(event);

	return getPluginStatus(client).then(
		(report) => ({ plugins: report.plugins ?? [], gate: GATE_OK as Gate }),
		(err: unknown) => ({
			plugins: [] as PluginStatus[],
			gate: gateOf(err, couldNotLoad('the plugin status')),
		}),
	);
};
