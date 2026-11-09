import type { PageServerLoad, Actions } from './$types';
import { fail } from '@sveltejs/kit';
import { authedClient, requireRole } from '$lib/server/authz';
import { actionError } from '$lib/server/action-error';
import { adminNav, navLeaves } from '$lib/nav';
import { EMPTY_SETTINGS, saveCustomization, type CustomLink } from '$lib/api/customization';
import { current, openTab, roleList } from '../customization.server';
import { asked } from '$lib/server/asked';

export const load: PageServerLoad = async (event) => {
	const { user, plugins } = await event.parent();
	const { gate, custom } = await openTab(event, user, plugins);
	if (!custom) return { gate, entitled: false, settings: EMPTY_SETTINGS, navChoices: [] };
	return {
		gate,
		entitled: true,
		settings: custom.settings,
		// Chosen from the stock menu this operator sees, so an entry the
		// tenant hid can be brought back.
		navChoices: navLeaves(adminNav(user.roles, { plugins })),
	};
};

export const actions: Actions = {
	menu: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const form = await event.request.formData();
		try {
			const settings = await current(event);
			settings.menu.hidden = form.getAll('hidden').map(String);
			settings.menu.pinned = form.getAll('pinned').map(String).filter((id) => !settings.menu.hidden.includes(id));
			await saveCustomization(authedClient(event), settings);
			return { menuSaved: true };
		} catch (err) {
			return fail(400, { menuError: actionError(err, 'Could not save the menu. Try again.') });
		}
	},

	addLink: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const form = await event.request.formData();
		const link: CustomLink = {
			label: String(form.get('label') ?? '').trim(),
			url: String(form.get('url') ?? '').trim(),
			roles: roleList(form),
		};
		const fields: Record<string, string> = {};
		if (!link.label) fields.label = 'Required';
		if (!/^https:\/\/\S+$/.test(link.url) && !link.url.startsWith('/admin/')) fields.url = 'An https URL or a path starting /admin/';
		if (Object.keys(fields).length > 0) return fail(400, { action: 'addLink', linkError: 'Check the highlighted fields.', fields });
		try {
			const settings = await current(event);
			settings.menu.links = [...settings.menu.links, link];
			await saveCustomization(authedClient(event), settings);
			return { linkSaved: true };
		} catch (err) {
			return fail(400, { action: 'addLink', linkError: actionError(err, 'Could not save the link. Try again.') });
		}
	},

	removeLink: asked(
		{
			question: 'Delete this link?',
			detail: 'It is removed from the menu for everyone in this tenant.',
			label: 'Delete',
		},
		async (event) => {
			await requireRole(event, ['admin', 'super_admin']);
			const index = Number((await event.request.formData()).get('index'));
			try {
				const settings = await current(event);
				settings.menu.links = settings.menu.links.filter((_, i) => i !== index);
				await saveCustomization(authedClient(event), settings);
				return { linkRemoved: true };
			} catch (err) {
				return fail(400, { menuError: actionError(err, 'Could not remove the link. Try again.') });
			}
		},
	),
};
