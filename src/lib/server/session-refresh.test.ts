import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Cookies, RequestEvent } from '@sveltejs/kit';
// SvelteKit's own request cookie jar, so the tests read a cookie back the way
// a load does after this step set it.
// @ts-expect-error SvelteKit ships this module without type declarations.
import { get_cookies } from '../../../node_modules/@sveltejs/kit/src/runtime/server/cookie.js';
import { authedHeaders } from '$lib/server/authz';

type SessionRefresh = typeof import('./session-refresh');
let refreshSession: SessionRefresh['refreshSession'];
let needsRefresh: SessionRefresh['needsRefresh'];
let tradeOnce: SessionRefresh['tradeOnce'];

const NOW = Date.parse('2026-10-14T12:00:00Z');

/** An unsigned token with the claims this step reads. The engine checks signatures, this step does not. */
function jwt(claims: { exp: number; sub?: string }): string {
	const part = (v: object) => Buffer.from(JSON.stringify(v)).toString('base64url');
	return `${part({ alg: 'HS256', typ: 'JWT' })}.${part({ sub: 'user-1', ...claims })}.signature`;
}

/** A refresh token in the engine's shape: a family UUID, a dot, 32 bytes of base64url. */
function refreshOf(n: number): string {
	const family = `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
	return `${family}.${Buffer.alloc(32, n % 256).toString('base64url')}`;
}

const secs = (ms: number) => Math.floor(ms / 1000);
const FRESH = jwt({ exp: secs(NOW) + 600 });
const CLOSE = jwt({ exp: secs(NOW) + 90 });
const EXPIRED = jwt({ exp: secs(NOW) - 30 });
const RENEWED = jwt({ exp: secs(NOW) + 900 });
const RT1 = refreshOf(1);
const RT2 = refreshOf(2);

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function renewing(token = RENEWED, refresh = RT2) {
	return vi.fn(async () => json({ token, refresh_token: refresh, csrf_token: 'c', expires_in: 900 }));
}

interface Shape {
	method?: string;
	scheme?: 'https' | 'http';
	/** null stands for an adapter that cannot tell the address. */
	address?: string | null;
}

/** A request event whose cookies behave as SvelteKit's do inside handle. */
function event(path: string, cookies: Record<string, string>, fetch: typeof globalThis.fetch, shape: Shape = {}): RequestEvent {
	const url = new URL(`${shape.scheme ?? 'https'}://admin.example.com${path}`);
	const header = Object.entries(cookies)
		.map(([name, value]) => `${name}=${value}`)
		.join('; ');
	const request = new Request(url, { method: shape.method ?? 'GET', headers: header ? { cookie: header } : {} });
	const jar = get_cookies(request, url);
	jar.set_trailing_slash('never');
	const getClientAddress = () => {
		if (shape.address === null) throw new Error('Could not determine clientAddress');
		return shape.address ?? '203.0.113.7';
	};
	return { url, request, fetch, cookies: jar.cookies as Cookies, getClientAddress } as unknown as RequestEvent;
}

function signedIn(token: string, fetch: typeof globalThis.fetch, path = '/admin/users', shape: Shape = {}) {
	return event(path, { '__Host-sys_session': token, '__Host-console_refresh': RT1 }, fetch, shape);
}

async function redirectOf(fn: () => Promise<unknown>): Promise<{ status: number; location: string } | null> {
	try {
		await fn();
		return null;
	} catch (e) {
		const r = e as { status?: number; location?: string };
		if (r.status && r.location) return { status: r.status, location: r.location };
		throw e;
	}
}

// The module keeps its trades in memory, so each test loads it afresh.
beforeEach(async () => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(NOW);
	vi.resetModules();
	({ refreshSession, needsRefresh, tradeOnce } = await import('./session-refresh'));
});

afterEach(() => {
	vi.useRealTimers();
});

describe('when the session token is traded', () => {
	it('waits while more than two minutes are left', () => {
		expect(needsRefresh(FRESH, NOW)).toBe(false);
		expect(needsRefresh(jwt({ exp: secs(NOW) + 121 }), NOW)).toBe(false);
	});

	it('trades a token with under two minutes left, or one already expired', () => {
		expect(needsRefresh(CLOSE, NOW)).toBe(true);
		expect(needsRefresh(EXPIRED, NOW)).toBe(true);
	});

	it('leaves a token with no readable expiry to the engine', () => {
		expect(needsRefresh('not-a-jwt', NOW)).toBe(false);
		expect(needsRefresh('a.b.c', NOW)).toBe(false);
	});

	it('does not call the engine for a token with time left', async () => {
		const fetch = renewing();
		await refreshSession(signedIn(FRESH, fetch));
		expect(fetch).not.toHaveBeenCalled();
	});

	it('does nothing without a refresh token, as after a provider sign-in', async () => {
		const fetch = renewing();
		const e = event('/admin/users', { '__Host-sys_session': EXPIRED }, fetch);
		await refreshSession(e);
		expect(fetch).not.toHaveBeenCalled();
		expect(e.cookies.get('__Host-sys_session')).toBe(EXPIRED);
	});
});

describe('a renewed session', () => {
	it('sends the refresh token and writes both new cookies', async () => {
		const fetch = renewing();
		const e = signedIn(CLOSE, fetch);
		await refreshSession(e);

		expect(fetch).toHaveBeenCalledTimes(1);
		const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe('/api/admin/auth/refresh');
		expect(init.method).toBe('POST');
		expect(JSON.parse(String(init.body))).toEqual({ refresh_token: RT1 });
		expect(e.cookies.get('__Host-sys_session')).toBe(RENEWED);
		expect(e.cookies.get('__Host-console_refresh')).toBe(RT2);
	});

	it('reaches every load and action later in the same request', async () => {
		const e = signedIn(EXPIRED, renewing());
		await refreshSession(e);
		expect(authedHeaders(e).Authorization).toBe(`Bearer ${RENEWED}`);
	});

	it('is restored for a request that brought only the refresh token', async () => {
		const fetch = renewing();
		const e = event('/admin/users', { '__Host-console_refresh': RT1 }, fetch);
		await refreshSession(e);
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(e.cookies.get('__Host-sys_session')).toBe(RENEWED);
		expect(e.cookies.get('__Host-console_refresh')).toBe(RT2);
	});

	it('reads and writes the plain cookie names over HTTP', async () => {
		const fetch = renewing();
		const e = event('/admin/users', { sys_session: CLOSE, console_refresh: RT1 }, fetch, { scheme: 'http' });
		await refreshSession(e);
		expect(JSON.parse(String((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toEqual({ refresh_token: RT1 });
		expect(e.cookies.get('sys_session')).toBe(RENEWED);
		expect(e.cookies.get('console_refresh')).toBe(RT2);
		expect(e.cookies.get('__Host-sys_session')).toBeUndefined();
	});

	it('is not taken over by a refresh token left from another account', async () => {
		const fetch = renewing(jwt({ exp: secs(NOW) + 900, sub: 'user-2' }));
		const e = signedIn(CLOSE, fetch);
		await refreshSession(e);
		expect(e.cookies.get('__Host-sys_session')).toBe(CLOSE);
		expect(e.cookies.get('__Host-console_refresh')).toBeUndefined();
	});
});

describe('one trade per refresh token', () => {
	it('runs once for requests sent at the same time', async () => {
		const pending: ((r: Response) => void)[] = [];
		const fetch = vi.fn(() => new Promise<Response>((resolve) => pending.push(resolve)));
		const first = signedIn(CLOSE, fetch);
		const second = signedIn(CLOSE, fetch);

		const both = Promise.all([refreshSession(first), refreshSession(second)]);
		for (const answer of pending) answer(json({ token: RENEWED, refresh_token: RT2 }));
		await both;

		expect(fetch).toHaveBeenCalledTimes(1);
		expect(second.cookies.get('__Host-sys_session')).toBe(RENEWED);
		expect(second.cookies.get('__Host-console_refresh')).toBe(RT2);
	});

	it('serves the answer for ten seconds to a request with the same old cookies', async () => {
		const fetch = renewing();
		await refreshSession(signedIn(CLOSE, fetch));

		vi.setSystemTime(NOW + 9_000);
		const late = signedIn(CLOSE, fetch);
		await refreshSession(late);
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(late.cookies.get('__Host-sys_session')).toBe(RENEWED);

		vi.setSystemTime(NOW + 11_000);
		await refreshSession(signedIn(CLOSE, fetch));
		expect(fetch).toHaveBeenCalledTimes(2);
	});

	// A copied refresh token sent on its own, or beside another session
	// cookie, has to reach the engine, which revokes a family whose rotated
	// token comes back.
	it('sends the old refresh token to the engine when the session cookie differs', async () => {
		const fetch = renewing();
		await refreshSession(signedIn(CLOSE, fetch));
		await refreshSession(signedIn(EXPIRED, fetch));
		expect(fetch).toHaveBeenCalledTimes(2);
	});

	it('sends the old refresh token to the engine when no session cookie came with it', async () => {
		const fetch = renewing();
		await refreshSession(signedIn(CLOSE, fetch));
		await refreshSession(event('/admin/users', { '__Host-console_refresh': RT1 }, fetch));
		expect(fetch).toHaveBeenCalledTimes(2);
	});

	it('does not share a running trade with a request that carries another session cookie', async () => {
		const pending: ((r: Response) => void)[] = [];
		const fetch = vi.fn(() => new Promise<Response>((resolve) => pending.push(resolve)));
		const both = Promise.all([refreshSession(signedIn(CLOSE, fetch)), refreshSession(signedIn(EXPIRED, fetch))]);
		for (const answer of pending) answer(json({ token: RENEWED, refresh_token: RT2 }));
		await both;
		expect(fetch).toHaveBeenCalledTimes(2);
	});

	it('keeps at most ten thousand answers, dropping the oldest', async () => {
		const fetch = renewing();
		for (let n = 1; n <= 10_001; n++) await tradeOnce(refreshOf(n), CLOSE, `198.51.100.${n}`, fetch);
		expect(fetch).toHaveBeenCalledTimes(10_001);

		await tradeOnce(refreshOf(10_001), CLOSE, 'kept', fetch);
		expect(fetch).toHaveBeenCalledTimes(10_001);
		await tradeOnce(refreshOf(1), CLOSE, 'dropped', fetch);
		expect(fetch).toHaveBeenCalledTimes(10_002);
	});
});

describe('a refresh cookie the engine could not have written', () => {
	it.each([
		['a short value', 'refresh-1'],
		['no family id', `.${'A'.repeat(43)}`],
		['a long forged value', `00000000-0000-4000-8000-000000000001.${'A'.repeat(4000)}`],
	])('is refused here without asking the engine: %s', async (_name, forged) => {
		const fetch = renewing();
		const e = event('/admin/users', { '__Host-sys_session': CLOSE, '__Host-console_refresh': forged }, fetch);
		await refreshSession(e);
		expect(fetch).not.toHaveBeenCalled();
		expect(e.cookies.get('__Host-console_refresh')).toBeUndefined();
		expect(e.cookies.get('__Host-sys_session')).toBe(CLOSE);
	});
});

describe('trades from one address', () => {
	const expiring = (n: number) => ({ '__Host-sys_session': jwt({ exp: secs(NOW) + 60, sub: `user-${n}` }), '__Host-console_refresh': refreshOf(n) });

	// An office network signs many readers in from one address, and each of
	// them renews. Renewals never count.
	it('all reach the engine when the engine renews them', async () => {
		const fetch = vi.fn(async () => json({ token: RENEWED, refresh_token: RT2 }));
		for (let n = 1; n <= 20; n++) await refreshSession(event('/admin/users', expiring(n), fetch));
		expect(fetch).toHaveBeenCalledTimes(20);
	});

	// A thousand forged cookies sent at once would all be on their way before
	// the first refusal came back, so a trade counts from the moment it starts.
	it('are held back during a burst, before any refusal has come back', async () => {
		const pending: ((r: Response) => void)[] = [];
		const fetch = vi.fn(() => new Promise<Response>((resolve) => pending.push(resolve)));
		const burst = Array.from({ length: 50 }, (_, i) => refreshSession(event('/settings', expiring(i + 1), fetch)));
		await Promise.resolve();
		for (const answer of pending) answer(json({ error: 'token reuse' }, 401));
		await Promise.all(burst);
		expect(fetch.mock.calls.length).toBeLessThanOrEqual(10);
	});

	// An outage is no refusal. A busy address that met one has to keep
	// reaching the engine once it answers again.
	it('are not held back after outages', async () => {
		const answers = [
			async () => json({ error: 'unavailable' }, 503),
			async () => json({ error: 'rate limited' }, 429),
			async () => Promise.reject(new TypeError('fetch failed')),
		];
		let call = 0;
		const fetch = vi.fn(() => answers[call++ % answers.length]());
		for (let n = 1; n <= 11; n++) await refreshSession(event('/settings', expiring(n), fetch as unknown as typeof globalThis.fetch));
		expect(fetch).toHaveBeenCalledTimes(11);

		await refreshSession(event('/settings', expiring(12), fetch as unknown as typeof globalThis.fetch));
		expect(fetch).toHaveBeenCalledTimes(12);
	});

	it('are held back after ten refusals, and the session is left as it is', async () => {
		const fetch = vi.fn(async () => json({ error: 'token reuse' }, 401));
		for (let n = 1; n <= 10; n++) await refreshSession(event('/settings', expiring(n), fetch));
		expect(fetch).toHaveBeenCalledTimes(10);

		const held = event('/admin/users', expiring(11), fetch);
		expect(await redirectOf(() => refreshSession(held))).toBeNull();
		expect(fetch).toHaveBeenCalledTimes(10);
		expect(held.cookies.get('__Host-console_refresh')).toBe(refreshOf(11));

		await refreshSession(event('/settings', expiring(12), fetch, { address: '192.0.2.1' }));
		expect(fetch).toHaveBeenCalledTimes(11);

		vi.setSystemTime(NOW + 61_000);
		await refreshSession(event('/settings', expiring(13), fetch));
		expect(fetch).toHaveBeenCalledTimes(12);
	});

	it('still renew where the adapter cannot tell the address', async () => {
		const fetch = renewing();
		const e = signedIn(CLOSE, fetch, '/admin/users', { address: null });
		await refreshSession(e);
		expect(e.cookies.get('__Host-sys_session')).toBe(RENEWED);
	});
});

describe('a refused refresh', () => {
	it('clears both cookies and sends an admin page to the sign-in notice', async () => {
		const fetch = vi.fn(async () => json({ error: 'session revoked' }, 401));
		const e = signedIn(CLOSE, fetch);

		const r = await redirectOf(() => refreshSession(e));

		expect(r).toEqual({ status: 303, location: '/login?ended=1&next=%2Fadmin%2Fusers' });
		expect(e.cookies.get('__Host-sys_session')).toBeUndefined();
		expect(e.cookies.get('__Host-console_refresh')).toBeUndefined();
	});

	it('sends the reader back to the page and query they asked for', async () => {
		const fetch = vi.fn(async () => json({ error: 'session revoked' }, 401));
		const r = await redirectOf(() => refreshSession(signedIn(CLOSE, fetch, '/admin/content/posts?offset=40')));
		expect(r?.location).toBe('/login?ended=1&next=%2Fadmin%2Fcontent%2Fposts%3Foffset%3D40');
	});

	// SvelteKit answers a redirect thrown from handle during an enhanced form
	// submit as JSON, and the form then follows it. The address names the
	// action, so only the page goes along.
	it('sends a form action to the sign-in notice with the page alone', async () => {
		const fetch = vi.fn(async () => json({ error: 'session revoked' }, 401));
		const e = signedIn(CLOSE, fetch, '/admin/users?/delete', { method: 'POST' });
		const r = await redirectOf(() => refreshSession(e));
		expect(r).toEqual({ status: 303, location: '/login?ended=1&next=%2Fadmin%2Fusers' });
		expect(e.cookies.get('__Host-sys_session')).toBeUndefined();
	});

	it('clears both cookies and lets the sign-in page itself render', async () => {
		const fetch = vi.fn(async () => json({ error: 'session revoked' }, 401));
		const e = signedIn(EXPIRED, fetch, '/login');

		expect(await redirectOf(() => refreshSession(e))).toBeNull();
		expect(e.cookies.get('__Host-sys_session')).toBeUndefined();
		expect(e.cookies.get('__Host-console_refresh')).toBeUndefined();
	});
});

describe('an engine that cannot answer', () => {
	it.each([
		['a 503', async () => json({ error: 'session store unavailable' }, 503)],
		['a 429', async () => json({ error: 'rate limited' }, 429)],
		['no answer', async () => Promise.reject(new TypeError('fetch failed'))],
	])('keeps the cookies and lets the request through on %s', async (_name, answer) => {
		const fetch = vi.fn(answer);
		const e = signedIn(EXPIRED, fetch as unknown as typeof globalThis.fetch);

		expect(await redirectOf(() => refreshSession(e))).toBeNull();
		expect(e.cookies.get('__Host-sys_session')).toBe(EXPIRED);
		expect(e.cookies.get('__Host-console_refresh')).toBe(RT1);
	});

	it('is asked again on the next request', async () => {
		const fetch = vi.fn(async () => json({ error: 'unavailable' }, 503));
		await refreshSession(signedIn(EXPIRED, fetch));
		await refreshSession(signedIn(EXPIRED, fetch));
		expect(fetch).toHaveBeenCalledTimes(2);
	});
});

describe('a request that is part of a renewal', () => {
	/** Fails a renewal that never settles instead of letting the test time out. */
	function settles(work: Promise<void>): Promise<void> {
		return Promise.race([
			work,
			new Promise<void>((_, reject) => setTimeout(() => reject(new Error('the renewal waited on itself')), 1_000)),
		]);
	}

	/** An engine call that first comes back into this console as inner, with the same cookies. */
	function comingBack(inner: (engine: typeof globalThis.fetch) => RequestEvent) {
		const engine = renewing();
		const fetch = vi.fn(async () => {
			// The request arrives after this trade is under way, as it does through a real fetch.
			await new Promise((resolve) => setTimeout(resolve, 0));
			await refreshSession(inner(engine));
			return engine();
		});
		return { engine, fetch };
	}

	it('finishes when its call comes back as a request this console made to itself', async () => {
		const { engine, fetch } = comingBack((f) =>
			Object.assign(signedIn(CLOSE, f, '/admin/users'), { isSubRequest: true })
		);
		const e = signedIn(CLOSE, fetch);
		await settles(refreshSession(e));
		expect(engine).toHaveBeenCalledTimes(1);
		expect(e.cookies.get('__Host-sys_session')).toBe(RENEWED);
	});

	it('finishes when its call comes back over the network to the refresh route', async () => {
		const { engine, fetch } = comingBack((f) => signedIn(CLOSE, f, '/api/admin/auth/refresh'));
		const e = signedIn(CLOSE, fetch);
		await settles(refreshSession(e));
		expect(engine).toHaveBeenCalledTimes(1);
		expect(e.cookies.get('__Host-sys_session')).toBe(RENEWED);
	});
});
