import type { PageServerLoad, Actions } from './$types';
import { exportSubject, eraseSubject } from '@lyeve-labs/client-rest';
import { fail, error } from '@sveltejs/kit';
import { ApiError } from '@lyeve-labs/client';
import { authedClient, loadUser, requireRole } from '$lib/server/authz';
import { actionFailure, tagged } from '$lib/server/action-error';
import { isOutage } from '$lib/api/gate';
import { rolesInWords } from '$lib/roles';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning, whyNotRunning } from '$lib/plugins';
import { installSetting, type Setting } from '$lib/api/privacy';
import { isStepUpFactor, mailUnavailable, readStepUp, saveStepUp, type StepUp } from '$lib/api/export-step-up';

export const load: PageServerLoad = async (event) => {
	const user = await loadUser(event);
	if (!user.roles.includes('super_admin')) {
		error(403, `Only ${rolesInWords(['super_admin'])} can open this page.`);
	}
	const { plugins, pluginStatus } = await event.parent();
	// The step-up is served by the plugin that runs the self-service export.
	// While the engine says that plugin is stopped, the section says why. A
	// plugin that runs and answers 404 predates the setting, which is left out.
	const stepUp: Setting<StepUp> = notRunning(plugins, PLUGIN.productAnalytics)
		? { ok: false, stopped: whyNotRunning(PLUGIN.productAnalytics, plugins, pluginStatus) }
		: await installSetting(
				readStepUp(authedClient(event)),
				'Could not load the export requirements.',
			);
	return { stepUp };
};

export const actions: Actions = {
	export: async (event) => {
		await requireRole(event, ['super_admin']);
		const client = authedClient(event);
		const form = await event.request.formData();
		const subject = String(form.get('subject') ?? '').trim();
		if (!subject) {
			return fail(400, { action: 'export', error: "Enter the subject's email or ID." });
		}
		try {
			const result = await exportSubject(subject, client);
			return { action: 'export', ok: true, subject, result };
		} catch (err) {
			return tagged('export', actionFailure(err, 'Could not export data for this subject. Try again.'));
		}
	},

	stepUp: async (event) => {
		await requireRole(event, ['super_admin']);
		const posted = (await event.request.formData()).getAll('factors').map(String);
		const factors = posted.filter(isStepUpFactor);
		if (factors.length !== posted.length) {
			return fail(400, { action: 'stepUp' as const, error: 'Choose among the password, an authenticator code and an emailed code.' });
		}
		try {
			await saveStepUp(authedClient(event), [...new Set(factors)]);
			return { action: 'stepUp' as const, ok: true };
		} catch (err) {
			if (mailUnavailable(err)) {
				return fail(422, {
					action: 'stepUp' as const,
					error: 'Email is not set up, so an emailed code cannot be required. Set up email first, or leave it unticked. Nothing was saved.',
				});
			}
			if (err instanceof ApiError && err.status === 400) {
				return fail(400, { action: 'stepUp' as const, error: 'One of the chosen steps is not available. Reload the page and try again.' });
			}
			// A license refusal answers 402 with its way forward, and an outage
			// answers 503, never a client error.
			const failed = actionFailure(
				err,
				'Could not save the export requirements. Try again.',
				isOutage(err) ? 503 : 400,
			);
			return fail(failed.status, { action: 'stepUp' as const, ...failed.data });
		}
	},

	erase: async (event) => {
		await requireRole(event, ['super_admin']);
		const client = authedClient(event);
		const form = await event.request.formData();
		const subject = String(form.get('subject') ?? '').trim();
		const confirm = String(form.get('confirm') ?? '').trim();
		if (!subject) {
			return fail(400, { action: 'erase', error: "Enter the subject's email or ID." });
		}
		if (confirm !== subject) {
			return fail(400, {
				action: 'erase',
				error: 'Type the subject exactly as above.',
			});
		}
		try {
			const result = await eraseSubject(subject, client);
			return { action: 'erase', ok: true, subject, result };
		} catch (err) {
			return tagged('erase', actionFailure(err, 'Could not start the erasure. Nothing was erased. Try again.'));
		}
	},
};
