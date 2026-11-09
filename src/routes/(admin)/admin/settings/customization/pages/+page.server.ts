import type { PageServerLoad, Actions } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { authedClient, requireRole } from '$lib/server/authz';
import { actionError } from '$lib/server/action-error';
import {
	EMPTY_SETTINGS,
	deleteCustomPage,
	getCustomization,
	saveCustomPage,
	slugify,
	type PageSummary,
} from '$lib/api/customization';
import { openTab, roleList } from '../customization.server';
import { asked } from '$lib/server/asked';

export const load: PageServerLoad = async (event) => {
	const { user, plugins } = await event.parent();
	const { gate, custom } = await openTab(event, user, plugins);
	if (!custom) return { gate, entitled: false, settings: EMPTY_SETTINGS, pages: [] as PageSummary[] };
	return { gate, entitled: true, settings: custom.settings, pages: custom.pages };
};

export const actions: Actions = {
	createPage: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const form = await event.request.formData();
		const title = String(form.get('title') ?? '').trim();
		const slug = String(form.get('slug') ?? '').trim() || slugify(title);
		const fields: Record<string, string> = {};
		if (!title) fields.title = 'Required';
		if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(slug)) fields.slug = 'Lower-case letters, digits and hyphens';
		if (Object.keys(fields).length > 0) return fail(400, { action: 'createPage', pageError: 'Check the highlighted fields.', fields });
		try {
			const custom = await getCustomization(authedClient(event));
			if (custom.pages.some((p) => p.slug === slug)) {
				return fail(409, { action: 'createPage', pageError: `A page already uses ${slug}.`, fields: { slug: 'Taken' } });
			}
			await saveCustomPage(authedClient(event), {
				slug,
				title,
				description: '',
				roles: roleList(form),
				blocks: [],
				position: custom.pages.length,
			});
		} catch (err) {
			return fail(400, { action: 'createPage', pageError: actionError(err, 'Could not create the page. Try again.') });
		}
		redirect(303, `/admin/settings/customization/pages/${slug}`);
	},

	deletePage: asked(
		{
			question: 'Delete this page?',
			detail: 'Its menu entry is removed too, and the dashboard stops showing it.',
			label: 'Delete',
		},
		async (event) => {
			await requireRole(event, ['admin', 'super_admin']);
			const slug = String((await event.request.formData()).get('slug') ?? '');
			try {
				await deleteCustomPage(authedClient(event), slug);
				return { pageDeleted: true };
			} catch (err) {
				return fail(400, { pageDeleteError: actionError(err, 'Could not delete the page. Try again.') });
			}
		},
	),
};
