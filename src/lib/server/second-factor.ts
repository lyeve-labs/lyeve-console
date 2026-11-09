import { ApiError } from '@lyeve-labs/client';
import { errorCodeOf } from '$lib/api/limits';
import { outageFor } from '$lib/outage';

/** The sentence and status a sign-in answers with when a second factor fails. */
export interface SecondFactorFailure {
	status: number;
	error: string;
	/**
	 * No later code can pass this challenge, so the caller drops the challenge
	 * token and returns the reader to the first step.
	 */
	restart?: boolean;
}

/** The engine's code for a challenge whose account has no authenticator app. */
const MFA_NOT_CONFIGURED = 'AUTH_MFA_NOT_CONFIGURED';

/**
 * What a failed second factor tells the reader.
 *
 * `again` names the first step in the caller's words, such as "sign in
 * again", and finishes the sentences that send the reader back to it.
 *
 * Only a refusal of the code itself reads as a wrong code. The engine answers
 * 400 for a request it could not read and 422 for a code that did not match.
 *
 * A 401 with AUTH_MFA_NOT_CONFIGURED means the engine found no authenticator
 * app for the account: one that signs in with a passkey alone, or a store
 * that could not be read. Signing in again reaches the same challenge, so the
 * reader is told to ask a super admin. The sign-in page offers no passkey
 * sign-in to point to instead. Every other 401 is a challenge the engine no
 * longer honors (AUTH_CHALLENGE_EXPIRED: expired, malformed or already used)
 * or an account it no longer signs in (UNAUTHORIZED, AUTH_INVALID_CREDENTIALS:
 * disabled, expired or out of the tenant). No code passes either.
 *
 * A 429 is a locked account, or a challenge that has used up its attempts.
 * The engine sends the same code for both. The second can never pass, and the
 * first passes only after the lock lifts, so both go back to the first step
 * with a sentence that holds for either.
 *
 * Anything else, a 503 or an engine that never answered, did not check the
 * code, and calling it wrong would send the reader to their authenticator for
 * a code that was right.
 */
export function secondFactorFailure(e: unknown, again = 'sign in again'): SecondFactorFailure {
	if (e instanceof ApiError) {
		if (e.status === 429) {
			return { status: 429, error: `Too many verification attempts. Wait, then ${again}.`, restart: true };
		}
		if (e.status === 401 && errorCodeOf(e) === MFA_NOT_CONFIGURED) {
			return {
				status: 401,
				error: 'This account has no authenticator app set up. Ask a super admin to restore your access.',
				restart: true,
			};
		}
		if (e.status === 401) {
			return { status: 401, error: `This sign-in expired. ${again[0].toUpperCase()}${again.slice(1)}.`, restart: true };
		}
		if (e.status === 400 || e.status === 422) {
			return { status: 400, error: 'That code did not match. Try again.' };
		}
	}
	return { status: 503, error: outageFor('your code was not checked') };
}
