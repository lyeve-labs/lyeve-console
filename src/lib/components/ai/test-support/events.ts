/**
 * Load and action events for the AI page tests: a fetch that answers by path
 * and a cookie jar that holds a session, so a test states what the engine
 * answered and reads what the page made of it.
 */

import { vi } from 'vitest';
import type { Cookies } from '@sveltejs/kit';
import { fixtureSettings } from './fixtures';

export function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** A refusal in the engine's envelope, which carries a code beside the sentence. */
export function refused(status: number, error: string): Response {
	return json({ error, code: `http_${status}` }, status);
}

export function mockCookies(): Cookies {
	return {
		get: vi.fn((name: string) => (name === 'csrf' ? 'csrf-token' : 'tok')),
		set: vi.fn(),
		delete: vi.fn(),
		getAll: vi.fn(() => []),
		serialize: vi.fn(() => ''),
	} as unknown as Cookies;
}

export type Route = (url: string, init?: RequestInit) => Response | Promise<Response>;

/** A fetch that answers by path, recording every call. */
export function fetchFor(routes: Record<string, Route>, roles: string[] = ['super_admin']) {
	const calls: { url: string; init?: RequestInit }[] = [];
	const fetch = vi.fn(async (url: string, init?: RequestInit) => {
		const asked = String(url);
		calls.push({ url: asked, init });
		if (asked.includes('/auth/me')) return json({ id: 'u1', roles, disabled: false });
		for (const [needle, route] of Object.entries(routes)) {
			if (asked.includes(needle)) return route(asked, init);
		}
		return json({ error: 'no route' }, 404);
	}) as unknown as typeof globalThis.fetch;
	return { fetch, calls };
}

export function loadEvent(
	routes: Record<string, Route>,
	opts: { path?: string; params?: Record<string, string>; roles?: string[]; settings?: unknown } = {}
) {
	const { fetch, calls } = fetchFor(routes, opts.roles);
	const roles = opts.roles ?? ['super_admin'];
	return {
		calls,
		event: {
			fetch,
			cookies: mockCookies(),
			url: new URL(`http://localhost${opts.path ?? '/admin/ai/providers'}`),
			params: opts.params ?? {},
			parent: async () => ({
				user: { roles },
				aiSettings: opts.settings === undefined ? fixtureSettings : opts.settings,
				aiLayoutGate: { state: 'ok' },
				isSuperAdmin: roles.includes('super_admin'),
			}),
		} as never,
	};
}

export function actionEvent(
	routes: Record<string, Route>,
	form: FormData,
	opts: { path?: string; params?: Record<string, string>; roles?: string[] } = {}
) {
	const { fetch, calls } = fetchFor(routes, opts.roles);
	return {
		calls,
		event: {
			fetch,
			cookies: mockCookies(),
			request: { formData: async () => form },
			url: new URL(`http://localhost${opts.path ?? '/admin/ai/providers'}`),
			params: opts.params ?? {},
		} as never,
	};
}

export function formOf(fields: Record<string, string | string[]>): FormData {
	const data = new FormData();
	for (const [k, v] of Object.entries(fields)) {
		for (const each of Array.isArray(v) ? v : [v]) data.append(k, each);
	}
	return data;
}

/** The body the action's fetch sent, parsed. */
export function sentBody(calls: { url: string; init?: RequestInit }[], needle: string): unknown {
	const call = calls.find((c) => c.url.includes(needle) && c.init?.body);
	return call ? JSON.parse(String(call.init?.body)) : undefined;
}
