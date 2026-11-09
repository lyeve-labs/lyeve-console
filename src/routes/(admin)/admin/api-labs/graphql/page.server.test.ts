import { describe, it, expect, vi } from 'vitest';

import { actions } from './+page.server';
import { headerOf, sendEvent } from '../lab-events.test-support';

/*
 * The engine enforces double-submit CSRF on a cookie-authenticated write.
 * event.fetch forwards the browser's cookies on a same-origin subrequest, so
 * the engine sees its own session cookie and applies that check. A lab that
 * does not echo the token has every write refused with 403 "csrf token
 * required", which reads as the route rejecting the request rather than the
 * lab never having been allowed to make it.
 *
 * A mocked fetch answers whatever it is told to, so only the real CSRF check
 * shows a missing token. These cases pin the header itself.
 */
describe('a lab write echoes the CSRF token', () => {
	it('sends X-CSRF-Token on a GraphQL call', async () => {
		const { sent, event } = sendEvent({ document: '{ ping }' });

		await actions.graphql(event);

		const call = sent.find((s) => s.url.includes('/graphql'));
		expect(call, 'the call never went out').toBeDefined();
		expect(headerOf(call!.init, 'X-CSRF-Token')).toBe('csrf-value');
	});

	it('omits the header when there is no token rather than sending an empty one', async () => {
		// The engine is a separate origin here, so no cookie was forwarded and
		// no check applies. An empty header would fail the check it is meant
		// to pass.
		const { sent, event } = sendEvent({ document: '{ ping }' }, null);

		await actions.graphql(event);

		const call = sent.find((s) => s.url.includes('/graphql'));
		expect(call).toBeDefined();
		expect(headerOf(call!.init, 'X-CSRF-Token')).toBeUndefined();
	});
});

describe('a lab request that never reached the engine', () => {
	// The runtime's words for a failed connection can name an internal address.
	it('says it could not be sent, in the console\'s words only', async () => {
		const { event } = sendEvent({ document: '{ ping }' });
		(event as { fetch: unknown }).fetch = vi.fn(async () => {
			throw new TypeError('fetch failed: connect ECONNREFUSED 10.0.0.5:8080');
		});
		const out = (await actions.graphql(event)) as { status: number; data: { error: string } };
		expect(out.data.error).toBe('Could not send the request. Try again.');
	});
});
