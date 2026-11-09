import type { PageServerLoad, Actions } from './$types';
import { fail } from '@sveltejs/kit';
import { authedClient, requireRole } from '$lib/server/authz';
import { actionFailure } from '$lib/server/action-error';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import { channelsFrom } from '$lib/api/alert-channels';
import {
	getAlertSettings,
	listEvents,
	putAlertSettings,
	SETTINGS_CHANNEL_PREFIX,
	type AlertSettings,
} from '$lib/api/error-tracking';
import { type Gate, GATE_OK, gateOf } from '$lib/api/gate';
import { couldNotLoad } from '$lib/outage';

export const load: PageServerLoad = async (event) => {
	const { plugins } = await event.parent();
	let gate: Gate = notRunning(plugins, PLUGIN.errorTracking) ? { state: 'absent' } : GATE_OK;
	let settings: AlertSettings | null = null;
	let windowDays: number | null = null;
	if (gate.state === 'ok') {
		const client = authedClient(event);
		// The event list states the window this install reads, null when it
		// reads every event. Losing that read costs the sentence, never the form.
		const window = listEvents(client, 1).then(
			(page) => page.windowDays,
			() => null,
		);
		try {
			settings = await getAlertSettings(client);
		} catch (err) {
			gate = gateOf(err, couldNotLoad('errors'));
		}
		windowDays = await window;
	}
	return { gate, settings, windowDays };
};

/** A threshold field, or null for the default. An empty field is the default too. */
function threshold(raw: FormDataEntryValue | null, integer: boolean): number | null | 'invalid' {
	const s = String(raw ?? '').trim();
	if (!s) return null;
	const n = Number(s);
	if (!Number.isFinite(n) || n <= 0 || (integer && !Number.isInteger(n))) return 'invalid';
	return n;
}

export const actions: Actions = {
	save: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const form = await event.request.formData();
		const custom = form.get('threshold_mode') === 'custom';
		const minCount = custom ? threshold(form.get('spike_min_count'), true) : null;
		const zScore = custom ? threshold(form.get('spike_z_score'), false) : null;
		if (minCount === 'invalid') {
			return fail(400, { error: 'Enter a minimum count of 1 or more errors, as a whole number.' });
		}
		if (zScore === 'invalid') return fail(400, { error: 'Enter a z-score above 0.' });
		let saved: AlertSettings;
		try {
			// Every member is sent, so the write states the whole setting. A
			// masked value sent back keeps what is stored, and an empty channels
			// object removes every channel.
			saved = await putAlertSettings(authedClient(event), {
				channels: channelsFrom(form, SETTINGS_CHANNEL_PREFIX),
				spike_min_count: minCount,
				spike_z_score: zScore,
			});
		} catch (err) {
			return actionFailure(err, 'Could not save the alert settings. Try again.');
		}
		return { saved: true, signingSecret: saved.webhook_signing_secret ?? '' };
	},
};
