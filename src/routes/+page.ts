import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';
import { LANDING } from '#lib/landing.ts';

/**
 * The bare host has no content of its own. The admin starts at the dashboard.
 *
 * Redirecting from `load` answers the first request with a 307, so nothing
 * renders and nothing has to run. A redirect from the component on mount
 * would parse a blank document and hydrate it first, and without JavaScript
 * it would never navigate at all.
 */
export const load: PageLoad = () => {
	redirect(307, LANDING);
};
