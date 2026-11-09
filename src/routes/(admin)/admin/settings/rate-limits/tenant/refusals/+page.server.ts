import type { PageServerLoad } from './$types';
import { authedClient } from '$lib/server/authz';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import { GATE_OK, section, type Gate, type Section } from '$lib/api/gate';
import {
	HISTORY_WINDOWS,
	listAddressEntries,
	readRefusalHistory,
	type AddressListRead,
	type RefusalHistory,
} from '$lib/api/rate-limit';

function windowOf(url: URL): number {
	const raw = url.searchParams.get('hours') ?? '24';
	return HISTORY_WINDOWS.some((w) => w.value === raw) ? Number(raw) : 24;
}

export const load: PageServerLoad = async (event) => {
	const { plugins } = await event.parent();
	const hours = windowOf(event.url);
	if (notRunning(plugins, PLUGIN.rateLimit)) {
		const gate: Gate = { state: 'absent' };
		return {
			gate,
			history: { ok: false, gate } as Section<RefusalHistory>,
			addresses: { ok: false, gate } as Section<AddressListRead>,
			hours,
		};
	}

	const client = authedClient(event);
	// The address lists name the range behind a deny refusal. Losing them
	// loses only that name, and the row shows the route instead.
	const [history, addresses] = await Promise.all([
		section(readRefusalHistory(client, hours), 'Could not load the refusal history.'),
		section(listAddressEntries(client), 'Could not load the address lists.'),
	]);

	return { gate: GATE_OK as Gate, history, addresses, hours };
};
