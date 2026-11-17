import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Cookies } from '@sveltejs/kit';
import { load, actions } from './+page.server';
import { resetRateLimitStore } from '#lib/server/rate-limit.ts';

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function mockCookies(initial: Record<string, string> = {}): Cookies {
	const store = { ...initial };
	return {
		get: vi.fn((name: string) => store[name] ?? undefined),
		set: vi.fn((name: string, value: string) => {
			store[name] = value;
		}),
		delete: vi.fn((name: string) => {
			delete store[name];
		}),
		getAll: vi.fn(() => []),
		serialize: vi.fn(() => ''),
	} as unknown as Cookies;
}

async function signIn(fields: Record<string, string>, answer: unknown, cookies: Cookies): Promise<void> {
	const form = new FormData();
	for (const [name, value] of Object.entries(fields)) form.set(name, value);
	const fetch = vi.fn(async () => json(answer)) as unknown as typeof globalThis.fetch;
	await Promise.resolve(
		actions.default({
			getClientAddress: () => '127.0.0.1',
			request: { formData: () => Promise.resolve(form) },
			fetch,
			cookies,
		} as never)
	).catch((e: { status?: number }) => {
		if (e.status !== 302) throw e;
	});
}

const REFRESH_ATTRS = expect.objectContaining({ path: '/', secure: true, httpOnly: true, sameSite: 'strict' });

beforeEach(() => resetRateLimitStore());

describe('sign-in keeps the refresh token', () => {
	it('from a password sign-in', async () => {
		const cookies = mockCookies();
		await signIn({ email: 'a@b.co', password: 'pw' }, { user: { id: 'u1' }, token: 't', refresh_token: 'r1' }, cookies);
		expect(cookies.set).toHaveBeenCalledWith('__Host-console_refresh', 'r1', REFRESH_ATTRS);
	});

	it('from the second-factor step', async () => {
		const cookies = mockCookies();
		await signIn({ challenge_token: 'ch', code: '123456' }, { token: 't', refresh_token: 'r2' }, cookies);
		expect(cookies.set).toHaveBeenCalledWith('__Host-console_refresh', 'r2', REFRESH_ATTRS);
	});

	it('and drops one left from an earlier session when the engine answers none', async () => {
		const cookies = mockCookies({ '__Host-console_refresh': 'stale' });
		await signIn({ email: 'a@b.co', password: 'pw' }, { user: { id: 'u1' }, token: 't' }, cookies);
		expect(cookies.delete).toHaveBeenCalledWith('__Host-console_refresh', expect.objectContaining({ path: '/', secure: true }));
	});
});

describe('the sign-in page after a session ended', () => {
	it('is told so by the address the session sent it to', async () => {
		const fetch = vi.fn(async () => json([])) as unknown as typeof globalThis.fetch;
		const url = new URL('https://admin.example.com/login?ended=1');
		const out = (await load({ fetch, cookies: mockCookies(), url } as never)) as { ended: boolean };
		expect(out.ended).toBe(true);
	});
});
