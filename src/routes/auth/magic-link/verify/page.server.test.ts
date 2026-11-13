import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Cookies } from '@sveltejs/kit';
import { actions, load } from './+page.server';
import { resetRateLimitStore } from '$lib/server/rate-limit';

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function mockCookies(): Cookies {
	return { set: vi.fn(), get: vi.fn(), delete: vi.fn(), getAll: vi.fn(() => []), serialize: vi.fn() } as unknown as Cookies;
}

function event(fields: Record<string, string>, fetch: typeof globalThis.fetch, cookies = mockCookies()) {
	const formData = new FormData();
	for (const [k, v] of Object.entries(fields)) formData.set(k, v);
	return {
		getClientAddress: () => '127.0.0.1',
		request: { formData: () => Promise.resolve(formData) },
		fetch,
		cookies,
	} as never;
}

async function redirectOf(p: Promise<unknown>): Promise<{ status: number; location: string }> {
	try {
		await p;
	} catch (e) {
		const r = e as { status?: number; location?: string };
		if (r.status && r.location) return { status: r.status, location: r.location };
		throw e;
	}
	throw new Error('expected a redirect');
}

describe('auth/magic-link/verify load', () => {
	it('reads the token without redeeming it', () => {
		const data = load({ url: new URL('http://admin.test/auth/magic-link/verify?token=abc') } as never);
		expect(data).toEqual({ token: 'abc' });
	});
});

describe('auth/magic-link/verify actions', () => {
	beforeEach(() => resetRateLimitStore());

	it('redeems the token, sets the session and opens the console', async () => {
		const fetch = vi.fn(async (_url: string, _init: RequestInit) =>
			json({ access_token: 'sess', is_new_user: false, user_id: 'u1', email: 'a@b.co' })
		) as unknown as typeof globalThis.fetch;
		const cookies = mockCookies();

		const r = await redirectOf(Promise.resolve(actions.verify(event({ token: 'abc' }, fetch, cookies))));

		expect(r).toEqual({ status: 303, location: '/admin' });
		expect(cookies.set).toHaveBeenCalledWith('__Host-sys_session', 'sess', expect.objectContaining({ httpOnly: true }));
		const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
		expect(String(url)).toContain('/api/admin/auth/magic-link/verify');
		expect(JSON.parse(String(init.body))).toEqual({ token: 'abc' });
	});

	it('moves to the second factor when the account has one', async () => {
		const fetch = vi.fn(async () =>
			json({ mfa_required: true, challenge_token: 'ch', mfa_methods: ['totp'] })
		) as unknown as typeof globalThis.fetch;
		const cookies = mockCookies();

		const result = await actions.verify(event({ token: 'abc' }, fetch, cookies));

		expect(result).toEqual({ mfa_required: true, challenge_token: 'ch' });
		expect(cookies.set).not.toHaveBeenCalled();
	});

	it('reads a refused token as an expired link', async () => {
		const fetch = vi.fn(async () => json({ error: 'invalid or expired magic link' }, 400)) as unknown as typeof globalThis.fetch;
		const result = (await actions.verify(event({ token: 'spent' }, fetch))) as { status: number; data: { error: string } };
		expect(result.status).toBe(400);
		expect(result.data.error).toMatch(/no longer works/);
	});

	// The engine spends the link and answers 403 for an account the link can
	// never sign in, such as a super admin outside every tenant. A new link
	// ends the same way, so the reader is sent to the password form.
	it('sends an account the link cannot sign in to the password form', async () => {
		const fetch = vi.fn(async () => json({ error: 'authentication failed', code: 'forbidden' }, 403)) as unknown as typeof globalThis.fetch;
		const result = (await actions.verify(event({ token: 'abc' }, fetch))) as { status: number; data: Record<string, unknown> };
		expect(result.status).toBe(403);
		expect(result.data).toEqual({
			error: 'You cannot sign in to this account with an emailed link. Sign in with your password instead.',
			password: true,
		});
	});

	it('reads a 403 without the API error code as an expired link', async () => {
		const fetch = vi.fn(async () => new Response('<html>Forbidden</html>', { status: 403 })) as unknown as typeof globalThis.fetch;
		const result = (await actions.verify(event({ token: 'abc' }, fetch))) as { status: number; data: { error: string } };
		expect(result.data.error).toMatch(/no longer works/);
	});

	it('finishes the second factor and opens the console', async () => {
		const fetch = vi.fn(async (_url: string, _init: RequestInit) => json({ token: 'sess2', user: { id: 'u1' } })) as unknown as typeof globalThis.fetch;
		const cookies = mockCookies();

		const r = await redirectOf(Promise.resolve(actions.mfa(event({ challenge_token: 'ch', code: '123456' }, fetch, cookies))));

		expect(r.location).toBe('/admin');
		expect(cookies.set).toHaveBeenCalledWith('__Host-sys_session', 'sess2', expect.anything());
		const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
		expect(String(url)).toContain('/api/admin/auth/mfa-verify');
		expect(JSON.parse(String(init.body))).toEqual({ challenge_token: 'ch', code: '123456' });
	});

	it('keeps the challenge and calls a 422 a wrong code', async () => {
		const fetch = vi.fn(async () => json({ error: 'invalid code' }, 422)) as unknown as typeof globalThis.fetch;
		const result = (await actions.mfa(event({ challenge_token: 'ch', code: '000000' }, fetch))) as {
			status: number;
			data: Record<string, unknown>;
		};
		expect(result.status).toBe(400);
		expect(result.data).toEqual({ error: 'That code did not match. Try again.', mfa_required: true, challenge_token: 'ch' });
	});

	it('drops an expired challenge and asks for a new link', async () => {
		const fetch = vi.fn(async () => json({ error: 'The MFA challenge has expired. Please log in again.', code: 'AUTH_CHALLENGE_EXPIRED', request_id: 'r1' }, 401)) as unknown as typeof globalThis.fetch;
		const result = (await actions.mfa(event({ challenge_token: 'ch', code: '000000' }, fetch))) as {
			status: number;
			data: Record<string, unknown>;
		};
		expect(result.status).toBe(401);
		expect(result.data).toEqual({ error: 'This sign-in expired. Request a new link to sign in again.' });
	});

	// A code the engine never checked may be right, so it is not called wrong.
	it.each([
		['answers 503', async () => json({ error: 'session store unavailable' }, 503)],
		[
			'does not answer',
			async (): Promise<Response> => {
				throw new TypeError('fetch failed');
			},
		],
	])('keeps the challenge and says the code was not checked when the engine %s', async (_case, answer) => {
		const fetch = vi.fn(answer) as unknown as typeof globalThis.fetch;
		const result = (await actions.mfa(event({ challenge_token: 'ch', code: '123456' }, fetch))) as {
			status: number;
			data: Record<string, unknown>;
		};
		expect(result.status).toBe(503);
		expect(result.data).toEqual({
			error: 'The engine is unavailable, so your code was not checked. Try again in a moment.',
			mfa_required: true,
			challenge_token: 'ch',
		});
	});
});

describe('auth/magic-link/verify and the refresh cookie', () => {
	beforeEach(() => resetRateLimitStore());

	it('drops a refresh token left from an earlier session when the link answers none', async () => {
		const fetch = vi.fn(async () => json({ access_token: 'sess', user_id: 'u1' })) as unknown as typeof globalThis.fetch;
		const cookies = mockCookies();
		await redirectOf(Promise.resolve(actions.verify(event({ token: 'abc' }, fetch, cookies))));
		expect(cookies.delete).toHaveBeenCalledWith('__Host-console_refresh', expect.objectContaining({ path: '/', secure: true }));
	});

	it('keeps the refresh token the link answers', async () => {
		const fetch = vi.fn(async () => json({ access_token: 'sess', refresh_token: 'r1', user_id: 'u1' })) as unknown as typeof globalThis.fetch;
		const cookies = mockCookies();
		await redirectOf(Promise.resolve(actions.verify(event({ token: 'abc' }, fetch, cookies))));
		expect(cookies.set).toHaveBeenCalledWith('__Host-console_refresh', 'r1', expect.objectContaining({ httpOnly: true, secure: true }));
	});

	it('keeps the refresh token the second factor answers', async () => {
		const fetch = vi.fn(async () => json({ token: 'sess2', refresh_token: 'r2' })) as unknown as typeof globalThis.fetch;
		const cookies = mockCookies();
		await redirectOf(Promise.resolve(actions.mfa(event({ challenge_token: 'ch', code: '123456' }, fetch, cookies))));
		expect(cookies.set).toHaveBeenCalledWith('__Host-console_refresh', 'r2', expect.objectContaining({ httpOnly: true, secure: true }));
	});
});
