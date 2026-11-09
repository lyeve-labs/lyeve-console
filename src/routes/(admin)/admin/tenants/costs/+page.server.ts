import type { PageServerLoad, Actions } from './$types';
import { authedClient, requireRole } from '$lib/server/authz';
import type { Section } from '$lib/api/gate';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import { aggregateNow, getDashboard, getSummary, monthStart, type CostDashboard, type CostSummary } from '$lib/api/cost';
import { couldNotLoad } from '$lib/outage';
import { OPERATOR_ROLES, UNREAD, ledgerReader, refusal, refuseBelowAdmin } from './costs.server';

/**
 * What the page renders. When the ledger's routes refuse this instance, the
 * page shows only that the feature is not enabled, with the link the refusal
 * names. Otherwise each read is its value or the gate that says why there is
 * none, and the page draws that gate in place.
 */
type MonthPage = {
	enabled: boolean;
	/** Where the ledger is turned on, when a refusal names it. */
	upgradeUrl: string;
	summary: Section<CostSummary>;
	dashboard: Section<CostDashboard>;
};

export const load: PageServerLoad = async (event) => {
	const { user, plugins } = await event.parent();
	refuseBelowAdmin(user);
	const page: MonthPage = { enabled: true, upgradeUrl: '', summary: UNREAD, dashboard: UNREAD };
	// The shell says why the page is unavailable while its plugin does not run.
	if (notRunning(plugins, PLUGIN.multitenant)) return page;

	const ledger = ledgerReader();
	const client = authedClient(event);
	const [summary, dashboard] = await Promise.all([
		ledger.read(getSummary(client, monthStart(new Date())), couldNotLoad('the split by resource')),
		ledger.read(getDashboard(client), couldNotLoad("this month's costs")),
	]);
	const upgradeUrl = ledger.refused();
	if (upgradeUrl !== null) return { ...page, enabled: false, upgradeUrl };
	return { ...page, summary, dashboard };
};

export const actions: Actions = {
	aggregate: async (event) => {
		await requireRole(event, OPERATOR_ROLES);
		try {
			const result = await aggregateNow(authedClient(event));
			return { form: 'aggregate', saved: true, result };
		} catch (err) {
			return refusal({ form: 'aggregate' }, err, 'Could not update the costs. Try again.');
		}
	},
};
