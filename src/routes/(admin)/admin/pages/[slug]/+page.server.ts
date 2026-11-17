import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { authedClient } from '#lib/server/authz.ts';
import { getCustomPage, type CustomPage } from '#lib/api/customization.ts';
import { resolveBlocks } from '#lib/server/custom-blocks.ts';
import { readError } from '#lib/server/read-error.ts';

const NO_PAGE = 'This page does not exist.';

export const load: PageServerLoad = async (event) => {
	const { customization } = await event.parent();
	if (!customization?.entitled) error(404, NO_PAGE);
	const client = authedClient(event);
	// The engine answers 404 for a page the viewer's roles do not see, the
	// same as for one that does not exist. Any other failure keeps its own
	// status, so an outage is never reported as a page that is not there.
	let page: CustomPage;
	try {
		page = await getCustomPage(client, event.params.slug);
	} catch (err) {
		readError(err, NO_PAGE);
	}
	return { customPage: page, blocks: await resolveBlocks(client, page.blocks) };
};
