import type { PageServerLoad, Actions } from './$types';
import { fail } from '@sveltejs/kit';
import { authedClient, requireRole } from '$lib/server/authz';
import { actionError, actionFailure } from '$lib/server/action-error';
import { listSchemaNames } from '$lib/api/search-settings';
import { ROLE_CHOICES, saveCustomization, type PageSummary } from '$lib/api/customization';
import { readPluginSet } from '$lib/plugins';
import {
	MAX_WIDGETS,
	getDashboardLayout,
	resetDashboardLayout,
	saveDashboardLayout,
	wireWidget,
	type DashboardLayout,
	type Widget,
} from '$lib/api/custom-dashboard';
import { resolveWidgets } from '$lib/server/dashboard-widgets';
import { readError } from '$lib/server/read-error';
import { GATE_OK, section } from '$lib/api/gate';
import { current, openTab } from '../customization.server';
import { asked } from '$lib/server/asked';

export const load: PageServerLoad = async (event) => {
	const { user, plugins } = await event.parent();
	const { gate, custom } = await openTab(event, user, plugins);
	if (!custom) {
		const layout: DashboardLayout = { entitled: false, custom: false, widgets: [], updated_at: null };
		return { gate, entitled: false, layout, schemas: [] as string[], schemasGate: GATE_OK, pages: [] as PageSummary[], homePage: '' };
	}
	const client = authedClient(event);
	const [layout, schemas] = await Promise.all([
		// The editor has nothing to draw without the layout, so a failed read
		// ends in the error page with a status of its own.
		getDashboardLayout(client).catch((err: unknown) =>
			readError(err, 'The dashboard editor needs a newer version of the multitenant plugin.'),
		),
		// The gate says why the list is missing, so a role refusal and an
		// outage are not one failure.
		section(
			Promise.resolve().then(() => listSchemaNames(client)),
			'Could not load content types. Widgets keep the content types they already use.',
		),
	]);
	return {
		gate,
		entitled: true,
		layout,
		schemas: schemas.ok ? schemas.value : [],
		schemasGate: schemas.ok ? GATE_OK : schemas.gate,
		pages: custom.pages,
		homePage: custom.settings.home_page,
	};
};

/** The widgets a form posted, or null when the field is not a widget list. */
function postedWidgets(form: FormData): Widget[] | null {
	try {
		const parsed = JSON.parse(String(form.get('widgets') ?? ''));
		return Array.isArray(parsed) ? (parsed as Widget[]) : null;
	} catch {
		return null;
	}
}

export const actions: Actions = {
	save: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const widgets = postedWidgets(await event.request.formData());
		if (!widgets) return fail(400, { error: 'This form is missing its layout. Reload the page and try again.' });
		if (widgets.length === 0) {
			return fail(400, { error: 'Add a widget first, or reset to go back to the stock dashboard.' });
		}
		if (widgets.length > MAX_WIDGETS) return fail(400, { error: `A dashboard can have at most ${MAX_WIDGETS} widgets.` });
		try {
			// The engine validates every widget and answers with the first
			// problem it finds, numbered, which is what the editor shows.
			await saveDashboardLayout(authedClient(event), widgets);
			return { saved: true };
		} catch (err) {
			const failed = actionFailure(err, 'Could not save the dashboard. Try again.');
			return fail(failed.status, failed.data);
		}
	},

	/*
	 * Draws the layout in the form as the chosen role would see it, before it
	 * is saved. It writes nothing. It is an action because the layout being
	 * previewed exists only in the form.
	 */
	preview: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const form = await event.request.formData();
		const widgets = postedWidgets(form);
		if (!widgets) return fail(400, { error: 'This form is missing its layout. Reload the page and try again.' });
		const asRole = String(form.get('as') ?? 'admin');
		const roles = (ROLE_CHOICES as readonly string[]).includes(asRole) ? [asRole] : ['admin'];
		const client = authedClient(event);
		const preview = await resolveWidgets(client, widgets.map(wireWidget), roles, await readPluginSet(client));
		return { preview, previewAs: roles[0], previewAt: new Date().toISOString() };
	},

	reset: asked(
		{
			question: 'Reset the dashboard?',
			detail: 'Everyone in this tenant sees the stock dashboard again, and this layout is deleted.',
			label: 'Reset',
		},
		async (event) => {
			await requireRole(event, ['admin', 'super_admin']);
			try {
				await resetDashboardLayout(authedClient(event));
				return { reset: true };
			} catch (err) {
				const failed = actionFailure(err, 'Could not reset the dashboard. Try again.');
				return fail(failed.status, failed.data);
			}
		},
	),

	/** The page shown above the dashboard, or none. */
	home: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const home = String((await event.request.formData()).get('home_page') ?? '');
		try {
			const settings = await current(event);
			settings.home_page = home;
			await saveCustomization(authedClient(event), settings);
			return { homeSaved: true };
		} catch (err) {
			return fail(400, { pagesError: actionError(err, 'Could not save the dashboard page. Try again.') });
		}
	},
};
