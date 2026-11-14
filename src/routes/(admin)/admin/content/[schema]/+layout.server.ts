import type { LayoutServerLoad } from './$types';
import type { HttpClient } from '@lyeve-labs/client';
import { getSchema } from '@lyeve-labs/client-rest';
import type { RelationChoices } from '$lib/components/content/relation-choices';
import { authedClient } from '$lib/server/authz';
import { readRelationChoices } from '$lib/server/relation-choices';

/** The entry list. The editor pages under it have no filters. */
const LIST_ROUTE = '/(admin)/admin/content/[schema]';

/**
 * The entries a relation filter on the entry list offers, by the content type
 * they belong to.
 *
 * Read here and not in the page's load, because this load reads the content
 * type and the route and never the address. SvelteKit runs a server load
 * again only when something it read changes, so a filter, a sort or a page
 * turn reuses these choices, and they are read once per visit to a list.
 * The session client reads only the address's scheme, which SvelteKit does
 * not track.
 *
 * The promise is returned unawaited, so SvelteKit streams it and the list's
 * first byte does not wait for it. Each related content type is read once,
 * however many fields point at it.
 */
export const load: LayoutServerLoad = (event) => {
	if (event.route.id !== LIST_ROUTE) return {};
	const client = authedClient(event);
	return { relationChoices: readChoices(client, event.params.schema) };
};

/** The choices by related content type, or null when the content type could not be read. */
async function readChoices(client: HttpClient, schema: string): Promise<Record<string, RelationChoices> | null> {
	try {
		const def = await getSchema(schema, client);
		// The list has no assistant, so it skips the reads only its labels need.
		return await readRelationChoices(client, def.fields ?? [], { assistantLabels: false });
	} catch {
		return null;
	}
}
