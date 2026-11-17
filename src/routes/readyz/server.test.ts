import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from './+server';
import { ENGINE_READY_TIMEOUT_MS } from '#lib/server/engine.ts';

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

// The probe reaches the engine through the request's fetch, as the setup gate
// does. The global is stubbed with the same engine so a probe that went
// around it is still answered.
let engine: typeof fetch = vi.fn();
const probe = () => GET({ fetch: (...args: Parameters<typeof fetch>) => engine(...args) } as never);
const answer = (fn: (url: URL, init?: RequestInit) => Promise<Response>) => {
	const mock = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
		fn(new URL(input instanceof Request ? input.url : String(input), 'http://console.test'), init),
	);
	engine = mock as unknown as typeof fetch;
	vi.stubGlobal('fetch', mock);
	return mock;
};

describe('readyz', () => {
	it('answers 200 next to a configured engine, which serves the setup read and not the setup-mode route', async () => {
		answer(async (url) =>
			url.pathname === '/api/admin/setup'
				? new Response('{"setup_required":false,"mode":"normal"}', { status: 200 })
				: new Response('{"error":"not found"}', { status: 404 }),
		);
		const res = await probe();
		expect(res.status).toBe(200);
		expect(await res.text()).toBe('ready\n');
		expect(res.headers.get('Cache-Control')).toBe('no-store');
	});

	it('answers 200 while the engine is in setup mode, so the setup screen stays in service', async () => {
		answer(async () => new Response('{"setup_required":true,"mode":"setup"}', { status: 200 }));
		expect((await probe()).status).toBe(200);
	});

	it('reads a rate-limited answer as an engine that is up', async () => {
		answer(async () => new Response('{"error":"slow down"}', { status: 429 }));
		expect((await probe()).status).toBe(200);
	});

	it('answers 503 while the engine cannot serve, and repeats none of its answer', async () => {
		answer(async () => new Response('{"code":"database_error"}', { status: 503 }));
		const res = await probe();
		expect(res.status).toBe(503);
		expect(await res.text()).toBe('unavailable\n');
	});

	it('answers 503 when the engine cannot be reached', async () => {
		answer(async () => {
			throw new TypeError('fetch failed');
		});
		expect((await probe()).status).toBe(503);
	});

	it('gives a stalled engine a deadline and answers 503 when it passes', async () => {
		const timeout = vi
			.spyOn(AbortSignal, 'timeout')
			.mockImplementation(() => AbortSignal.abort(new DOMException('timed out', 'TimeoutError')));
		answer((_url, init) =>
			new Promise<Response>((_resolve, reject) => {
				const signal = init?.signal;
				if (!signal) return;
				if (signal.aborted) reject(signal.reason);
				signal.addEventListener('abort', () => reject(signal.reason));
			}),
		);
		expect((await probe()).status).toBe(503);
		expect(timeout).toHaveBeenCalledWith(ENGINE_READY_TIMEOUT_MS);
	});
});
