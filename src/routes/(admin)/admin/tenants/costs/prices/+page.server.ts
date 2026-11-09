import type { PageServerLoad, Actions } from './$types';
import { fail } from '@sveltejs/kit';
import { authedClient, requireRole } from '$lib/server/authz';
import type { Section } from '$lib/api/gate';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import { deletePrice, isResourceType, listPrices, putPrice, type Price } from '$lib/api/cost';
import { parsePrice } from '$lib/cost/forms';
import { couldNotLoad } from '$lib/outage';
import { OPERATOR_ROLES, UNREAD, ledgerReader, refusal, refuseBelowAdmin } from '../costs.server';

type PricesPage = {
	enabled: boolean;
	/** Where the ledger is turned on, when a refusal names it. */
	upgradeUrl: string;
	prices: Section<Price[]>;
};

export const load: PageServerLoad = async (event) => {
	const { user, plugins } = await event.parent();
	refuseBelowAdmin(user);
	const page: PricesPage = { enabled: true, upgradeUrl: '', prices: UNREAD };
	// The shell says why the page is unavailable while its plugin does not run.
	if (notRunning(plugins, PLUGIN.multitenant)) return page;

	const ledger = ledgerReader();
	const prices = await ledger.read(listPrices(authedClient(event)), couldNotLoad('the prices'));
	const upgradeUrl = ledger.refused();
	if (upgradeUrl !== null) return { ...page, enabled: false, upgradeUrl };
	return { ...page, prices };
};

export const actions: Actions = {
	putPrice: async (event) => {
		await requireRole(event, OPERATOR_ROLES);
		const parsed = parsePrice(await event.request.formData());
		if ('error' in parsed) return fail(400, { form: 'price', error: parsed.error, locked: false });
		try {
			await putPrice(authedClient(event), parsed.resourceType, parsed.price);
		} catch (err) {
			return refusal({ form: 'price' }, err, 'Could not save the price. Try again.');
		}
		return { form: 'price', saved: true };
	},

	resetPrice: async (event) => {
		await requireRole(event, OPERATOR_ROLES);
		const form = await event.request.formData();
		const resourceType = form.get('resource_type');
		if (!isResourceType(resourceType)) {
			return fail(400, { form: 'price', error: 'This form is missing its resource type. Reload the page and try again.', locked: false });
		}
		try {
			await deletePrice(authedClient(event), resourceType);
		} catch (err) {
			return refusal({ form: 'price' }, err, 'Could not reset the price. Try again.');
		}
		return { form: 'price', saved: true };
	},
};
