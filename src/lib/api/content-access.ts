/**
 * What the access rules let the caller do with one content type, read before
 * any entry: the actions it may take and the fields it may not read. It
 * answers even when the caller may not read the type, so a create without
 * read reads as `["create"]` and an empty rule as no action at all.
 */
import { ApiError, type HttpClient } from '@lyeve-labs/client';
import { isOutage } from './gate';
import { UNKNOWN_ACCESS, accessOf, type TypeAccess } from '$lib/utils/content-access';

/** The caller's access to `schema`. Throws the client's error on a refusal or an outage. */
export async function getContentAccess(client: HttpClient, schema: string): Promise<TypeAccess> {
	const body = await client.get<unknown>(`/api/admin/content/access?schema=${encodeURIComponent(schema)}`);
	return accessOf(body);
}

/**
 * The caller's access to `schema`, or no report when the read failed for a
 * reason a later read of the same type reports better: a type the engine
 * does not know, or an engine older than the route. An outage throws, since
 * every read the page makes next would meet it too.
 */
export async function readContentAccess(client: HttpClient, schema: string): Promise<TypeAccess> {
	try {
		return await getContentAccess(client, schema);
	} catch (err) {
		if (isOutage(err) || !(err instanceof ApiError)) throw err;
		return UNKNOWN_ACCESS;
	}
}
