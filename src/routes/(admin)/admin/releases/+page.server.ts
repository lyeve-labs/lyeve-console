import type { Actions, PageServerLoad } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { authedClient, requireUser } from '$lib/server/authz';
import { actionFailure } from '$lib/server/action-error';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import { GATE_OK, section, type Gate } from '$lib/api/gate';
import { couldNotLoad } from '$lib/outage';
import { pageWindow, pastEndOffset, rowsOf, statedTotal, totalOf, withOffset } from '$lib/api/list';
import { RELEASE_STATUSES, createRelease, listReleases, type Release } from '$lib/api/content-releases';

export const load: PageServerLoad = async (event) => {
	const { plugins } = await event.parent();
	const { limit, offset } = pageWindow(event.url, 50, 200);
	const raw = event.url.searchParams.get('status') ?? '';
	const status = (RELEASE_STATUSES as readonly string[]).includes(raw) ? raw : '';

	const read = notRunning(plugins, PLUGIN.content)
		? null
		: await section(listReleases(authedClient(event), status, limit, offset), couldNotLoad('releases'));
	const gate: Gate = !read ? { state: 'absent' } : read.ok ? GATE_OK : read.gate;
	const releases: Release[] = read?.ok ? rowsOf(read.value) : [];
	const total = read?.ok ? Math.max(totalOf(read.value), offset + releases.length) : 0;
	if (read?.ok) {
		const back = pastEndOffset(releases.length, limit, offset, statedTotal(read.value));
		if (back !== null) redirect(307, withOffset(event.url, back));
	}
	return { releases, total, limit, offset, status, gate };
};

export const actions: Actions = {
	create: async (event) => {
		await requireUser(event);
		const form = await event.request.formData();
		const name = String(form.get('name') ?? '').trim();
		const description = String(form.get('description') ?? '').trim();
		if (!name) {
			return fail(400, { error: 'Check the highlighted fields.', fields: { name: 'Enter a name.' } });
		}
		let created: Release;
		try {
			created = await createRelease(authedClient(event), { name, description });
		} catch (err) {
			return actionFailure(err, 'Could not create the release. Try again.');
		}
		redirect(303, `/admin/releases/${created.id}`);
	},
};
