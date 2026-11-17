import { describe, expect, it, vi } from 'vitest';
import type { Cookies } from '@sveltejs/kit';
import { actions, load } from './+page.server';
import { OUTAGE } from '#lib/outage.ts';

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function cookies(initial: Record<string, string> = {}): Cookies {
	const store = { ...initial };
	return {
		get: vi.fn((name: string) => store[name]),
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

const signedIn = () => cookies({ '__Host-sys_session': 'session-token', '__Host-csrf': 'csrf-token' });

const pendingRequest = {
	user_code: 'WDJB-MJHT',
	client_name: 'cli on build-box',
	requester_ip: '203.0.113.7',
	created_at: '2026-09-26T12:00:00Z',
	expires_at: '2026-09-26T12:10:00Z',
	tenant_id: 'default',
	roles: ['admin'],
	session_expires_in: 900,
	approver_ip: '198.51.100.4',
	same_address: false,
};

/** An engine that answers /auth/me with roles and the device routes with routes. */
function engine(roles: string[], routes: Record<string, () => Response> = {}) {
	return vi.fn(async (url: string, _init?: RequestInit) => {
		const u = String(url);
		if (u.endsWith('/api/admin/auth/me')) return json({ id: 'u1', email: 'admin@example.com', roles });
		for (const [suffix, answer] of Object.entries(routes)) {
			if (u.endsWith(suffix)) return answer();
		}
		return json({ error: 'not found' }, 404);
	});
}

async function redirected(fn: () => unknown): Promise<{ status: number; location: string }> {
	try {
		await fn();
	} catch (e) {
		const r = e as { status?: number; location?: string };
		if (r.status && r.location) return { status: r.status, location: r.location };
		throw e;
	}
	throw new Error('expected a redirect');
}

function loadEvent(search: string, fetch: ReturnType<typeof engine>, jar = signedIn()) {
	return { url: new URL(`http://admin.test/admin/device${search}`), cookies: jar, fetch } as never;
}

describe('admin/device load', () => {
	it('sends a signed-out visitor to sign in and back with the code', async () => {
		const r = await redirected(() => load(loadEvent('?code=WDJB-MJHT', engine(['admin']), cookies())));
		expect(r.status).toBe(302);
		expect(r.location).toBe('/login?next=%2Fadmin%2Fdevice%3Fcode%3DWDJB-MJHT');
	});

	it('sends a revoked session to sign in and drops its cookie', async () => {
		const fetch = vi.fn(async () => json({ error: 'session invalidated' }, 401));
		const jar = signedIn();
		const r = await redirected(() => load(loadEvent('?code=WDJB-MJHT', fetch as never, jar)));
		expect(r.location).toContain('/login?next=');
		expect(jar.delete).toHaveBeenCalled();
	});

	// The engine answers 503 when its database cannot check a session, so that
	// an outage signs nobody out. The approval page keeps that promise too.
	it.each([
		['answers 503', async () => json({ error: 'session check unavailable' }, 503)],
		[
			'does not answer',
			async (): Promise<Response> => {
				throw new TypeError('fetch failed');
			},
		],
	])('keeps the cookie and shows the outage page when the engine %s', async (_case, answer) => {
		const jar = signedIn();
		const thrown = (await Promise.resolve(load(loadEvent('?code=WDJB-MJHT', vi.fn(answer) as never, jar))).then(
			() => {
				throw new Error('expected the outage page');
			},
			(e: unknown) => e,
		)) as { status?: number; location?: string; body?: { message?: string } };
		expect(jar.delete).not.toHaveBeenCalled();
		expect(thrown.location).toBeUndefined();
		expect(thrown.status).toBe(503);
		expect(thrown.body?.message).toBe(OUTAGE.body);
	});

	it('asks for the code when none came with the link', async () => {
		const data = await load(loadEvent('', engine(['admin'])));
		expect(data).toMatchObject({ view: 'enter', code: '', request: null, email: 'admin@example.com' });
	});

	it('shows the pending request for a code typed in any case', async () => {
		const fetch = engine(['admin'], {
			'/api/admin/auth/device/WDJB-MJHT': () => json(pendingRequest),
			'/api/admin/mfa/status': () => json({ enabled: true }),
		});
		const data = await load(loadEvent('?code=wdjbmjht', fetch));
		expect(data).toMatchObject({ view: 'pending', code: 'WDJB-MJHT', request: pendingRequest, mfaEnrolled: true });
	});

	it('names an expired, decided or unknown code', async () => {
		const cases: [string, string][] = [
			['This code has expired. Start the sign-in again on the device.', 'expired'],
			['This sign-in was already approved or denied.', 'decided'],
			['No sign-in is waiting for this code.', 'unknown'],
		];
		for (const [message, view] of cases) {
			const fetch = engine(['admin'], { '/api/admin/auth/device/WDJB-MJHT': () => json({ error: message }, 404) });
			const data = await load(loadEvent('?code=WDJB-MJHT', fetch));
			expect(data, message).toMatchObject({ view });
		}
	});

	it('answers a malformed code without asking the engine', async () => {
		const fetch = engine(['admin']);
		const data = await load(loadEvent('?code=0000-0000', fetch));
		expect(data).toMatchObject({ view: 'unknown' });
		expect(fetch.mock.calls.some(([u]) => String(u).includes('/auth/device'))).toBe(false);
	});

	it('tells an editor it cannot approve, and never reads the request', async () => {
		const fetch = engine(['editor'], { '/api/admin/auth/device/WDJB-MJHT': () => json(pendingRequest) });
		const data = await load(loadEvent('?code=WDJB-MJHT', fetch));
		expect(data).toMatchObject({ view: 'forbidden', request: null });
		expect(fetch.mock.calls.some(([u]) => String(u).includes('/auth/device'))).toBe(false);
	});

	it('reports an outage as one', async () => {
		const fetch = engine(['admin'], { '/api/admin/auth/device/WDJB-MJHT': () => json({ error: 'Could not read the sign-in.' }, 503) });
		const data = await load(loadEvent('?code=WDJB-MJHT', fetch));
		expect(data).toMatchObject({ view: 'error' });
	});

	it('reads a rate refusal as busy, not as an outage', async () => {
		const fetch = engine(['admin'], { '/api/admin/auth/device/WDJB-MJHT': () => json({ error: 'rate limit exceeded' }, 429) });
		const data = await load(loadEvent('?code=WDJB-MJHT', fetch));
		expect(data).toMatchObject({ view: 'busy' });
	});

	it('reads a 402 as a refusal with its own sentence, not as an outage', async () => {
		const fetch = engine(['admin'], {
			'/api/admin/auth/device/WDJB-MJHT': () => json({ error: 'not licensed', code: 'feature_not_licensed', feature: 'device-login' }, 402),
		});
		const data = await load(loadEvent('?code=WDJB-MJHT', fetch));
		expect(data).toMatchObject({ view: 'refused' });
		expect((data as { refusal: string }).refusal).not.toBe('');
	});
});

function actionEvent(code: string, fetch: ReturnType<typeof engine>, extra: Record<string, string> = { step: 'password', password: 'correct-horse' }) {
	const form = new FormData();
	form.set('code', code);
	for (const [k, v] of Object.entries(extra)) form.set(k, v);
	return {
		request: { formData: () => Promise.resolve(form) },
		cookies: signedIn(),
		fetch,
		url: new URL('http://admin.test/admin/device'),
	} as never;
}

describe('admin/device actions', () => {
	it('approves with the session and its CSRF token', async () => {
		const fetch = engine(['admin'], { '/api/admin/auth/device/WDJB-MJHT/approve': () => json({ status: 'approved' }) });
		const result = await actions.approve(actionEvent('wdjb-mjht', fetch));
		expect(result).toEqual({ outcome: 'approved' });
		const call = fetch.mock.calls.find(([u]) => String(u).endsWith('/approve'));
		expect(call).toBeDefined();
		const headers = new Headers(call?.[1]?.headers);
		expect(headers.get('Authorization')).toBe('Bearer session-token');
		expect(headers.get('X-CSRF-Token')).toBe('csrf-token');
		expect(call?.[1]?.method).toBe('POST');
		expect(JSON.parse(String(call?.[1]?.body))).toEqual({ password: 'correct-horse' });
	});

	it('sends the MFA code when the account has one', async () => {
		const fetch = engine(['admin'], { '/api/admin/auth/device/WDJB-MJHT/approve': () => json({ status: 'approved' }) });
		await actions.approve(actionEvent('WDJB-MJHT', fetch, { step: 'mfa_code', mfa_code: ' 123456 ' }));
		const call = fetch.mock.calls.find(([u]) => String(u).endsWith('/approve'));
		expect(JSON.parse(String(call?.[1]?.body))).toEqual({ mfa_code: '123456' });
	});

	it('asks for the confirmation before calling the engine', async () => {
		const fetch = engine(['admin']);
		const result = (await actions.approve(actionEvent('WDJB-MJHT', fetch, { step: 'password' }))) as { status: number; data: { stepUp: { field: string } } };
		expect(result.status).toBe(400);
		expect(result.data.stepUp.field).toBe('Enter your current password.');
		expect(fetch).not.toHaveBeenCalled();
	});

	it('keeps the request open when the password is wrong', async () => {
		const fetch = engine(['admin'], {
			'/api/admin/auth/device/WDJB-MJHT/approve': () => json({ error: 'The password is not valid.' }, 403),
		});
		const result = (await actions.approve(actionEvent('WDJB-MJHT', fetch))) as { status: number; data: Record<string, unknown> };
		expect(result.status).toBe(400);
		expect(result.data).toEqual({ stepUp: { error: '', field: 'That password is not right.', needsMfa: false } });
	});

	it('switches to the code field when the engine wants one', async () => {
		const fetch = engine(['admin'], {
			'/api/admin/auth/device/WDJB-MJHT/approve': () => json({ error: 'mfa_code is required: this account has MFA enrolled.' }, 403),
		});
		const result = (await actions.approve(actionEvent('WDJB-MJHT', fetch))) as { data: { stepUp: { needsMfa: boolean } } };
		expect(result.data.stepUp.needsMfa).toBe(true);
	});

	it('reports a confirmation it has no field for on the form', async () => {
		const message = "This account's only second factor is a passkey, which cannot confirm this change.";
		const fetch = engine(['admin'], {
			'/api/admin/auth/device/WDJB-MJHT/approve': () => json({ error: message }, 403),
		});
		const result = (await actions.approve(actionEvent('WDJB-MJHT', fetch))) as { status: number; data: Record<string, unknown> };
		expect(result.status).toBe(400);
		expect(result.data).toEqual({ stepUp: { error: message, field: '', needsMfa: false } });
	});

	it('shows the forbidden view when the engine refuses an account that lost its admin role', async () => {
		const fetch = engine(['editor'], {
			'/api/admin/auth/device/WDJB-MJHT/approve': () => json({ error: 'insufficient permissions' }, 403),
		});
		const result = (await actions.approve(actionEvent('WDJB-MJHT', fetch))) as { status: number; data: unknown };
		expect(result.status).toBe(403);
		expect(result.data).toEqual({ outcome: 'forbidden' });
	});

	it('names the approval when a refused confirmation carries no sentence', async () => {
		const fetch = engine(['admin'], {
			'/api/admin/auth/device/WDJB-MJHT/approve': () => json({ error: '' }, 403),
		});
		const result = (await actions.approve(actionEvent('WDJB-MJHT', fetch))) as { status: number; data: { stepUp: { error: string } } };
		expect(result.status).toBe(400);
		expect(result.data.stepUp.error).toBe('Could not approve this sign-in. The request is still open.');
	});

	it('reports a locked account on the form', async () => {
		const fetch = engine(['admin'], {
			'/api/admin/auth/device/WDJB-MJHT/approve': () => json({ error: 'Too many failed password attempts. Try again later.' }, 429),
		});
		const result = (await actions.approve(actionEvent('WDJB-MJHT', fetch))) as { status: number; data: { stepUp: { error: string } } };
		expect(result.status).toBe(429);
		expect(result.data.stepUp.error).toMatch(/locked/);
	});

	it('denies', async () => {
		const fetch = engine(['admin'], { '/api/admin/auth/device/WDJB-MJHT/deny': () => json({ status: 'denied' }) });
		expect(await actions.deny(actionEvent('WDJB-MJHT', fetch, {}))).toEqual({ outcome: 'denied' });
	});

	it('reports a second decision as already decided', async () => {
		const fetch = engine(['admin'], {
			'/api/admin/auth/device/WDJB-MJHT/approve': () => json({ error: 'This sign-in was already approved or denied.' }, 409),
		});
		const result = (await actions.approve(actionEvent('WDJB-MJHT', fetch))) as { status: number; data: unknown };
		expect(result.status).toBe(409);
		expect(result.data).toEqual({ outcome: 'decided' });
	});

	it('refuses a malformed code before it reaches the engine', async () => {
		const fetch = engine(['admin']);
		const result = (await actions.approve(actionEvent('nope', fetch))) as { status: number; data: unknown };
		expect(result.status).toBe(404);
		expect(result.data).toEqual({ outcome: 'unknown' });
		expect(fetch).not.toHaveBeenCalled();
	});
});
