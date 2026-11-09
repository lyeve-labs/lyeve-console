import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import {
	getSummary,
	getEndpoints,
	getMethods,
	getAgents,
	getAnomalies
} from '@lyeve-labs/client-rest';
import { section } from '$lib/api/gate';
import { couldNotLoad } from '$lib/outage';
import { authedClient, loadUser } from '$lib/server/authz';

/** What each part of the page says when its read failed for a reason it cannot name. */
const FAILED = {
	summary: couldNotLoad('the request summary'),
	endpoints: couldNotLoad('the endpoint breakdown'),
	methods: couldNotLoad('the method breakdown'),
	agents: couldNotLoad('the user agent breakdown'),
	anomalies: couldNotLoad('anomalies'),
} as const;

export const load: PageServerLoad = async (event) => {
	const user = await loadUser(event);
	if (!user.roles.some((r) => ['super_admin', 'admin'].includes(r))) {
		error(403, 'Only an admin or a super admin can open this page.');
	}

	const client = authedClient(event);

	/*
	 * The range is stated rather than left to the engine. Left open, the
	 * summary and the breakdowns read every retained hour while the page
	 * implies a day, and the number an operator compares against the
	 * dashboard covers a different period from the one the dashboard shows.
	 */
	const from = new Date(Date.now() - 24 * 3_600_000).toISOString();

	const [summary, endpoints, methods, agents, anomalies] = await Promise.all([
		section(getSummary({ from }, client), FAILED.summary),
		section(getEndpoints({ from, limit: 20 }, client), FAILED.endpoints),
		section(getMethods({ from }, client), FAILED.methods),
		section(getAgents({ from, limit: 10 }, client), FAILED.agents),
		section(getAnomalies(undefined, client), FAILED.anomalies)
	]);

	return { summary, endpoints, methods, agents, anomalies };
};
