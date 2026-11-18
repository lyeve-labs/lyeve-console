import type { PageServerLoad } from './$types';
import { PLUGIN } from '#lib/plugin-names.ts';
import { runs } from '#lib/plugins.ts';

export const load: PageServerLoad = async ({ parent }) => {
	const { user, plugins } = await parent();
	return { user, remembersDevices: runs(plugins, PLUGIN.deviceFingerprint), hasMfa: runs(plugins, PLUGIN.mfa) };
};
