import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { forbiddenText } from '$lib/api/gate';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';

const READERS = ['admin', 'super_admin'];

export const load: PageServerLoad = async ({ parent }) => {
	const { user, plugins } = await parent();
	if (!user.roles.some((r) => READERS.includes(r))) {
		error(403, forbiddenText('this page', READERS));
	}

	// The tail is the logging plugin's stream. Without the plugin the stream is
	// refused on every attempt, so the page says so rather than opening it.
	const logTail = !notRunning(plugins, PLUGIN.logging);

	return { logTail };
};
