import type { PageServerLoad } from './$types';
import { authedClient } from '$lib/server/authz';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import { readStatus, type GrpcStatus } from '$lib/api/grpc';
import { type Gate, GATE_OK, gateOf } from '$lib/api/gate';

export const load: PageServerLoad = async (event) => {
	const { plugins, user } = await event.parent();
	// The addresses describe how this process is reachable on its host, so the
	// route is super admin. Anybody else is told rather than shown a failed
	// read they cannot act on.
	const permitted = user.roles.includes('super_admin');

	// The shell says why the page is unavailable while its plugin does not run.
	const absent = notRunning(plugins, PLUGIN.grpc);
	if (absent || !permitted) {
		return {
			status: null as GrpcStatus | null,
			gate: (absent ? { state: 'absent' } : GATE_OK) as Gate,
			permitted,
		};
	}

	const client = authedClient(event);
	try {
		return { status: await readStatus(client), gate: GATE_OK, permitted };
	} catch (err) {
		return { status: null, gate: gateOf(err, 'Could not load the gRPC status.'), permitted };
	}
};
