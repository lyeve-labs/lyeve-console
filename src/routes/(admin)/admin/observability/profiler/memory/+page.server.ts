import type { Actions, PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { readMemoryTrend } from '$lib/api/profiler';
import { section } from '$lib/api/gate';
import { authedClient, loadUser } from '$lib/server/authz';
import { couldNotLoad } from '$lib/outage';
import { RESET_QUESTION, reset } from '../reset.server';
import { asked } from '$lib/server/asked';

// The snapshots describe the whole process, so the tab is a super admin's,
// like the rest of the profiler.
export const load: PageServerLoad = async (event) => {
	const user = await loadUser(event);
	if (!user.roles.includes('super_admin')) {
		error(403, 'Only a super admin can open this page.');
	}
	const memory = await section(readMemoryTrend(authedClient(event)), couldNotLoad('memory snapshots'));
	return { memory };
};

export const actions: Actions = {
	reset: asked(RESET_QUESTION, reset),
};
