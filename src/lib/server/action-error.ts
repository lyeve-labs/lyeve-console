import { fail, type ActionFailure } from '@sveltejs/kit';
import { ApiError } from '@lyeve-labs/client';
import { refusalOf, refusalText } from '$lib/api/refusal';
import { errorCodeOf } from '$lib/api/limits';

/**
 * Turns a thrown request error into a message worth showing the operator.
 *
 * A form action that ends in `catch { return fail(400, { error: 'Failed to
 * create X' }) }` throws away the only useful part of the response. The engine
 * answers a rejected write with a specific reason: "field_map is required and
 * must not be empty", "slug must match ^[a-z]...", "name already exists", and
 * without it the operator sees a form that looks correct and a banner that
 * does not say what to change.
 *
 * Only a 4xx that carries an API error code is the engine's own refusal, so
 * only that message is relayed. A 5xx can carry driver or infrastructure
 * detail, and a 4xx with no code came from something in front of the engine,
 * such as a proxy's 413. Both collapse to the caller's static sentence.
 */
export function actionError(err: unknown, fallback: string): string {
	if (err instanceof ApiError && err.status >= 400 && err.status < 500 && errorCodeOf(err)) {
		const msg = err.message?.trim();
		if (msg && msg !== String(err.status)) return msg;
	}
	return fallback;
}

/**
 * The failure a form action returns for a thrown request error. A 402 is a
 * license refusal and returns 402 with the refusal beside its sentence, so
 * the page can render the numbers and the license link through
 * `RefusalNotice`. Anything else is `actionError` at `status`.
 */
export function actionFailure(err: unknown, fallback: string, status = 400) {
	const refused = refusalOf(err);
	if (refused) return fail(402, { error: refusalText(refused), refused });
	return fail(status, { error: actionError(err, fallback) });
}

/**
 * A failure tagged with the action that returned it. A page with several
 * forms reports every one through one result, and the tag tells each form its
 * own failure. `id` names the row a row action failed on.
 */
export function tagged<F extends ActionFailure<Record<string, unknown>>>(action: string, failure: F, id?: string) {
	return fail(failure.status, { ...(failure.data as F['data']), action, ...(id ? { id } : {}) });
}
