import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { parseExposition, readMetricsText, type MetricFamily } from '#lib/api/telemetry.ts';
import { section, type Section } from '#lib/api/gate.ts';
import { authedHeaders, loadUser } from '#lib/server/authz.ts';
import { couldNotLoad } from '#lib/outage.ts';
import { rolesInWords } from '#lib/roles.ts';

const READERS = ['admin', 'super_admin'];

/**
 * What the metrics tab renders.
 *
 * The metrics view is every admin's, already narrowed by the engine to the
 * caller's tenant unless the caller is a super admin.
 */
export interface TelemetryPage {
	superAdmin: boolean;
	families: Section<MetricFamily[]>;
}

export const load: PageServerLoad = async (event) => {
	const { fetch } = event;
	const user = await loadUser(event);
	if (!user.roles.some((r) => READERS.includes(r))) {
		error(403, `Only ${rolesInWords(READERS)} can open this page.`);
	}
	const superAdmin = user.roles.includes('super_admin');

	const families = await section(
		readMetricsText(fetch, authedHeaders(event)).then(parseExposition),
		couldNotLoad('metrics'),
	);

	const page: TelemetryPage = { superAdmin, families };
	return page;
};
