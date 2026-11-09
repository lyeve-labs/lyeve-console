/**
 * What a detail page's load throws when its record could not be read.
 *
 * A detail page has nothing to draw without its record, so a failed read ends
 * in the error page rather than in a notice. Only the engine's 404 says the
 * record does not exist. A role refusal, a refusal for the request rate and an
 * outage each keep a status of their own, so none is reported as a record that
 * is not there.
 *
 * Nothing the engine said reaches the response, with one exception: a 403
 * whose sentence names the role it wanted, which is written for the operator
 * and tells them who could open the page.
 */
import { error, isHttpError, isRedirect } from '@sveltejs/kit';
import { ApiError } from '@lyeve-labs/client';
import { forbiddenText, isOutage } from '$lib/api/gate';
import { BUSY, OUTAGE, couldNotLoad } from '$lib/outage';
import { ROLES } from '$lib/roles';
import { SESSION_ENDED } from '$lib/session';

/** A role name standing as a word of its own, the way the engine writes one. */
const NAMES_A_ROLE = new RegExp(`\\b(?:${ROLES.join('|')})\\b`);

/** Why the reader cannot open the record, in the engine's words when they name a role. */
function refusal(err: ApiError): string {
	// The sentence comes from the JSON body only. A proxy that refuses in its
	// own markup leaves the body unset, and its page never reaches the reader.
	const said = (err.body as { error?: unknown } | undefined)?.error;
	const sentence = typeof said === 'string' ? said.trim() : '';
	return NAMES_A_ROLE.test(sentence) ? sentence : forbiddenText('this page');
}

/**
 * Throw the error page for a detail read that failed. `notFound` is the page's
 * sentence for a record that does not exist. Call it from the catch around the
 * read, after any status the page handles itself.
 */
export function readError(err: unknown, notFound: string): never {
	if (isRedirect(err) || isHttpError(err)) throw err;
	if (err instanceof ApiError) {
		if (err.status === 404) error(404, notFound);
		if (err.status === 403) error(403, refusal(err));
		// The shell sends a lapsed session to sign in again, and the error page
		// offers the same for this status.
		if (err.status === 401) error(401, SESSION_ENDED);
		if (err.status === 429) error(429, BUSY.body);
	}
	if (isOutage(err)) error(503, OUTAGE.title);
	error(502, couldNotLoad('this record'));
}
