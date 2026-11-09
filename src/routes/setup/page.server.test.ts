import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Cookies } from '@sveltejs/kit';
import { load, actions } from './+page.server';
import { resetRateLimitStore } from '$lib/server/rate-limit';

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function mockCookies(): Cookies {
	return {
		get: vi.fn(() => undefined),
		set: vi.fn(),
		delete: vi.fn(),
		getAll: vi.fn(() => []),
		serialize: vi.fn(() => ''),
	} as unknown as Cookies;
}

function catchRedirect(fn: () => unknown): Promise<{ status: number; location: string }> {
	return Promise.resolve(fn()).then(
		() => {
			throw new Error('expected redirect but got success');
		},
		(e: unknown) => {
			const err = e as { status?: number; location?: string };
			if (err.status && err.location) return { status: err.status, location: err.location };
			throw e;
		},
	);
}

const ENGINE_SILENT = 'Could not reach the engine. If you just restarted it, wait a moment and try again.';

function fetchReturning(body: unknown, status = 200) {
	return vi.fn(async (_url: string, _init?: RequestInit) => json(body, status)) as unknown as typeof globalThis.fetch;
}

function loadEvent(fetch: typeof globalThis.fetch, search = '') {
	return { fetch, url: new URL(`http://localhost/setup${search}`) } as never;
}

function form(data: Record<string, string>): FormData {
	const fd = new FormData();
	for (const [k, v] of Object.entries(data)) fd.set(k, v);
	return fd;
}

function actionEvent(fields: Record<string, string>, fetch: unknown, cookies = mockCookies()) {
	return {
		getClientAddress: () => '127.0.0.1',
		request: { formData: () => Promise.resolve(form(fields)) },
		fetch,
		cookies,
	} as never;
}

describe('setup load', () => {
	it('reports an unreachable engine as its own state', async () => {
		const fetch = vi.fn(async () => {
			throw new Error('connect ECONNREFUSED');
		}) as unknown as typeof globalThis.fetch;
		expect(await load(loadEvent(fetch))).toEqual({ state: 'unreachable', tokenSource: null, next: null });
	});

	it('reports setup mode with where the token is', async () => {
		const result = await load(loadEvent(fetchReturning({ setup_required: true, mode: 'setup', token_source: 'log' })));
		expect(result).toEqual({ state: 'setup_mode', tokenSource: 'log', next: null });
	});

	it('reports an engine waiting for its first admin', async () => {
		const result = await load(loadEvent(fetchReturning({ setup_required: true, token_source: 'env' })));
		expect(result).toEqual({ state: 'needs_admin', tokenSource: 'env', next: null });
	});

	it('sends a finished install to sign in', async () => {
		const r = await catchRedirect(() => load(loadEvent(fetchReturning({ setup_required: false }))));
		expect(r.location).toBe('/login');
	});

	it('returns to the page the gate interrupted once the engine is back', async () => {
		const r = await catchRedirect(() =>
			load(loadEvent(fetchReturning({ setup_required: false }), '?next=%2Fadmin%2Fusers')),
		);
		expect(r.location).toBe('/admin/users');
	});

	it('ignores a next that leaves the origin', async () => {
		const r = await catchRedirect(() =>
			load(loadEvent(fetchReturning({ setup_required: false }), '?next=%2F%2Fevil.example')),
		);
		expect(r.location).toBe('/login');
	});
});

describe('setup actions.status', () => {
	beforeEach(() => resetRateLimitStore());

	it('refuses to call the engine without a token', async () => {
		const fetch = vi.fn();
		const result = (await actions.status(actionEvent({}, fetch))) as { status: number };
		expect(result.status).toBe(400);
		expect(fetch).not.toHaveBeenCalled();
	});

	it('sends the token in the header and returns what the engine reports', async () => {
		const body = { mode: 'setup', missing: [], secrets_included: true, env: 'X=1\n', yaml: 'x: 1\n', restart: [] };
		const fetch = fetchReturning(body);
		const result = await actions.status(actionEvent({ setup_token: 'tok-from-log' }, fetch));
		expect(result).toEqual({ status: body });

		const [url, init] = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
		expect(String(url)).toContain('/api/admin/setup/status');
		expect(new Headers(init.headers).get('X-Setup-Token')).toBe('tok-from-log');
	});

	it('says the token was refused on 401', async () => {
		const fetch = fetchReturning({ code: 'AUTH_SETUP_TOKEN_INVALID' }, 401);
		const result = (await actions.status(actionEvent({ setup_token: 'wrong' }, fetch))) as {
			status: number;
			data: { error: string };
		};
		expect(result.status).toBe(401);
		expect(result.data.error).toContain('setup token');
	});

	it('treats a 404 as the engine having left setup mode', async () => {
		const result = await actions.status(actionEvent({ setup_token: 'tok' }, fetchReturning({}, 404)));
		expect(result).toEqual({ status: null });
	});

	it('tells the operator to try again when the engine is down', async () => {
		const fetch = vi.fn(async () => {
			throw new TypeError('fetch failed');
		});
		const result = (await actions.status(actionEvent({ setup_token: 'tok' }, fetch))) as {
			status: number;
			data: { error: string };
		};
		expect(result.status).toBe(503);
		expect(result.data.error).toBe(ENGINE_SILENT);
	});
});

describe('setup actions.create', () => {
	beforeEach(() => resetRateLimitStore());

	const valid = { setup_token: 'tok-from-log', email: 'a@b.co', password: 'password123', confirm: 'password123' };

	it('refuses to call the engine without a setup token', async () => {
		const fetch = vi.fn();
		const { setup_token: _omit, ...rest } = valid;
		const result = await actions.create(actionEvent(rest, fetch));
		expect(result).toEqual({ error: 'Enter the setup token.' });
		expect(fetch).not.toHaveBeenCalled();
	});

	it('returns error when email is missing', async () => {
		const result = await actions.create(actionEvent({ setup_token: 't', password: 'pw', confirm: 'pw' }, vi.fn()));
		expect(result).toEqual({ error: 'Enter your email and password.' });
	});

	it('returns error when passwords do not match', async () => {
		const result = await actions.create(actionEvent({ ...valid, confirm: 'other-password' }, vi.fn()));
		expect(result).toEqual({ error: 'The passwords do not match.' });
	});

	// The engine's hasher fails a password over 72 bytes with a 500 that names
	// no rule, so the action refuses one first and puts the limit on the field.
	it('refuses a password over 72 bytes before asking the engine', async () => {
		const fetch = vi.fn();
		const long = 'é'.repeat(37);
		const result = (await actions.create(actionEvent({ ...valid, password: long, confirm: long }, fetch))) as {
			status: number;
			data: { error: string; fields: { password: string } };
		};
		expect(result.status).toBe(400);
		expect(result.data.fields.password).toMatch(/at most 72 bytes/);
		expect(fetch).not.toHaveBeenCalled();
	});

	it('names the rule the engine refused the password for', async () => {
		const refusal = { code: 'AUTH_PASSWORD_TOO_SHORT', error: 'Password must be at least 12 characters.' };
		const result = (await actions.create(
			actionEvent({ ...valid, password: 'Short1pass', confirm: 'Short1pass' }, fetchReturning(refusal, 422)),
		)) as { status: number; data: { error: string } };
		expect(result.status).toBe(422);
		expect(result.data.error).toBe('Password must be at least 12 characters.');
	});

	it('sets the session cookie, sends the token, and redirects on success', async () => {
		const fetch = fetchReturning({ user: { id: 'u1' }, token: 'setup-session-token' });
		const cookies = mockCookies();

		const r = await catchRedirect(() => actions.create(actionEvent(valid, fetch, cookies)));

		expect(cookies.set).toHaveBeenCalledWith('__Host-sys_session', 'setup-session-token', expect.objectContaining({ path: '/' }));
		const sent = JSON.parse(String((fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0][1].body));
		expect(sent).toEqual({ email: 'a@b.co', password: 'password123', setup_token: 'tok-from-log' });
		expect(r.location).toBe('/admin');
	});

	it('says the token was refused when the engine answers 401', async () => {
		const cookies = mockCookies();
		const result = (await actions.create(actionEvent(valid, fetchReturning({}, 401), cookies))) as {
			status: number;
			data: { error: string };
		};
		expect(result.status).toBe(401);
		expect(result.data.error).toContain('setup token');
		expect(cookies.set).not.toHaveBeenCalled();
	});

	it('sends the operator to sign in when setup is already complete', async () => {
		const r = await catchRedirect(() => actions.create(actionEvent(valid, fetchReturning({}, 409))));
		expect(r.location).toBe('/login');
	});

	// An engine that did not answer judged nothing about the form, so the
	// operator is told to wait and try again rather than that setup failed.
	it.each([
		['a 503', async () => json({ code: 'DATABASE_ERROR' }, 503)],
		[
			'no answer at all',
			async (): Promise<Response> => {
				throw new Error('driver: connection reset');
			},
		],
	])('tells the operator to try again after %s, without the detail', async (_case, answer) => {
		const cookies = mockCookies();
		const result = (await actions.create(actionEvent(valid, vi.fn(answer), cookies))) as {
			status: number;
			data: { error: string };
		};
		expect(result.status).toBe(503);
		expect(result.data.error).toBe(ENGINE_SILENT);
		expect(cookies.set).not.toHaveBeenCalled();
	});

	it('keeps the plain failure for a refusal it has no words for', async () => {
		const result = await actions.create(actionEvent(valid, fetchReturning({ error: 'forbidden' }, 403)));
		expect(result).toEqual({ error: 'Could not finish setup. Try again.' });
	});
});

describe('setup and the refresh cookie', () => {
	beforeEach(() => resetRateLimitStore());

	it('drops a refresh token left from an earlier session, since setup answers none', async () => {
		const fetch = fetchReturning({ user: { id: 'u1' }, token: 'setup-session-token' });
		const cookies = mockCookies();
		const valid = { setup_token: 'tok', email: 'a@b.co', password: 'password123', confirm: 'password123' };
		await catchRedirect(() => actions.create(actionEvent(valid, fetch, cookies)));
		expect(cookies.delete).toHaveBeenCalledWith('__Host-console_refresh', expect.objectContaining({ path: '/', secure: true }));
	});
});
