import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { getLoggingLevels, getLoggingConfig, getLogVolume } from '@lyeve-labs/client-rest';
import { section } from '$lib/api/gate';
import { pageWindow, pastEndOffset, withOffset } from '$lib/api/list';
import { LOG_DEFAULT_LIMIT, LOG_MAX_LIMIT, searchLogEntries } from '$lib/api/logs';
import { authedClient, loadUser } from '$lib/server/authz';
import { couldNotLoad } from '$lib/outage';

export const load: PageServerLoad = async (event) => {
	const { url } = event;
	await loadUser(event);

	const client = authedClient(event);

	const q = url.searchParams.get('q') ?? '';
	const level = url.searchParams.get('level') ?? '';
	const { limit, offset } = pageWindow(url, LOG_DEFAULT_LIMIT, LOG_MAX_LIMIT);

	const [search, levels, config, volume] = await Promise.all([
		section(
			searchLogEntries(client, { q, level, limit, offset }),
			couldNotLoad('log entries')
		),
		section(getLoggingLevels(client), couldNotLoad('log levels')),
		section(getLoggingConfig(client), couldNotLoad('log sinks')),
		section(getLogVolume(client, '24h'), couldNotLoad('log volume'))
	]);

	// The stated count is trusted as it is. Raising it to offset plus rows read,
	// as the audit log does, turns an offset past the end into the total, and
	// the correction below then walks back one page per redirect until the
	// browser gives up.
	if (search.ok) {
		const back = pastEndOffset(search.value.results?.length ?? 0, limit, offset, search.value.total ?? null);
		if (back !== null) redirect(307, withOffset(url, back));
	}

	return {
		search,
		limit,
		offset,
		levels,
		config,
		volume,
		q,
		level
	};
};
