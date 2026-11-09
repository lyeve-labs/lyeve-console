import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { authedClient } from '$lib/server/authz';
import { getSearchAnalytics, searchPage, type SearchAnalytics, type SearchPage } from '$lib/api/search-settings';
import { section } from '$lib/api/gate';
import { pageWindow, pastEndOffset, withOffset } from '$lib/api/list';
import { couldNotLoad } from '$lib/outage';
import { attempt } from './attempt.server';

/** The results a page shows when the request names no limit. */
const RESULTS_LIMIT = 20;

/**
 * The most results the search store returns in one page. The handler lets
 * the engine's ceiling through, but the store cuts a page to 200, so a larger
 * page would hold 200 and the offsets past them would skip the rest.
 */
const MAX_RESULTS_LIMIT = 200;

export const load: PageServerLoad = async (event) => {
	const { url } = event;
	const client = authedClient(event);

	const q = url.searchParams.get('q')?.trim() ?? '';
	const { limit, offset } = pageWindow(url, RESULTS_LIMIT, MAX_RESULTS_LIMIT);

	// Only hit the search endpoint when a query is present. The backend
	// rejects requests with no criterion (400). A failed search is a gate, so
	// it never renders as "no results", which reads as an empty index.
	const [results, analytics] = await Promise.all([
		q ? section<SearchPage>(searchPage(client, q, limit, offset), 'Could not run the search.') : null,
		section<SearchAnalytics>(attempt(() => getSearchAnalytics(client)), couldNotLoad('search analytics')),
	]);
	if (results?.ok) {
		const back = pastEndOffset(results.value.results.length, limit, offset, results.value.total);
		if (back !== null) redirect(307, withOffset(url, back));
	}

	return { results, q, limit, offset, analytics };
};
