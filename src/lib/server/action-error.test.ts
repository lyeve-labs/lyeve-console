import { describe, it, expect } from 'vitest';
import { ApiError } from '@lyeve-labs/client';
import { actionError } from './action-error';

const FALLBACK = 'Failed to create webhook';

/** The error the client throws for a refusal the engine wrote: `{ error, code }`. */
function refusal(status: number, message: string, code = 'validation_failed'): ApiError {
	return new ApiError(status, message, { error: message, code });
}

describe('actionError', () => {
	it('relays a 400 validation message so the operator knows what to change', () => {
		const err = refusal(400, 'field_map is required and must not be empty');
		expect(actionError(err, FALLBACK)).toBe('field_map is required and must not be empty');
	});

	it('relays 422 as well, which is what the engine uses for schema validation', () => {
		const err = refusal(422, 'schema name is required');
		expect(actionError(err, FALLBACK)).toBe('schema name is required');
	});

	it('relays a 409 conflict', () => {
		const err = refusal(409, 'a webhook with that name already exists', 'conflict');
		expect(actionError(err, FALLBACK)).toBe('a webhook with that name already exists');
	});

	// A 4xx with no code came from something in front of the engine, such as a
	// proxy refusing a large body, and its wording is not the console's.
	it('does not relay a 4xx that carries no API error code', () => {
		expect(actionError(new ApiError(413, 'Request Entity Too Large'), FALLBACK)).toBe(FALLBACK);
		expect(
			actionError(new ApiError(400, 'Bad Request', { error: 'Bad Request' }), FALLBACK)
		).toBe(FALLBACK);
	});

	it('does not relay a 501, which is a 5xx like any other', () => {
		const err = refusal(501, 'this plugin does not expose its migrations', 'not_implemented');
		expect(actionError(err, FALLBACK)).toBe(FALLBACK);
	});

	// Other 5xx bodies can carry driver text, table names or internal paths, none
	// of which may reach a response the browser renders.
	it('does not relay a 500', () => {
		const err = new ApiError(500, 'pq: relation "sys_webhooks" does not exist');
		expect(actionError(err, FALLBACK)).toBe(FALLBACK);
	});

	it('does not relay a 503 from an unavailable replica', () => {
		const err = new ApiError(503, 'read replica unavailable: dial tcp 10.0.0.7:5432: refused');
		expect(actionError(err, FALLBACK)).toBe(FALLBACK);
	});

	it('does not relay a transport failure', () => {
		expect(actionError(new TypeError('fetch failed'), FALLBACK)).toBe(FALLBACK);
	});

	it('falls back for a non-Error throw', () => {
		expect(actionError('something', FALLBACK)).toBe(FALLBACK);
		expect(actionError(null, FALLBACK)).toBe(FALLBACK);
		expect(actionError(undefined, FALLBACK)).toBe(FALLBACK);
	});

	it('falls back when a 4xx carries no message', () => {
		expect(actionError(refusal(400, ''), FALLBACK)).toBe(FALLBACK);
		expect(actionError(refusal(400, '   '), FALLBACK)).toBe(FALLBACK);
	});

	// The client uses the status as the message when the body has no error field,
	// which is not something worth showing anyone.
	it('falls back when the message is just the status code', () => {
		expect(actionError(refusal(400, '400'), FALLBACK)).toBe(FALLBACK);
	});

	it('trims surrounding whitespace off a relayed message', () => {
		expect(actionError(refusal(400, '  name is required  '), FALLBACK)).toBe(
			'name is required'
		);
	});
});
