import type { RequestEvent } from '@sveltejs/kit';
import { createClient, type HttpClient } from '@lyeve-labs/client';
import { refusalAware } from '#lib/api/flows.ts';
import { authedHeaders } from '#lib/server/authz.ts';


/**
 * The authed client for a flow write. The same session and CSRF headers as
 * `authedClient`, over a fetch that keeps a 402 body: the flow plugin's
 * refusals name the node ids or the ceiling, and the page renders them.
 */
export function flowClient(event: RequestEvent): HttpClient {
	return createClient(refusalAware(event.fetch), authedHeaders(event));
}
