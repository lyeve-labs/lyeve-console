// Test support only. Nothing the console serves imports this file.
import { vi } from 'vitest';
import type { Cookies } from '@sveltejs/kit';

/*
 * The events every lab's server test sends. The labs are separate routes, so
 * their tests share one copy rather than three.
 */

export function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' },
	});
}

export const OPENAPI = {
	paths: {
		'/api/v1/content/{schema}': {
			post: { summary: 'Create a record', tags: ['Content API / Content'] },
		},
	},
};

/** A session and a csrf cookie, the way a signed-in browser presents them. */
export function mockCookies(csrf: string | null): Cookies {
	return {
		get: vi.fn((name: string) => {
			if (name === '__Host-csrf') return csrf ?? undefined;
			if (name === 'csrf') return undefined;
			return 'session-token';
		}),
		set: vi.fn(),
		delete: vi.fn(),
		getAll: vi.fn(() => []),
		serialize: vi.fn(() => ''),
	} as unknown as Cookies;
}

export function sendEvent(form: Record<string, string>, csrf: string | null = 'csrf-value') {
	const sent: { url: string; init: RequestInit }[] = [];
	const fetch = vi.fn(async (url: string, init?: RequestInit) => {
		sent.push({ url: String(url), init: init ?? {} });
		if (String(url).includes('openapi.json')) return json(OPENAPI);
		if (String(url).includes('grpc/status')) {
			return json({ listening: true, transcoded_routes: ['GET /api/content/{schema}'] });
		}
		return json({ ok: true }, 201);
	}) as unknown as typeof globalThis.fetch;

	const body = new URLSearchParams(form);
	return {
		sent,
		event: {
			fetch,
			cookies: mockCookies(csrf),
			request: new Request('http://x/admin/api-labs', {
				method: 'POST',
				body,
				headers: { 'content-type': 'application/x-www-form-urlencoded' },
			}),
		} as never,
	};
}

export function headerOf(init: RequestInit, name: string): string | undefined {
	return (init.headers as Record<string, string> | undefined)?.[name];
}
