import type { LayoutServerLoad } from './$types';
import type { HttpClient, Schema, SchemaField } from '@lyeve-labs/client';
import { getSchema } from '@lyeve-labs/client-rest';
import type { RelationChoices } from '$lib/components/content/relation-choices';
import { authedClient } from '$lib/server/authz';
import { readRelationChoices } from '$lib/server/relation-choices';
import { MAX_PATH_RELATIONS, filterKeys, type Definitions } from '$lib/utils/entry-view';

/** The entry list. The editor pages under it have no filters. */
const LIST_ROUTE = '/(admin)/admin/content/[schema]';

/**
 * The definitions of the content types the list's filter paths reach, and the
 * entries a relation filter on the entry list offers, by the content type
 * they belong to.
 *
 * Read here and not in the page's load, because this load reads the content
 * type and the route and never the address. SvelteKit runs a server load
 * again only when something it read changes, so a filter, a sort or a page
 * turn reuses what it read, once per visit to a list. The session client
 * reads only the address's scheme, which SvelteKit does not track.
 *
 * The definitions are awaited, because the page's load needs them to read a
 * filter path before it lists. The choices are returned unawaited, so
 * SvelteKit streams them and the list's first byte does not wait for them.
 * Each related content type is read once, however many fields point at it.
 */
export const load: LayoutServerLoad = async (event) => {
	if (event.route.id !== LIST_ROUTE) return {};
	const client = authedClient(event);
	const def = await getSchema(event.params.schema, client).catch((): Schema | null => null);
	// The page's own load reports a content type it cannot read.
	if (!def) return { relatedSchemas: {} as Definitions, relationChoices: Promise.resolve(null) };
	const relatedSchemas = await readDefinitions(client, def);
	return { relatedSchemas, relationChoices: readChoices(client, def, relatedSchemas) };
};

/**
 * The definition of every content type a path of relations reaches from
 * `def`, the listed type's own included. A definition whose read is refused
 * or fails is left out, so its fields are not offered and the list still
 * draws.
 */
async function readDefinitions(client: HttpClient, def: Schema): Promise<Definitions> {
	const defs: Definitions = { [def.name]: def };
	const tried = new Set([def.name]);
	let from = [def];
	for (let depth = 0; depth < MAX_PATH_RELATIONS && from.length > 0; depth++) {
		const names = [
			...new Set(
				from.flatMap((s) =>
					(s.fields ?? [])
						.filter((f) => !f.system && f.field_type === 'relation' && f.relation_to)
						.map((f) => f.relation_to as string),
				),
			),
		].filter((name) => !tried.has(name));
		for (const name of names) tried.add(name);
		const read = await Promise.all(names.map((name) => getSchema(name, client).catch((): Schema | null => null)));
		from = [];
		names.forEach((name, i) => {
			const found = read[i];
			if (!found) return;
			defs[name] = found;
			from.push(found);
		});
	}
	return defs;
}

/**
 * The choices by related content type. A path that ends on a relation offers
 * that relation's entries too.
 */
function readChoices(client: HttpClient, def: Schema, defs: Definitions): Promise<Record<string, RelationChoices>> {
	const fields = filterKeys(def, defs)
		.filter((k) => k.family === 'relation' && k.field)
		.map((k) => k.field as SchemaField);
	// The list has no assistant, so it skips the reads only its labels need.
	return readRelationChoices(client, fields, { assistantLabels: false });
}
