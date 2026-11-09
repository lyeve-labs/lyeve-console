import type { LayoutServerLoad } from './$types';
import { authedClient, loadUser } from '$lib/server/authz';
import { aiSettingsGate } from '$lib/server/ai-load';
import { GATE_OK, section } from '$lib/api/gate';
import { getAiSettings, type AiGate } from '$lib/api/ai';

/**
 * The tenant switch, read once for every tab. It is the one route the switch
 * leaves open, so it is how a tab tells "off" from "not installed", and it is
 * the state the off panel's own switch flips.
 */
export const load: LayoutServerLoad = async (event) => {
	const user = await loadUser(event);
	const client = authedClient(event);
	const settings = await section(getAiSettings(client), (err) => aiSettingsGate(err, event));
	const aiLayoutGate: AiGate = settings.ok ? GATE_OK : settings.gate;
	return { aiSettings: settings.ok ? settings.value : null, aiLayoutGate, isSuperAdmin: user.roles.includes('super_admin') };
};
