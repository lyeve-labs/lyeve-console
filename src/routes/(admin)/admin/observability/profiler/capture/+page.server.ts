import type { Actions, PageServerLoad } from './$types';
import { ApiError } from '@lyeve-labs/client';
import { error, fail } from '@sveltejs/kit';
import { captureFlamegraph, clampSeconds } from '$lib/api/profiler';
import { actionFailure } from '$lib/server/action-error';
import { authedClient, loadUser, requireRole } from '$lib/server/authz';

// The tab reads nothing. A capture blocks for its window, so it runs only
// when the reader asks for one, and a profile carries process memory, so the
// tab is a super admin's.
export const load: PageServerLoad = async (event) => {
	const user = await loadUser(event);
	if (!user.roles.includes('super_admin')) {
		error(403, 'Only a super admin can open this page.');
	}
	return {};
};

export const actions: Actions = {
	flamegraph: async (event) => {
		await requireRole(event, ['super_admin']);
		const data = await event.request.formData();
		const endpoint = String(data.get('endpoint') ?? '').trim();
		const seconds = clampSeconds(data.get('duration_sec'));
		if (!endpoint) return fail(422, { form: 'flamegraph' as const, error: 'Enter an endpoint to label the flamegraph.' });
		try {
			const graph = await captureFlamegraph(authedClient(event), endpoint, seconds);
			return { form: 'flamegraph' as const, graph };
		} catch (err) {
			if (err instanceof ApiError && err.status === 403) {
				return fail(403, { form: 'flamegraph' as const, error: 'Only a super admin can capture a profile.' });
			}
			const failed = actionFailure(err, 'Could not capture the flamegraph. Try again.');
			return fail(failed.status, { ...failed.data, form: 'flamegraph' as const });
		}
	},
};
