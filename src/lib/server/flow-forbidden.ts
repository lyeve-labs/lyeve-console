import { fail } from '@sveltejs/kit';
import type { ApiError } from '@lyeve-labs/client';
import { actionError } from './action-error';

/**
 * A 403 from a flow route, as the page renders it. The engine names the
 * action and the resource in its message, which is written for the
 * operator and is relayed. The flag is what lets the page title the
 * notice as a role refusal rather than a failed request.
 */
export function forbiddenFailure(err: ApiError) {
	return fail(403, { error: actionError(err, 'Your role does not allow this. Ask a super admin to grant it.'), forbidden: true });
}
