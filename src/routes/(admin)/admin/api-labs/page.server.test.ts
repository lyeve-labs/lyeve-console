import { describe, it, expect, vi } from 'vitest';

import { actions, load } from './+page.server';
import { headerOf, json, mockCookies, OPENAPI, sendEvent } from './lab-events.test-support';

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
	it('sends X-CSRF-Token on a REST write', async () => {
		const { sent, event } = sendEvent({
			endpoint: 'POST /api/v1/content/{schema}',
			p_schema: 'post',
			body: '{"title":"x"}',
			confirmed: 'yes',
		});

		await actions.rest(event);

		const write = sent.find((s) => s.init.method === 'POST' && s.url.includes('/content/'));
		expect(write, 'the write never went out').toBeDefined();
		expect(headerOf(write!.init, 'X-CSRF-Token')).toBe('csrf-value');
	});
});

describe('admin/api-labs REST load', () => {
	// The endpoint list is the REST lab's alone, and the gRPC status is the
	// gRPC lab's, so this load asks for nothing else.
	it('reads the endpoint list and nothing of the gRPC listener', async () => {
		const asked: string[] = [];
		const fetch = vi.fn(async (url: string) => {
			asked.push(String(url));
			return json(OPENAPI);
		}) as unknown as typeof globalThis.fetch;
		const d = (await load({ fetch, cookies: mockCookies(null), url: new URL('http://x/admin/api-labs') } as never)) as {
			endpoints: { id: string }[];
			source: string;
		};
		expect(d.source).toBe('engine');
		expect(d.endpoints.map((e) => e.id)).toContain('POST /api/v1/content/{schema}');
		expect(asked.some((u) => u.includes('grpc/status'))).toBe(false);
	});
});
