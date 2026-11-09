import { describe, expect, it } from 'vitest';
import { ApiError } from '@lyeve-labs/client';
import { secondFactorFailure } from './second-factor';

const UNCHECKED = 'The engine is unavailable, so your code was not checked. Try again in a moment.';

// The engine's error body: a sentence, a code and the request's id.
function refused(status: number, code: string, error: string): ApiError {
	return new ApiError(status, error, { error, code, request_id: 'req-1' });
}

describe('secondFactorFailure', () => {
	it.each([
		[400, 'a request the engine could not read'],
		[422, 'a code that did not match'],
	])('reads a %i, %s, as an invalid code', (status) => {
		expect(
			secondFactorFailure(refused(status, 'AUTH_MFA_INVALID_CODE', 'The provided verification code is invalid.'))
		).toEqual({ status: 400, error: 'That code did not match. Try again.' });
	});

	it.each([
		['AUTH_CHALLENGE_EXPIRED', 'a challenge that expired or was already used', 'The MFA challenge has expired. Please log in again.'],
		['UNAUTHORIZED', 'an account disabled since the password step', 'Authentication is required to access this resource.'],
		['AUTH_INVALID_CREDENTIALS', 'an account no longer in the tenant', 'Incorrect email or password.'],
	])('sends a 401 %s, %s, back to sign in again', (code, _case, error) => {
		expect(secondFactorFailure(refused(401, code, error))).toEqual({
			status: 401,
			error: 'This sign-in expired. Sign in again.',
			restart: true,
		});
	});

	it('finishes the sentence with the caller\'s first step', () => {
		const failed = secondFactorFailure(
			refused(401, 'AUTH_CHALLENGE_EXPIRED', 'The MFA challenge has expired. Please log in again.'),
			'request a new link to sign in again'
		);
		expect(failed.error).toBe('This sign-in expired. Request a new link to sign in again.');
	});

	// An account with no authenticator app reaches the same challenge on every
	// sign-in, so telling it the sign-in expired sends it round in a loop.
	it('tells an account with no authenticator app to ask an administrator, not to sign in again', () => {
		const failed = secondFactorFailure(refused(401, 'AUTH_MFA_NOT_CONFIGURED', 'Multi-factor authentication is not configured for this account.'));
		expect(failed).toEqual({
			status: 401,
			error: 'This account has no authenticator app set up. Ask a super admin to restore your access.',
			restart: true,
		});
		expect(failed.error).not.toMatch(/expired|sign in again/i);
	});

	// The engine sends AUTH_MFA_LOCKED_OUT for a locked account and for a
	// challenge that has used up its attempts. The second can never pass.
	it('sends a 429 back to the first step with a sentence that holds for a lock and a spent challenge', () => {
		const failed = secondFactorFailure(refused(429, 'AUTH_MFA_LOCKED_OUT', 'Too many MFA verification attempts. Please log in again to receive a new challenge.'));
		expect(failed).toEqual({
			status: 429,
			error: 'Too many verification attempts. Wait, then sign in again.',
			restart: true,
		});
	});

	it.each([
		['a 503', new ApiError(503, 'session store unavailable')],
		['a 500', new ApiError(500, 'internal error')],
		['a 502 from a proxy', new ApiError(502, 'bad gateway')],
		['a refused connection', new TypeError('fetch failed')],
		['a timeout', new DOMException('The operation was aborted due to timeout', 'TimeoutError')],
	])('says the code was not checked after %s', (_case, e) => {
		expect(secondFactorFailure(e)).toEqual({ status: 503, error: UNCHECKED });
	});

	it('never repeats what the engine or the network said', () => {
		const failed = secondFactorFailure(new Error('driver: connection reset by peer'));
		expect(failed.error).not.toContain('driver');
	});
});
