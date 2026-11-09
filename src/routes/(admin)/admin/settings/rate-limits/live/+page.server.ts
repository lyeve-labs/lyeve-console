import type { PageServerLoad } from './$types';
import { authedClient } from '$lib/server/authz';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import { readStatus, type LimiterState } from '$lib/api/rate-limit';
import { type Gate, GATE_OK, section, type Section } from '$lib/api/gate';

export const load: PageServerLoad = async (event) => {
	const { plugins } = await event.parent();

	// The shell says why the page is unavailable while its plugin does not run.
	const gate: Gate = notRunning(plugins, PLUGIN.rateLimit) ? { state: 'absent' } : GATE_OK;

	// The live view is a snapshot from the process that answered, and an
	// unread one is never drawn as quiet.
	const status: Section<LimiterState[]> =
		gate.state === 'ok'
			? await section(
					readStatus(authedClient(event)).then((r) => r.buckets ?? []),
					'Could not load the live counters.',
				)
			: { ok: false, gate };

	return { status, gate };
};
