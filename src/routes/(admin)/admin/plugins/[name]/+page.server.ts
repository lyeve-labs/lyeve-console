import type { PageServerLoad } from './$types';
import { listPlugins, type PluginBreakdown } from '$lib/api/profiler';
import { detailFor } from '$lib/plugin-rows';
import { authedClient } from '$lib/server/authz';
import type { Gate } from '$lib/api/gate';
import { couldNotLoad } from '$lib/outage';

/**
 * The plugin as the shell's status report describes it, and the requests
 * the profiler sampled through it.
 *
 * Only an operator reads the status report, so for anyone else the plugin is
 * null and the page names it by its name. The profiler's ring describes every
 * tenant's traffic and answers a super admin only, so traffic is read for a
 * super admin alone. Null means it could not be read: the profiler is not
 * running, or the reader may not see it.
 */
export const load: PageServerLoad = async (event) => {
	const { params, parent } = event;
	const { user, pluginStatus } = await parent();
	const name = params.name;
	const roles = user?.roles ?? [];

	let traffic: PluginBreakdown | null = null;
	let trafficRead = false;
	if (roles.includes('super_admin')) {
		const client = authedClient(event);
		const sampled = await listPlugins(client).catch(() => null);
		if (sampled) {
			trafficRead = true;
			traffic = sampled.find((p) => p.plugin === name) ?? null;
		}
	}

	// The status report answers admins and super admins. Anyone else opening
	// the page by its address is told so, and an operator whose read failed is
	// told that, rather than shown a page with nothing on it.
	const operator = roles.some((r) => r === 'admin' || r === 'super_admin');
	const statusGate: Gate | null = !operator
		? { state: 'forbidden' }
		: pluginStatus
			? null
			: { state: 'error', message: couldNotLoad('the plugin status') };

	return {
		pluginName: name,
		statusGate,
		plugin: detailFor(pluginStatus, name),
		traffic,
		trafficRead,
		userRoles: roles,
	};
};
