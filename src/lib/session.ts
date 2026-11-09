/** What the console says wherever a session has ended and the reader signs in again here. */
export const SESSION_ENDED = 'Your session ended. Sign in again.';

/**
 * What a page says when a request it sent to the engine is refused for the
 * session after a renewal. Signing in from another tab keeps the work on this
 * one, which a sign-in here would throw away.
 */
export const SIGN_IN_AGAIN = 'Your session ended. Sign in again in another tab, then try again here.';
