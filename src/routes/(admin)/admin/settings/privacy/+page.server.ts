import type { Actions, PageServerLoad } from './$types';
import { error, fail } from '@sveltejs/kit';
import { authedClient, requireRole } from '$lib/server/authz';
import { actionFailure } from '$lib/server/action-error';
import { forbiddenText, isOutage } from '$lib/api/gate';
import { couldNotLoad } from '$lib/outage';
import { PLUGIN, type PluginName } from '$lib/plugin-names';
import { notRunning, whyNotRunning } from '$lib/plugins';
import {
	ALWAYS_EXPORT,
	MAX_EXPORT_ROLES,
	MAX_ROLE_LENGTH,
	isFormErasureMode,
	namesNoTenant,
	readExportRoles,
	readExportSections,
	readFormErasure,
	saveExportRoles,
	saveExportSections,
	saveFormErasure,
	setting,
	type ExportSections,
	type FormErasure,
	type SettingRead,
} from '$lib/api/privacy';

/** The roles the engine lets read and change a tenant's privacy settings. */
const EDITORS = ['admin', 'super_admin'];

export const load: PageServerLoad = async (event) => {
	const { plugins, pluginStatus, user } = await event.parent();
	if (!user.roles.some((r) => EDITORS.includes(r))) error(403, forbiddenText('this page', EDITORS));
	const client = authedClient(event);
	// A setting whose plugin the engine says is stopped is not read, and its
	// card says why, the way the shell does for a stopped plugin's page. A
	// plugin that runs and answers 404 predates the setting, so the card is
	// left out: the running list is what tells the two apart.
	const read = <T>(plugin: PluginName, fetch: () => Promise<T>, failed: string): Promise<SettingRead<T>> =>
		notRunning(plugins, plugin)
			? Promise.resolve({ ok: false as const, stopped: whyNotRunning(plugin, plugins, pluginStatus) })
			: setting(fetch(), failed);
	const [formErasure, exportSections, exportRoles] = await Promise.all([
		read<FormErasure>(
			PLUGIN.schema,
			() => readFormErasure(client),
			couldNotLoad('what an erasure does with form submissions'),
		),
		read<ExportSections>(
			PLUGIN.productAnalytics,
			() => readExportSections(client),
			couldNotLoad('what a person may include in an export'),
		),
		read<{ roles: string[] }>(
			PLUGIN.productAnalytics,
			() => readExportRoles(client),
			couldNotLoad('who may export their own data'),
		),
	]);
	// Every setting here is a tenant's. A session that names none is told so
	// once, and no card is drawn.
	if (namesNoTenant(formErasure) || namesNoTenant(exportSections) || namesNoTenant(exportRoles)) {
		return { noTenant: true, formErasure: null, exportSections: null, exportRoles: null };
	}
	return { noTenant: false, formErasure, exportSections, exportRoles };
};

/** Every value posted under `name`, trimmed, without blanks or repeats. */
function listed(form: FormData, name: string): string[] {
	return [...new Set(form.getAll(name).map((v) => String(v).trim()).filter(Boolean))];
}

/**
 * A failed save, tagged with its form. A license refusal answers 402 with the
 * refusal beside its sentence, and an outage answers 503, never a client error.
 */
function saveFailed(action: 'erasure' | 'sections' | 'roles', err: unknown, fallback: string) {
	const failed = actionFailure(err, fallback, isOutage(err) ? 503 : 400);
	return fail(failed.status, { action, ...failed.data });
}

export const actions: Actions = {
	erasure: async (event) => {
		await requireRole(event, EDITORS);
		const mode = String((await event.request.formData()).get('mode') ?? '');
		if (!isFormErasureMode(mode)) {
			return fail(400, { action: 'erasure' as const, error: 'Choose what an erasure does with form submissions.' });
		}
		try {
			await saveFormErasure(authedClient(event), mode);
			return { action: 'erasure' as const, saved: true };
		} catch (err) {
			return saveFailed('erasure', err, 'Could not save your choice. Try again.');
		}
	},

	sections: async (event) => {
		await requireRole(event, EDITORS);
		const form = await event.request.formData();
		const offered = new Set(listed(form, 'offered'));
		// The page posts every section it showed, and the ones the tenant left
		// out that are not available now. Those stay left out, so a section
		// that comes back is not offered without anyone choosing it.
		const excluded = [...listed(form, 'available').filter((s) => !offered.has(s)), ...listed(form, 'kept')];
		try {
			await saveExportSections(authedClient(event), [...new Set(excluded)]);
			return { action: 'sections' as const, saved: true };
		} catch (err) {
			return saveFailed('sections', err, 'Could not save what a person may include. Try again.');
		}
	},

	roles: async (event) => {
		await requireRole(event, EDITORS);
		const form = await event.request.formData();
		const scope = String(form.get('scope') ?? '');
		if (scope !== 'every' && scope !== 'chosen') {
			return fail(400, { action: 'roles' as const, error: 'Choose who may export.' });
		}
		let roles: string[] = [];
		if (scope === 'chosen') {
			roles = listed(form, 'roles').filter((r) => !ALWAYS_EXPORT.includes(r));
			if (roles.some((r) => r.length > MAX_ROLE_LENGTH)) {
				return fail(400, { action: 'roles' as const, error: `Use role names of at most ${MAX_ROLE_LENGTH} characters.` });
			}
			if (roles.length > MAX_EXPORT_ROLES) {
				return fail(400, { action: 'roles' as const, error: `Choose at most ${MAX_EXPORT_ROLES} roles.` });
			}
			// An empty list means every role, so a tenant that ticks none says
			// so by naming admin, which may always export anyway.
			if (roles.length === 0) roles = ['admin'];
		}
		try {
			await saveExportRoles(authedClient(event), roles);
			return { action: 'roles' as const, saved: true };
		} catch (err) {
			return saveFailed('roles', err, 'Could not save who may export. Try again.');
		}
	},
};
