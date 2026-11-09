import type { PageServerLoad, Actions } from './$types';
import { fail } from '@sveltejs/kit';
import { authedClient, requireUser } from '$lib/server/authz';
import { actionFailure } from '$lib/server/action-error';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import { getLocales, putLocales, type LocalePreferences } from '$lib/api/localization';
import { parsePreferences } from '$lib/localization/preferences';
import { section, type Section } from '$lib/api/gate';
import { couldNotLoad } from '$lib/outage';

export const load: PageServerLoad = async (event) => {
	const { plugins } = await event.parent();
	// The shell says why the page is unavailable while its plugin does not run.
	if (notRunning(plugins, PLUGIN.localization)) {
		return { locales: { ok: false, gate: { state: 'absent' } } as Section<LocalePreferences> };
	}
	return {
		locales: await section(
			getLocales(authedClient(event)),
			couldNotLoad('locales'),
		),
	};
};

export const actions: Actions = {
	save: async (event) => {
		await requireUser(event);
		const parsed = parsePreferences(await event.request.formData());
		if ('error' in parsed) return fail(400, { error: parsed.error, saved: false });
		try {
			const locales = await putLocales(authedClient(event), parsed.prefs);
			return { saved: true, error: null, locales };
		} catch (err) {
			const failed = actionFailure(err, 'Could not save the locales. Try again.');
			return fail(failed.status, { ...failed.data, saved: false });
		}
	},
};
