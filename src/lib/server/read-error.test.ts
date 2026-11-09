import { describe, expect, it } from 'vitest';
import { error, isHttpError, redirect } from '@sveltejs/kit';
import { ApiError } from '@lyeve-labs/client';
import { readError } from './read-error';
import { BUSY, OUTAGE } from '$lib/outage';

const NOT_FOUND = 'Webhook not found';

/** What readError threw, as the error page reads it. */
function thrown(err: unknown): { status: number; message: string } {
	try {
		readError(err, NOT_FOUND);
	} catch (out) {
		if (isHttpError(out)) return { status: out.status, message: out.body.message };
		throw out;
	}
	throw new Error('readError returned');
}

describe('readError', () => {
	it('says the record is not there only when the engine answered 404', () => {
		expect(thrown(new ApiError(404, 'not found'))).toEqual({ status: 404, message: NOT_FOUND });
	});

	it('keeps an outage an outage, never a missing record', () => {
		const outage = { status: 503, message: OUTAGE.title };
		expect(thrown(new ApiError(503, 'pq: connection refused'))).toEqual(outage);
		expect(thrown(new ApiError(502, 'bad gateway'))).toEqual(outage);
		expect(thrown(new ApiError(504, 'gateway timeout'))).toEqual(outage);
		expect(thrown(new TypeError('fetch failed'))).toEqual(outage);
		expect(thrown(new DOMException('The operation timed out', 'TimeoutError'))).toEqual(outage);
	});

	it('keeps a refusal for the rate its own status, in the words every surface uses', () => {
		expect(thrown(new ApiError(429, 'rate limit exceeded'))).toEqual({ status: 429, message: BUSY.body });
	});

	it('relays a role refusal when the engine names the role it wanted', () => {
		const named = new ApiError(403, 'super_admin role required', { error: 'super_admin role required', code: 'forbidden' });
		expect(thrown(named)).toEqual({ status: 403, message: 'super_admin role required' });
	});

	it('says it in its own words when the refusal names no role', () => {
		const own = { status: 403, message: 'Your role cannot open this page. Ask a super admin if you need it.' };
		expect(thrown(new ApiError(403, 'insufficient permissions', { error: 'insufficient permissions' }))).toEqual(own);
		// A plural or a longer word is not a role.
		expect(thrown(new ApiError(403, 'x', { error: 'access denied: admins can only view their own history' }))).toEqual(own);
	});

	it('never relays a refusal that did not come as the engine\'s JSON', () => {
		const page = '<html><body>Blocked. Contact the super_admin of this site.</body></html>';
		expect(thrown(new ApiError(403, page))).toEqual({
			status: 403,
			message: 'Your role cannot open this page. Ask a super admin if you need it.',
		});
	});

	it('sends a lapsed session to sign in rather than reporting a failure', () => {
		expect(thrown(new ApiError(401, 'authentication required'))).toEqual({ status: 401, message: 'Your session ended. Sign in again.' });
	});

	it('keeps engine and driver text out of every other answer', () => {
		for (const err of [
			new ApiError(500, 'pq: relation "sys_webhooks" does not exist'),
			new ApiError(400, 'invalid input syntax for type uuid'),
			new ApiError(409, 'duplicate key value violates unique constraint "sys_webhooks_name_key"'),
			new Error('Cannot read properties of undefined'),
			new SyntaxError('Unexpected token < in JSON at position 0'),
		]) {
			expect(thrown(err)).toEqual({ status: 502, message: 'Could not load this record.' });
		}
	});

	it('lets a redirect or an HTTP error thrown on purpose through as it was', () => {
		let away: unknown;
		try {
			redirect(303, '/admin/webhooks');
		} catch (out) {
			away = out;
		}
		expect(() => readError(away, NOT_FOUND)).toThrow(expect.objectContaining({ status: 303, location: '/admin/webhooks' }));
		let gone: unknown;
		try {
			error(410, 'Gone');
		} catch (out) {
			gone = out;
		}
		expect(thrown(gone)).toEqual({ status: 410, message: 'Gone' });
	});
});
