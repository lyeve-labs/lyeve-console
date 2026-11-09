import type { PageServerLoad, Actions } from './$types';
import { fail } from '@sveltejs/kit';
import { authedClient, requireRole } from '$lib/server/authz';
import type { Section } from '$lib/api/gate';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import { createBudget, deleteBudget, listBudgets, type Budget } from '$lib/api/cost';
import { parseBudget } from '$lib/cost/forms';
import { couldNotLoad } from '$lib/outage';
import { OPERATOR_ROLES, UNREAD, ledgerReader, refusal, refuseBelowAdmin } from '../costs.server';
import { asked } from '$lib/server/asked';

type BudgetsPage = {
	enabled: boolean;
	/** Where the ledger is turned on, when a refusal names it. */
	upgradeUrl: string;
	budgets: Section<Budget[]>;
};

export const load: PageServerLoad = async (event) => {
	const { user, plugins } = await event.parent();
	refuseBelowAdmin(user);
	const page: BudgetsPage = { enabled: true, upgradeUrl: '', budgets: UNREAD };
	// The shell says why the page is unavailable while its plugin does not run.
	if (notRunning(plugins, PLUGIN.multitenant)) return page;

	const ledger = ledgerReader();
	const budgets = await ledger.read(listBudgets(authedClient(event)), couldNotLoad('the budgets'));
	const upgradeUrl = ledger.refused();
	if (upgradeUrl !== null) return { ...page, enabled: false, upgradeUrl };
	return { ...page, budgets };
};

/*
 * Each failure names the action behind it, so the drawer shows a failed
 * create and the list shows a failed delete, and neither reads as the other.
 */
export const actions: Actions = {
	createBudget: async (event) => {
		await requireRole(event, OPERATOR_ROLES);
		const parsed = parseBudget(await event.request.formData());
		if ('error' in parsed) return fail(400, { action: 'createBudget', error: parsed.error, locked: false });
		try {
			await createBudget(authedClient(event), parsed.budget);
		} catch (err) {
			return refusal({ action: 'createBudget' }, err, 'Could not create the budget. Try again.');
		}
		return { action: 'createBudget', saved: true };
	},

	deleteBudget: asked(
		{
			question: 'Delete this budget?',
			detail: 'Its threshold history is deleted too.',
			label: 'Delete',
		},
		async (event) => {
			await requireRole(event, OPERATOR_ROLES);
			const form = await event.request.formData();
			const id = String(form.get('id') ?? '').trim();
			if (!id) return fail(400, { action: 'deleteBudget', error: 'This form is missing its budget. Reload the page and try again.', locked: false });
			try {
				await deleteBudget(authedClient(event), id);
			} catch (err) {
				return refusal({ action: 'deleteBudget' }, err, 'Could not delete the budget. Try again.');
			}
			return { action: 'deleteBudget', saved: true };
		},
	),
};
