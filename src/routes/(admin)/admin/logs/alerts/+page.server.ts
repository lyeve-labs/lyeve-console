import type { PageServerLoad, Actions } from './$types';
import { fail } from '@sveltejs/kit';
import { authedClient, requireRole } from '$lib/server/authz';
import { actionFailure } from '$lib/server/action-error';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import { GATE_OK, gateOf, type Gate } from '$lib/api/gate';
import { errorCodeOf } from '$lib/api/limits';
import { channelsFrom } from '$lib/api/alert-channels';
import {
	LOG_ALERT_LEVELS,
	LOG_RULE_NOT_FOUND,
	createLogAlertRule,
	deleteLogAlertRule,
	getLogAlerts,
	isWindow,
	putLogAlerts,
	updateLogAlertRule,
	type LogAlertConfig,
	type LogAlertRule,
	type LogAlertRuleAnswer,
} from '$lib/api/log-alerts';
import { couldNotLoad } from '$lib/outage';
import { asked } from '$lib/server/asked';

/** What the rule drawer posts its channel fields under. */
const CHANNEL_PREFIX = 'channel_';

export const load: PageServerLoad = async (event) => {
	const { user, plugins } = await event.parent();
	// The rules are written by a super admin only. A tenant admin reads the
	// rules scoped to their tenant.
	const superAdmin = user.roles.includes('super_admin');
	let gate: Gate = notRunning(plugins, PLUGIN.logging) ? { state: 'absent' } : GATE_OK;
	let config: LogAlertConfig | null = null;
	if (gate.state === 'ok') {
		try {
			config = await getLogAlerts(authedClient(event));
		} catch (err) {
			gate = gateOf(err, couldNotLoad('volume alert rules'));
		}
	}
	return { gate, config, superAdmin };
};

/** The rule a drawer posted, or the sentence that stops it. */
function ruleFrom(form: FormData): { key: string; rule: LogAlertRule } | { error: string } {
	const level = String(form.get('level') ?? '').trim();
	if (level && level !== 'ALL' && !(LOG_ALERT_LEVELS as readonly string[]).includes(level)) {
		return { error: 'Choose a level, or every level.' };
	}
	const maxCount = Number(form.get('max_count') ?? '');
	if (!Number.isInteger(maxCount) || maxCount < 1) {
		return { error: 'Enter a ceiling of 1 or more entries, as a whole number.' };
	}
	const window = String(form.get('window') ?? '').trim();
	if (!isWindow(window)) return { error: 'Enter the window as a whole number followed by m, h or d, such as 5m.' };
	return {
		key: String(form.get('key') ?? '').trim(),
		rule: {
			id: '',
			level: level === 'ALL' ? '' : level,
			tenant_id: String(form.get('tenant_id') ?? '').trim(),
			plugin: String(form.get('plugin') ?? '').trim(),
			max_count: maxCount,
			window,
			enabled: form.get('enabled') === 'true',
			channels: channelsFrom(form, CHANNEL_PREFIX),
		},
	};
}

/** What the page says when a rule it showed is gone by the time it is written. */
const RULE_GONE = 'This rule no longer exists. The list below is up to date.';

export const actions: Actions = {
	save: async (event) => {
		await requireRole(event, ['super_admin']);
		const parsed = ruleFrom(await event.request.formData());
		if ('error' in parsed) return fail(400, { error: parsed.error, drawer: true });
		const client = authedClient(event);
		let saved: LogAlertRuleAnswer;
		try {
			// Each rule is written on its own, so another rule's channels are
			// never sent back and two operators editing two rules lose neither.
			saved = parsed.key
				? await updateLogAlertRule(client, parsed.key, parsed.rule)
				: await createLogAlertRule(client, parsed.rule);
		} catch (err) {
			if (errorCodeOf(err) === LOG_RULE_NOT_FOUND) return fail(404, { error: RULE_GONE });
			const failed = actionFailure(err, 'Could not save the rule. Try again.');
			return fail(failed.status, { ...failed.data, drawer: true });
		}
		// The write that sets a new webhook URL answers its signing secret once.
		return { saved: true, signingSecret: saved.rule.webhook_signing_secret ?? '' };
	},

	delete: asked(
		{
			question: 'Delete this rule?',
			detail: 'The rule stops firing and its channels are deleted. This cannot be undone.',
			label: 'Delete',
		},
		async (event) => {
			await requireRole(event, ['super_admin']);
			const key = String((await event.request.formData()).get('key') ?? '');
			if (!key) return fail(400, { error: 'This form is missing its rule. Reload the page and try again.' });
			try {
				// Deleting a rule needs no license: the plugin asks for one only to
				// add or change a paid channel.
				await deleteLogAlertRule(authedClient(event), key);
			} catch (err) {
				if (errorCodeOf(err) === LOG_RULE_NOT_FOUND) return fail(404, { error: RULE_GONE });
				return actionFailure(err, 'Could not delete the rule. Try again.');
			}
			return { deleted: key };
		},
	),

	cooldown: async (event) => {
		await requireRole(event, ['super_admin']);
		const cooldown = String((await event.request.formData()).get('cooldown') ?? '').trim();
		if (!isWindow(cooldown)) return fail(400, { error: 'Enter the cooldown as a whole number followed by m, h or d, such as 10m.' });
		const client = authedClient(event);
		try {
			const current = await getLogAlerts(client);
			await putLogAlerts(client, { thresholds: current.thresholds, cooldown });
		} catch (err) {
			return actionFailure(err, 'Could not save the cooldown. Try again.');
		}
		return { cooldownSaved: cooldown };
	},
};
