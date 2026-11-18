import { describe, expect, it } from 'vitest';
import { ApiError } from '@lyeve-labs/client';
import { FlowRefusal } from '#lib/api/flows.ts';
import { BLOCKED_MESSAGE } from './blocked';
import { parseTrigger, sampleKey, testFailure, untilOptions } from './test-run';

describe('sampleKey', () => {
	it('follows the type and the kind, and a system event by its name and scope', () => {
		expect(sampleKey({ type: 'trigger.http', config: { path: '/a' } })).toBe('trigger.http:');
		expect(sampleKey({ type: 'trigger.event', config: { kind: 'content' } })).toBe('trigger.event:content');
		expect(sampleKey({ type: 'trigger.event', config: { kind: 'system', name: 'user.created', schema: 'x' } })).toBe('trigger.event:system:user.created:x');
	});
});

describe('untilOptions', () => {
	it('offers the whole run first, then each node by name and id', () => {
		expect(untilOptions([{ id: 'a', type: 'x', name: 'Load', config: {} }, { id: 'b', type: 'x', config: {} }] as never)).toEqual([
			{ value: '', label: 'Run to the end' },
			{ value: 'a', label: 'Load (a)' },
			{ value: 'b', label: 'b' },
		]);
	});
});

describe('parseTrigger', () => {
	it('reads an empty field as an empty object and refuses text that is not JSON', () => {
		expect(parseTrigger('  ')).toEqual({ ok: true, value: {} });
		expect(parseTrigger('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
		expect(parseTrigger('{a')).toEqual({ ok: false, error: 'The trigger is not valid JSON.' });
	});
});

describe('testFailure', () => {
	it('names the nodes a 402 refused', () => {
		const out = testFailure(new FlowRefusal([{ node_id: 'orders', path: '/type', message: 'x' }]));
		expect(out).toMatchObject({ kind: 'refused', text: 'One element uses a feature that is not enabled on this engine: orders.' });
	});

	it('reads the blocked message as the blocked state and a 422 list as problems', () => {
		expect(testFailure(new ApiError(422, BLOCKED_MESSAGE))).toEqual({ kind: 'blocked' });
		const list = JSON.stringify({ ok: false, errors: [{ node_id: 'join', path: '/config', message: 'required' }] });
		expect(testFailure(new ApiError(422, list))).toMatchObject({ kind: 'refused', text: 'Fix the problems in the definition.', errors: [{ node_id: 'join' }] });
	});

	it('says the run failed when the error says nothing', () => {
		expect(testFailure(new Error(''))).toEqual({ kind: 'refused', errors: [], text: 'The test run failed.' });
	});
});

describe('testFailure for an answer that is not the engine speaking', () => {
	const OUTAGE_TEXT = 'The engine is unavailable, so the test run did not finish. Try again in a moment.';

	// The client puts the raw body of a non-JSON answer in the message, so a
	// proxy's error page would be printed as the run's failure.
	it('never prints a proxy error page', () => {
		const out = testFailure(new ApiError(502, '<html><body>Bad Gateway</body></html>'));
		expect(out).toEqual({ kind: 'refused', errors: [], text: OUTAGE_TEXT });
	});

	it('never prints a transport failure or a timeout', () => {
		expect(testFailure(new TypeError('Failed to fetch'))).toEqual({ kind: 'refused', errors: [], text: OUTAGE_TEXT });
		const timeout = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
		expect(testFailure(timeout)).toEqual({ kind: 'refused', errors: [], text: OUTAGE_TEXT });
	});

	it('says the run failed for a server error and prints none of it', () => {
		expect(testFailure(new ApiError(500, 'panic: runtime error', { error: 'panic: runtime error' }))).toEqual({
			kind: 'refused',
			errors: [],
			text: 'The test run failed.',
		});
	});

	it('says to sign in again on a 401, which the run was already renewed for', () => {
		expect(testFailure(new ApiError(401, 'unauthorized', { error: 'unauthorized' }))).toEqual({ kind: 'refused', errors: [], text: 'Your session ended. Sign in again in another tab, then try again here.' });
	});

	it('relays a refusal the engine worded', () => {
		const out = testFailure(new ApiError(400, 'trigger payload too large', { error: 'trigger payload too large' }));
		expect(out).toEqual({ kind: 'refused', errors: [], text: 'trigger payload too large' });
	});

	it('does not relay a 4xx body the engine did not send', () => {
		const out = testFailure(new ApiError(413, '<html>Request Entity Too Large</html>'));
		expect(out).toEqual({ kind: 'refused', errors: [], text: 'The test run failed.' });
	});
});
