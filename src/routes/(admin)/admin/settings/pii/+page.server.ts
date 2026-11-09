import type { Actions, PageServerLoad } from './$types';
import { fail } from '@sveltejs/kit';
import { authedClient, requireRole } from '$lib/server/authz';
import { actionFailure, tagged } from '$lib/server/action-error';
import { checked } from '$lib/checkbox';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import { createRule, deleteRule, getRules, testRule, updateRule, type RuleCatalog } from '$lib/api/pii-mask';
import { type Gate, GATE_OK, gateOf } from '$lib/api/gate';
import { asked } from '$lib/server/asked';

export const load: PageServerLoad = async (event) => {
	const { plugins } = await event.parent();

	// The shell says why the page is unavailable while its plugin does not run.
	if (notRunning(plugins, PLUGIN.piiMask)) {
		return { rules: null as RuleCatalog | null, gate: { state: 'absent' } as Gate };
	}

	let rules: RuleCatalog | null = null;
	let gate: Gate = GATE_OK;
	try {
		rules = await getRules(authedClient(event));
	} catch (err) {
		gate = gateOf(err, 'Could not load the masking settings.');
	}
	return { rules, gate };
};

/**
 * An empty priority is not zero. Zero runs the rule before every preset,
 * which is the opposite of what leaving the field blank means, so a blank
 * field is 100 and a typed 0 stays 0.
 */
function priorityFrom(raw: FormDataEntryValue | null): number {
	const text = String(raw ?? '').trim();
	const n = Number(text);
	return text === '' || !Number.isFinite(n) ? 100 : n;
}

/** One rule out of a submitted form, with the numbers already numbers. */
function draftFrom(form: FormData) {
	return {
		name: String(form.get('name') ?? '').trim(),
		description: String(form.get('description') ?? '').trim(),
		pattern: String(form.get('pattern') ?? '').trim(),
		replacement: String(form.get('replacement') ?? '').trim(),
		priority: priorityFrom(form.get('priority')),
		enabled: checked(form, 'enabled'),
	};
}

export const actions: Actions = {
	create: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const form = await event.request.formData();
		const draft = draftFrom(form);
		// The plugin reads a priority of 0 on create as unset and stores 100,
		// which runs the rule last where 0 asked for first.
		if (draft.priority === 0) {
			return fail(400, {
				action: 'create',
				error: 'A new rule cannot start at priority 0, because it would be saved as 100. Create it with 1 or more, then edit it to set 0.',
			});
		}
		try {
			await createRule(authedClient(event), draft);
			return { saved: true };
		} catch (err) {
			return tagged('create', actionFailure(err, 'Could not create the rule. Try again.', 422));
		}
	},

	update: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const form = await event.request.formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { action: 'update', error: 'This form is missing its rule. Reload the page and try again.' });
		try {
			await updateRule(authedClient(event), id, draftFrom(form));
			return { saved: true };
		} catch (err) {
			return tagged('update', actionFailure(err, 'Could not save the rule. Try again.', 422));
		}
	},

	delete: asked(
		{
			question: 'Delete this rule?',
			detail: 'Values it masks appear unmasked from the next request.',
			label: 'Delete',
		},
		async (event) => {
			await requireRole(event, ['admin', 'super_admin']);
			const form = await event.request.formData();
			const id = String(form.get('id') ?? '');
			if (!id) return fail(400, { action: 'delete', error: 'This form is missing its rule. Reload the page and try again.' });
			try {
				await deleteRule(authedClient(event), id);
				return { deleted: true };
			} catch (err) {
				return tagged('delete', actionFailure(err, 'Could not delete the rule. Try again.', 422));
			}
		},
	),

	// The dry run. It stores nothing, so it is safe to press repeatedly while
	// a pattern is being worked out, which is the whole point of it.
	test: async (event) => {
		await requireRole(event, ['admin', 'super_admin']);
		const form = await event.request.formData();
		try {
			const result = await testRule(
				authedClient(event),
				String(form.get('pattern') ?? ''),
				String(form.get('replacement') ?? ''),
				String(form.get('sample') ?? ''),
			);
			return { test: result };
		} catch (err) {
			return tagged('test', actionFailure(err, 'Could not run the pattern. Try again.', 422));
		}
	},
};
