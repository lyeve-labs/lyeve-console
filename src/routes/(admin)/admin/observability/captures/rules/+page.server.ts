import type { PageServerLoad, Actions } from './$types';
import { fail } from '@sveltejs/kit';
import { authedClient, requireRole } from '$lib/server/authz';
import { actionFailure } from '$lib/server/action-error';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import {
	MAX_RETENTION_SECONDS,
	MIN_RETENTION_SECONDS,
	RULE_METHODS,
	capturePatternIsSound,
	createCaptureRule,
	deleteCaptureRule,
	listCaptureRules,
	updateCaptureRule,
	type CaptureRule,
	type RuleMethod,
} from '$lib/api/request-capture';
import { type Gate, GATE_OK, gateOf } from '$lib/api/gate';
import { couldNotLoad } from '$lib/outage';
import { asked } from '$lib/server/asked';

export const load: PageServerLoad = async (event) => {
	const { plugins } = await event.parent();
	const empty = { rules: [] as CaptureRule[], rulesRead: false, rulesGate: null as Gate | null, licensed: null as boolean | null };

	// The shell says why the page is unavailable while its plugin does not run.
	if (notRunning(plugins, PLUGIN.requestCapture)) {
		return { ...empty, gate: { state: 'absent' } as Gate };
	}

	// A failed read says so in the section and never reads as having none.
	try {
		const read = await listCaptureRules(authedClient(event));
		return {
			rules: read?.data ?? [],
			rulesRead: true,
			rulesGate: null as Gate | null,
			licensed: typeof read?.licensed === 'boolean' ? read.licensed : null,
			gate: GATE_OK,
		};
	} catch (err) {
		return { ...empty, rulesGate: gateOf(err, couldNotLoad('capture rules')), gate: GATE_OK };
	}
};

function method(raw: FormDataEntryValue | null): RuleMethod | null {
	const m = String(raw ?? '*').toUpperCase();
	return (RULE_METHODS as readonly string[]).includes(m) ? (m as RuleMethod) : null;
}

/**
 * Saves a rule from its drawer, or switches one off from its row. A failure
 * names the drawer it came from, and a row's names none, so the page says it.
 */
async function saveRule(event: Parameters<Actions[string]>[0], id: string | null, drawer: 'rule' | null = 'rule') {
	await requireRole(event, ['admin', 'super_admin']);
	const client = authedClient(event);
	const form = await event.request.formData();

	const pattern = String(form.get('route_pattern') ?? '').trim();
	if (!capturePatternIsSound(pattern)) {
		return fail(400, {
			error: 'Enter an absolute path, such as /api/v1/orders/{id} or /api/v1/**. A segment can be * or a {name}, and ** can only come last.',
			drawer,
		});
	}
	const m = method(form.get('method'));
	if (!m) return fail(400, { error: 'Choose a method, or every method.', drawer });
	const percent = Number(form.get('sample_percent'));
	if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
		return fail(400, { error: 'Enter a sample percentage from 0 to 100.', drawer });
	}
	const retention = Math.floor(Number(form.get('retention_seconds')));
	if (!Number.isFinite(retention) || retention < MIN_RETENTION_SECONDS || retention > MAX_RETENTION_SECONDS) {
		return fail(400, { error: 'Choose a retention from an hour to 30 days.', drawer });
	}

	const body = {
		route_pattern: pattern,
		method: m,
		sample_rate: Math.round(percent * 10) / 1000,
		retention_seconds: retention,
		enabled: form.get('enabled') === 'true',
	};
	try {
		if (id) await updateCaptureRule(client, id, body);
		else await createCaptureRule(client, body);
	} catch (err) {
		const failed = actionFailure(err, 'Could not save the rule. Try again.');
		return fail(failed.status, { ...failed.data, drawer });
	}
	return { savedRule: pattern };
}

function idOf(form: FormData): string {
	return String(form.get('id') ?? '').trim();
}

export const actions: Actions = {
	createRule: (event) => saveRule(event, null),

	updateRule: async (event) => {
		const form = await event.request.clone().formData();
		// A rule switched off from its row was not saved from the drawer, so
		// its failure is the page's to report.
		const fromRow = form.get('from') === 'row';
		if (!idOf(form)) return fail(400, { error: 'This form is missing its rule. Reload the page and try again.', drawer: fromRow ? null : 'rule' });
		return saveRule(event, idOf(form), fromRow ? null : 'rule');
	},

	deleteRule: asked(
		{
			question: 'Delete this rule?',
			detail: 'The captures it kept stay until their retention ends.',
			label: 'Delete',
		},
		async (event) => {
			await requireRole(event, ['admin', 'super_admin']);
			const form = await event.request.formData();
			const id = idOf(form);
			if (!id) return fail(400, { error: 'This form is missing its rule. Reload the page and try again.' });
			try {
				await deleteCaptureRule(authedClient(event), id);
			} catch (err) {
				return actionFailure(err, 'Could not delete the rule. Try again.');
			}
			return { removedRule: id };
		},
	),
};
