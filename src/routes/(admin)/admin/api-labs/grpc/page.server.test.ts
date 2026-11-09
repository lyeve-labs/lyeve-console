import { describe, it, expect, vi } from 'vitest';

import { actions, load } from './+page.server';
import { signedIn } from '$lib/server/test-support/signed-in';
import { headerOf, json, mockCookies, OPENAPI, sendEvent } from '../lab-events.test-support';

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
	it('sends X-CSRF-Token on a transcoded gRPC call', async () => {
		const { sent, event } = sendEvent({
			route: 'GET /api/content/{schema}',
			g_schema: 'post',
		});

		await actions.grpc(event);

		const call = sent.find((s) => s.url.includes('grpc/invoke'));
		expect(call, 'the call never went out').toBeDefined();
		expect(headerOf(call!.init, 'X-CSRF-Token')).toBe('csrf-value');
	});
});

describe('the gRPC action takes its allowlist from the engine', () => {
	it('refuses a route the listener does not report, whatever the form says', async () => {
		const { sent, event } = sendEvent({ route: 'GET http://example.invalid/steal' });

		const result = (await actions.grpc(event)) as { status: number; data: { error: string } };

		expect(result.status).toBe(400);
		expect(result.data.error).toContain('Choose a route from the list.');
		expect(sent.some((s) => s.url.includes('grpc/invoke'))).toBe(false);
	});

	it('refuses a route whose parameter was left empty', async () => {
		const { sent, event } = sendEvent({ route: 'GET /api/content/{schema}', g_schema: '  ' });

		const result = (await actions.grpc(event)) as { status: number; data: { error: string } };

		expect(result.status).toBe(400);
		expect(result.data.error).toContain('schema');
		expect(sent.some((s) => s.url.includes('grpc/invoke'))).toBe(false);
	});
});

describe('a call the plugin would not run', () => {
	function invokeAnswers(res: () => Response) {
		const { event } = sendEvent({ route: 'GET /api/content/{schema}', g_schema: 'post' });
		const held = event as unknown as { fetch: typeof globalThis.fetch };
		const base = held.fetch;
		held.fetch = (async (url: string, init?: RequestInit) =>
			String(url).includes('grpc/invoke') ? res() : base(url, init)) as typeof globalThis.fetch;
		return event;
	}
	const said = async (res: () => Response) =>
		((await actions.grpc(invokeAnswers(res))) as { data: { error: string } }).data.error;

	it("relays the plugin's sentence for a coded refusal", async () => {
		expect(await said(() => json({ error: 'every path parameter needs a value', code: 'bad_request' }, 400))).toBe(
			'every path parameter needs a value',
		);
	});

	it('says the feature is not enabled on a 402 and names the role on a 403', async () => {
		expect(await said(() => json({ error: 'the license does not carry this plugin, so no listener was started', code: 'http_402' }, 402))).toBe(
			'gRPC is not enabled on this engine.',
		);
		expect(await said(() => json({ error: 'super_admin role required', code: 'forbidden' }, 403))).toBe('Only a super admin can run a gRPC call.');
	});

	it("keeps a 5xx and a proxy's page off the screen", async () => {
		expect(await said(() => json({ error: 'the transcoding listener is not running', code: 'service_unavailable' }, 503))).toBe(
			'Could not run the call. Try again.',
		);
		expect(await said(() => new Response('<html>413 Request Entity Too Large</html>', { status: 413 }))).toBe('Could not run the call. Try again.');
	});
});

/*
 * The gRPC lab's status read. The route is a super admin's, so the lab opens
 * for one alone, and only a 404 says the plugin is not here.
 */
describe('admin/api-labs gRPC status', () => {
	function loadEvent(roles: string[], status: () => Response) {
		const asked: string[] = [];
		const fetch = vi.fn(async (url: string) => {
			asked.push(String(url));
			if (String(url).includes('grpc/status')) return status();
			return json(OPENAPI);
		}) as unknown as typeof globalThis.fetch;
		return {
			asked,
			event: { fetch: signedIn(fetch, { roles }), cookies: mockCookies(null), url: new URL('http://x/admin/api-labs') } as never,
		};
	}
	type Loaded = { grpc: { gate: { state: string }; routes: string[] } };

	it('refuses a role below super admin before it asks for the status', async () => {
		const { asked, event } = loadEvent(['admin'], () => json({ listening: true }));
		await expect(load(event)).rejects.toMatchObject({
			status: 403,
			body: { message: 'Only a super admin can open this page.' },
		});
		expect(asked.some((u) => u.includes('grpc/status'))).toBe(false);
	});

	it('reads the routes for a super admin', async () => {
		const { event } = loadEvent(['super_admin'], () => json({ listening: true, transcoded_routes: ['GET /api/schemas'] }));
		const d = (await load(event)) as unknown as Loaded;
		expect(d.grpc.gate).toEqual({ state: 'ok' });
		expect(d.grpc.routes).toEqual(['GET /api/schemas']);
	});

	it('says absent only for a 404', async () => {
		const { event } = loadEvent(['super_admin'], () => json({ error: 'not found' }, 404));
		expect(((await load(event)) as unknown as Loaded).grpc.gate).toEqual({ state: 'absent' });
	});

	it('reads an outage as one, with a retry', async () => {
		const { event } = loadEvent(['super_admin'], () => json({ error: 'down' }, 503));
		expect(((await load(event)) as unknown as Loaded).grpc.gate).toEqual({ state: 'unavailable' });
	});

	it('reads a refusal as the role it is', async () => {
		const { event } = loadEvent(['super_admin'], () => json({ error: 'forbidden' }, 403));
		expect(((await load(event)) as unknown as Loaded).grpc.gate).toEqual({ state: 'forbidden' });
	});
});
