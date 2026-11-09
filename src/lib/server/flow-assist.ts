/**
 * What the flow editor's assistant actions share: the catalog read once per
 * request, and the reading of a refused call into the state the tab shows.
 */

import { ApiError } from '@lyeve-labs/client';
import { CatalogError, getLLMCatalog } from '$lib/api/assist';
import { authedHeaders } from '$lib/server/authz';
import { AI_BUDGET_TEXT, aiBudgetSpent } from '$lib/server/ai-load';
import { actionError } from '$lib/server/action-error';
import type { AssistRefusal } from '$lib/flow/assistant';

const NO_CATALOG_TEXT = 'The assistant needs a newer version of the flow plugin.';
const UNAVAILABLE_FALLBACK = 'The flow validator is not available on this engine.';
const FAILED_TEXT = 'The assistant did not answer. Try again.';

/** The HTTP status a refusal answers the form with. */
export function refusalStatus(r: AssistRefusal): number {
	switch (r.state) {
		case 'locked':
			return 402;
		case 'off':
			return 404;
		case 'unavailable':
			return 503;
		default:
			return 400;
	}
}

/**
 * Reads a thrown request error into a refusal: `locked` is the license
 * without the AI feature, a spent monthly budget an error that leaves the
 * prompt live, `off` the tenant's switch, `unavailable` an engine
 * that cannot validate a draft, and `error` the rest. The 503 is the one 5xx whose
 * body is a static sentence written for the operator, so it is relayed with
 * a fallback for an empty one. Every other 5xx collapses to a static line so
 * driver text never reaches the page. A coded 4xx other than the two gates is
 * the engine describing the request, which is worth showing (`actionError`).
 */
export function assistRefusal(err: unknown): AssistRefusal {
	if (err instanceof CatalogError) {
		if (err.status === 404) return { state: 'unavailable', message: NO_CATALOG_TEXT };
		if (err.status === 402) return { state: 'locked' };
		return { state: 'error', message: 'Could not load the node catalog. Try again.' };
	}
	if (err instanceof ApiError) {
		if (aiBudgetSpent(err)) return { state: 'error', message: AI_BUDGET_TEXT };
		if (err.status === 402) return { state: 'locked' };
		if (err.status === 404) return { state: 'off' };
		// A 503 the engine sent is JSON. Any other is a proxy's page, whose body
		// is not a sentence for the operator.
		if (err.status === 503 && err.body !== undefined) {
			const msg = err.message?.trim();
			return { state: 'unavailable', message: msg && msg !== '503' ? msg : UNAVAILABLE_FALLBACK };
		}
		return { state: 'error', message: actionError(err, FAILED_TEXT) };
	}
	if (err instanceof Error && err.name === 'TimeoutError') {
		return { state: 'error', message: 'The assistant took too long to answer. Try a shorter prompt.' };
	}
	return { state: 'error', message: FAILED_TEXT };
}

const cache = new WeakMap<Request, Promise<string>>();

/**
 * The catalog for one request, read once however many calls in that
 * request ask for it. It is keyed on the request object, which lives exactly
 * as long as the action does, so nothing outlives the request and two
 * tenants never share a read.
 */
export function catalogFor(event: { request: Request; fetch: typeof fetch } & Parameters<typeof authedHeaders>[0]): Promise<string> {
	let pending = cache.get(event.request);
	if (!pending) {
		pending = getLLMCatalog(event.fetch, authedHeaders(event));
		cache.set(event.request, pending);
	}
	return pending;
}
