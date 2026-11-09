import type { PageServerLoad } from './$types';
import { authedClient } from '$lib/server/authz';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import {
	getPlatformMetrics,
	getSocketMetrics,
	getStreamMetrics,
	type SocketMetrics,
	type StreamMetrics,
} from '$lib/api/realtime';
import { type Gate, GATE_OK, gateOf } from '$lib/api/gate';
import { couldNotLoad } from '$lib/outage';

export const load: PageServerLoad = async (event) => {
	const { user, plugins } = await event.parent();
	const superAdmin = user.roles.includes('super_admin');

	// The shell says why the page is unavailable while its plugin does not run.
	if (notRunning(plugins, PLUGIN.realtime)) {
		return {
			stream: null as StreamMetrics | null,
			socket: null as SocketMetrics | null,
			platform: null as StreamMetrics | null,
			gate: { state: 'absent' } as Gate,
			streamGate: null as Gate | null,
			socketGate: null as Gate | null,
			platformGate: null as Gate | null,
			superAdmin,
		};
	}

	const client = authedClient(event);

	// The two transports are read independently. One of them being absent is
	// the normal case for an install that pushes over the other, and folding
	// them into one request would make either failure look like both.
	const [streamRes, socketRes] = await Promise.allSettled([
		getStreamMetrics(client),
		getSocketMetrics(client),
	]);

	const stream = streamRes.status === 'fulfilled' ? streamRes.value : null;
	const socket = socketRes.status === 'fulfilled' ? socketRes.value : null;

	// The gate describes the plugin, so it is only a refusal when neither
	// transport answered. One transport failing is reported beside it.
	let gate: Gate = GATE_OK;
	if (!stream && !socket) {
		gate = gateOf(streamRes.status === 'rejected' ? streamRes.reason : undefined, couldNotLoad('realtime metrics'));
	}

	// The per-tenant roster is the operator's view and the engine gates it on
	// the role, so it is not asked for on a tenant admin's behalf.
	let platform: StreamMetrics | null = null;
	let platformGate: Gate | null = null;
	if (superAdmin && gate.state === 'ok') {
		try {
			platform = await getPlatformMetrics(client);
		} catch (err) {
			platformGate = gateOf(err, couldNotLoad('connections by tenant'));
		}
	}

	// Each transport that did not answer keeps the reason, so the page reports
	// it beside the other rather than calling it a transport nobody uses.
	const failed = (what: string) => couldNotLoad(`the ${what} counters`);
	const streamGate =
		gate.state === 'ok' && streamRes.status === 'rejected' ? gateOf(streamRes.reason, failed('server-sent events')) : null;
	const socketGate =
		gate.state === 'ok' && socketRes.status === 'rejected' ? gateOf(socketRes.reason, failed('WebSocket')) : null;

	return { stream, socket, platform, gate, streamGate, socketGate, platformGate, superAdmin };
};
