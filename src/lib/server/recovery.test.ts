import { describe, expect, it } from 'vitest';
import { ApiError } from '@lyeve-labs/client';
import { recoveryRefusal } from './recovery';

describe('recoveryRefusal', () => {
	it.each([404, 405])('reads %i as a way in this build does not include', (status) => {
		expect(recoveryRefusal(new ApiError(status, 'x'), 'Password reset')).toEqual({
			status: 404,
			error: 'Password reset is not included in this build. Ask a super admin to sign you in.',
		});
	});

	it('reads a 402 as a way in this engine does not enable', () => {
		expect(recoveryRefusal(new ApiError(402, 'x'), 'Password reset')).toEqual({
			status: 404,
			error: 'Password reset is not enabled on this engine. Ask a super admin to sign you in.',
		});
	});

	it('reports a rate limit as one', () => {
		expect(recoveryRefusal(new ApiError(429, 'x'), 'Email sign-in')?.status).toBe(429);
	});

	it('reports an outage and an unreachable engine as unavailable', () => {
		expect(recoveryRefusal(new ApiError(503, 'x'), 'Email sign-in')?.error).toMatch(/unavailable/);
		expect(recoveryRefusal(new TypeError('fetch failed'), 'Email sign-in')?.status).toBe(503);
	});

	it('leaves a refusal of the input to the caller', () => {
		expect(recoveryRefusal(new ApiError(400, 'invalid'), 'Email sign-in')).toBeNull();
	});
});
