import type { Actions, PageServerLoad } from './$types';
import { ApiError } from '@lyeve-labs/client';
import { error } from '@sveltejs/kit';
import {
	listEndpoints,
	listPlugins,
	listSlowest,
	readEndpoint,
	type EndpointDetail,
	type EndpointStats,
	type PluginBreakdown,
} from '$lib/api/profiler';
import { section, type Section } from '$lib/api/gate';
import { authedClient, loadUser } from '$lib/server/authz';
import { couldNotLoad } from '$lib/outage';
import { RESET_QUESTION, reset } from './reset.server';
import { asked } from '$lib/server/asked';

/**
 * What the timings tab renders. Every view is the profiler plugin's, under
 * /api/admin/debug/profiler, super_admin only: the ring describes every
 * tenant's traffic. A view the plugin did not answer keeps the reason on its
 * own, so the page says so in place rather than rendering a measurement of
 * nothing.
 */
export interface ProfilerPage {
	endpoints: Section<EndpointStats[]>;
	slowest: Section<EndpointStats[]>;
	plugins: Section<PluginBreakdown[]>;
	/**
	 * The endpoint the URL selected, and its detail. Null when none is
	 * selected. The value is null when the ring holds no sample of it.
	 */
	selected: string | null;
	detail: Section<EndpointDetail | null> | null;
}

/** What each view says when its read failed for a reason it cannot name. */
const FAILED = {
	endpoints: couldNotLoad('endpoint statistics'),
	plugins: couldNotLoad('per-plugin statistics'),
	detail: couldNotLoad('this endpoint'),
} as const;

/**
 * The plugin answers 404 for a path its ring holds no sample of, which is an
 * answer and not a missing plugin. A missing plugin also refuses every other
 * view on the page, and those say so.
 */
async function sampled(read: Promise<EndpointDetail>): Promise<EndpointDetail | null> {
	try {
		return await read;
	} catch (err) {
		if (err instanceof ApiError && err.status === 404) return null;
		throw err;
	}
}

export const load: PageServerLoad = async (event) => {
	const { url } = event;
	const user = await loadUser(event);
	if (!user.roles.includes('super_admin')) {
		error(403, 'Only a super admin can open this page.');
	}
	const client = authedClient(event);

	// The selection is a query parameter, so a detail is a link and survives
	// a refresh. The engine samples paths with their leading slash.
	const asked = url.searchParams.get('endpoint')?.trim() ?? '';
	const selected = asked ? '/' + asked.replace(/^\/+/, '') : null;

	const [endpoints, slowest, plugins, detail] = await Promise.all([
		section(listEndpoints(client), FAILED.endpoints),
		section(listSlowest(client), FAILED.endpoints),
		section(listPlugins(client), FAILED.plugins),
		selected ? section(sampled(readEndpoint(client, selected)), FAILED.detail) : Promise.resolve(null),
	]);

	const page: ProfilerPage = { endpoints, slowest, plugins, selected, detail };
	return page;
};

export const actions: Actions = {
	reset: asked(RESET_QUESTION, reset),
};
