import type { PageServerLoad } from './$types';
import { authedClient } from '$lib/server/authz';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import {
	readStatus,
	type BrokerStatus,
} from '$lib/api/messagebroker';
import { type Gate, GATE_OK, gateOf } from '$lib/api/gate';

export const load: PageServerLoad = async (event) => {
	const { plugins, user } = await event.parent();
	// The route is super admin only, so anyone else is told rather than shown
	// a failed read they cannot do anything about.
	const permitted = user.roles.includes('super_admin');

	// The shell says why the page is unavailable while its plugin does not run.
	const absent = notRunning(plugins, PLUGIN.messagebroker);
	if (absent || !permitted) {
		return {
			status: null as BrokerStatus | null,
			gate: (absent ? { state: 'absent' } : GATE_OK) as Gate,
			permitted,
		};
	}

	const client = authedClient(event);
	try {
		return { status: await readStatus(client), gate: GATE_OK, permitted };
	} catch (err) {
		return { status: null, gate: gateOf(err, 'Could not load the broker status.'), permitted };
	}
};
