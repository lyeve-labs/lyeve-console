import { describe, it, expect, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import type { SchemaField } from '@lyeve-labs/client';
import {
	assertRole,
	authedClient,
	authedHeaders,
	exactParse,
	loadUser,
	requireUser,
	requireRole,
	stripProtectedFields,
	withExactIntegers,
} from './authz';
import { BUSY, OUTAGE } from '$lib/outage';

// event stub

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' },
	});
}

function stubEvent(opts: { token?: string | null; fetchImpl?: typeof fetch } = {}): RequestEvent {
	const token = 'token' in opts ? opts.token : 'sess-tok';
	return {
		cookies: { get: vi.fn().mockReturnValue(token) },
		fetch: opts.fetchImpl ?? vi.fn(),
	} as unknown as RequestEvent;
}

/**
 * An event whose cookie jar answers per name, so a test can hold a session
 * without a CSRF cookie. The single-value stub above cannot express that, and
 * the absent-cookie case is the one that matters: an empty header fails the
 * check it exists to pass.
 */
function stubEventWithCookies(jar: Record<string, string | undefined>): RequestEvent {
	return {
		cookies: { get: vi.fn((name: string) => jar[name]) },
		fetch: vi.fn(),
	} as unknown as RequestEvent;
}

describe('authedHeaders', () => {
	it('echoes the double-submit CSRF token from the secure cookie', () => {
		const headers = authedHeaders(
			stubEventWithCookies({ '__Host-sys_session': 'sess-tok', '__Host-csrf': 'csrf-tok' })
		);
		expect(headers.Authorization).toBe('Bearer sess-tok');
		expect(headers['X-CSRF-Token']).toBe('csrf-tok');
	});

	it('falls back to the insecure cookie name, which is how local runs present it', () => {
		const headers = authedHeaders(
			stubEventWithCookies({ '__Host-sys_session': 'sess-tok', csrf: 'plain-tok' })
		);
		expect(headers['X-CSRF-Token']).toBe('plain-tok');
	});

	it('prefers the secure name when both are present', () => {
		const headers = authedHeaders(
			stubEventWithCookies({
				'__Host-sys_session': 'sess-tok',
				'__Host-csrf': 'secure-tok',
				csrf: 'plain-tok',
			})
		);
		expect(headers['X-CSRF-Token']).toBe('secure-tok');
	});

	it('omits the header entirely when no CSRF cookie was sent', () => {
		const headers = authedHeaders(stubEventWithCookies({ '__Host-sys_session': 'sess-tok' }));
		expect(headers.Authorization).toBe('Bearer sess-tok');
		expect('X-CSRF-Token' in headers).toBe(false);
	});

	it('throws 401 without a session cookie', () => {
		const err = (() => {
			try {
				authedHeaders(stubEventWithCookies({}));
			} catch (e) {
				return e as { status?: number };
			}
		})();
		expect(err?.status).toBe(401);
	});
});

describe('authedClient CSRF', () => {
	it('sends the CSRF token on a write, which the engine refuses without', async () => {
		const fetchImpl = vi.fn(
			async (_url: string, _init: RequestInit): Promise<Response> => jsonResponse({ ok: true })
		) as unknown as typeof fetch;
		const event = {
			cookies: {
				get: vi.fn((name: string) =>
					({ '__Host-sys_session': 'sess-tok', '__Host-csrf': 'csrf-tok' })[name]
				),
			},
			fetch: fetchImpl,
		} as unknown as RequestEvent;

		await authedClient(event).put('/api/admin/config', { values: {} });

		const mock = fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } };
		const headers = mock.mock.calls[0][1].headers as Record<string, string>;
		expect(headers['X-CSRF-Token']).toBe('csrf-tok');
	});
});

// authedClient

describe('authedClient', () => {
	it('throws 401 when there is no session cookie', async () => {
		const event = stubEvent({ token: null });
		const err = (await Promise.resolve()
			.then(() => authedClient(event))
			.catch((e: unknown) => e)) as { status?: number };
		expect(err.status).toBe(401);
	});

	it('forwards the session token as a Bearer Authorization header', async () => {
		const fetchImpl = vi.fn(
			async (_url: string, _init: RequestInit): Promise<Response> => jsonResponse({ ok: true })
		) as unknown as typeof fetch;
		const event = stubEvent({ token: 'sess-tok', fetchImpl });

		const client = authedClient(event);
		await client.get('/api/admin/thing');

		const mock = fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } };
		const [url, init] = mock.mock.calls[0];
		expect(url).toBe('/api/admin/thing');
		expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sess-tok');
	});

	it('adds extra headers and never lets one replace the session', async () => {
		const fetchImpl = vi.fn(
			async (_url: string, _init: RequestInit): Promise<Response> => jsonResponse({ ok: true })
		) as unknown as typeof fetch;
		const event = stubEvent({ token: 'sess-tok', fetchImpl });

		await authedClient(event, { 'X-Tenant-ID': 'acme', Authorization: 'Bearer other' }).get('/api/admin/thing');

		const mock = fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } };
		const headers = mock.mock.calls[0][1].headers as Record<string, string>;
		expect(headers['X-Tenant-ID']).toBe('acme');
		expect(headers.Authorization).toBe('Bearer sess-tok');
	});
});

describe('authedClient extra headers', () => {
	function capture(cookies: Record<string, string>) {
		const fetchImpl = vi.fn(
			async (_url: string, _init: RequestInit): Promise<Response> => jsonResponse({ ok: true })
		) as unknown as typeof fetch;
		const event = { cookies: { get: vi.fn((name: string) => cookies[name]) }, fetch: fetchImpl } as unknown as RequestEvent;
		const sent = () => {
			const mock = fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } };
			return new Headers(mock.mock.calls[0][1].headers as Record<string, string>);
		};
		return { event, sent };
	}

	it('never sends a second bearer, whatever the spelling', async () => {
		const { event, sent } = capture({ '__Host-sys_session': 'sess-tok', '__Host-csrf': 'csrf-tok' });
		await authedClient(event, { authorization: 'Bearer other', AUTHORIZATION: 'Bearer third' }).get('/api/admin/thing');
		expect(sent().get('authorization')).toBe('Bearer sess-tok');
	});

	it('never supplies a CSRF token the session has no cookie for', async () => {
		const { event, sent } = capture({ '__Host-sys_session': 'sess-tok' });
		await authedClient(event, { 'x-csrf-token': 'forged', 'X-Csrf-Token': 'forged' }).get('/api/admin/thing');
		expect(sent().has('x-csrf-token')).toBe(false);
	});
});

describe('assertRole', () => {
	const user = { id: 'u1', email: 'a@b.co', roles: ['admin'], tenant_id: 't', disabled: false, created_at: '' };

	it('returns a user who holds one of the roles', () => {
		expect(assertRole(user as never, ['admin', 'super_admin'])).toBe(user);
	});

	it('throws 403 for a user who holds none of them', () => {
		const err = (() => {
			try {
				assertRole(user as never, ['super_admin']);
			} catch (e) {
				return e as { status?: number };
			}
		})();
		expect(err?.status).toBe(403);
	});
});

// one session read per request

describe('the session read', () => {
	const user = { id: 'u1', email: 'a@b.co', roles: ['admin'], tenant_id: 't', disabled: false, created_at: '' };

	/** Events for one request, as SvelteKit hands one to an action and one to each load. */
	function eventsOf(request: Request, fetchImpl: typeof fetch, cookie = () => 'sess-tok'): RequestEvent[] {
		const event = () =>
			({
				request,
				url: new URL(request.url),
				cookies: { get: vi.fn(cookie), delete: vi.fn() },
				fetch: fetchImpl,
			}) as unknown as RequestEvent;
		return [event(), event(), event()];
	}

	function meCalls(fetchImpl: typeof fetch): number {
		return (fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter(([url]) =>
			String(url).includes('/api/admin/auth/me')
		).length;
	}

	it('asks the engine once for all the loads of a request', async () => {
		const fetchImpl = vi.fn(async () => jsonResponse(user)) as unknown as typeof fetch;
		const [shell, page] = eventsOf(new Request('http://localhost/admin/jobs'), fetchImpl);

		await Promise.all([loadUser(shell), loadUser(page)]);

		expect(meCalls(fetchImpl)).toBe(1);
	});

	it('asks again for the loads after an action, which may have ended the session', async () => {
		let live = true;
		const fetchImpl = vi.fn(async () =>
			live ? jsonResponse(user) : jsonResponse({ error: 'unauthorized' }, 401)
		) as unknown as typeof fetch;
		const [action, shell] = eventsOf(new Request('http://localhost/admin/users?/setPassword', { method: 'POST' }), fetchImpl);

		await requireRole(action, ['admin']);
		live = false;
		const err = (await loadUser(shell).catch((e: unknown) => e)) as { status?: number; location?: string };

		expect(err.status).toBe(302);
		expect(err.location).toContain('/login?ended=1');
		expect(shell.cookies.delete).toHaveBeenCalled();
	});

	it('asks again on the next request, so a session ended in between is refused', async () => {
		let live = true;
		const fetchImpl = vi.fn(async () =>
			live ? jsonResponse(user) : jsonResponse({ error: 'unauthorized' }, 401)
		) as unknown as typeof fetch;
		const [first] = eventsOf(new Request('http://localhost/admin/jobs?/create', { method: 'POST' }), fetchImpl);
		const [second] = eventsOf(new Request('http://localhost/admin/jobs?/create', { method: 'POST' }), fetchImpl);

		await requireUser(first);
		live = false;
		const err = (await requireUser(second).catch((e: unknown) => e)) as { status?: number };

		expect(err.status).toBe(401);
		expect(meCalls(fetchImpl)).toBe(2);
	});

	it('asks again within a request once the session cookie changed', async () => {
		let token = 'old-tok';
		const fetchImpl = vi.fn(async () => jsonResponse(user)) as unknown as typeof fetch;
		const [before, after] = eventsOf(new Request('http://localhost/login'), fetchImpl, () => token);

		await loadUser(before);
		token = 'new-tok';
		await loadUser(after);

		expect(meCalls(fetchImpl)).toBe(2);
	});

	it('gives every load in the request the same refusal when the engine cannot check', async () => {
		const fetchImpl = vi.fn(async () => jsonResponse({ error: 'unavailable' }, 503)) as unknown as typeof fetch;
		const events = eventsOf(new Request('http://localhost/admin/jobs'), fetchImpl);

		const errs = (await Promise.all(events.map((e) => loadUser(e).catch((x: unknown) => x)))) as {
			status?: number;
			body?: { message?: string };
		}[];

		expect(errs.map((e) => e.status)).toEqual([503, 503, 503]);
		expect(errs[0].body?.message).toBe(OUTAGE.body);
		expect(meCalls(fetchImpl)).toBe(1);
		for (const e of events) expect(e.cookies.delete).not.toHaveBeenCalled();
	});

	it('sends a load to sign in again when the engine ended the session', async () => {
		const fetchImpl = vi.fn(async () => jsonResponse({ error: 'unauthorized' }, 401)) as unknown as typeof fetch;
		const [page] = eventsOf(new Request('http://localhost/admin/jobs'), fetchImpl);

		const err = (await loadUser(page).catch((e: unknown) => e)) as { status?: number; location?: string };

		expect(err.status).toBe(302);
		expect(err.location).toContain('/login?ended=1');
		expect(page.cookies.delete).toHaveBeenCalled();
	});

	it('sends a load without a session to sign in without asking the engine', async () => {
		const fetchImpl = vi.fn() as unknown as typeof fetch;
		const [page] = eventsOf(new Request('http://localhost/admin/jobs'), fetchImpl, () => undefined as never);

		const err = (await loadUser(page).catch((e: unknown) => e)) as { status?: number; location?: string };

		expect(err).toMatchObject({ status: 302, location: '/login' });
		expect(fetchImpl).not.toHaveBeenCalled();
	});
});

// requireUser

describe('requireUser', () => {
	it('returns the current user when /me succeeds', async () => {
		const user = { id: 'u1', email: 'a@b.co', roles: ['admin'], tenant_id: 't', disabled: false, created_at: '' };
		const fetchImpl = vi.fn(
			async (_url: string, _init: RequestInit): Promise<Response> => jsonResponse(user)
		) as unknown as typeof fetch;
		const out = await requireUser(stubEvent({ fetchImpl }));
		expect(out).toEqual(user);
	});

	it('throws 401 when /me responds unauthorized', async () => {
		const fetchImpl = vi.fn(
			async (_url: string, _init: RequestInit): Promise<Response> => jsonResponse({ error: 'nope' }, 401)
		) as unknown as typeof fetch;
		const err = (await requireUser(stubEvent({ fetchImpl })).catch((e: unknown) => e)) as {
			status?: number;
		};
		expect(err.status).toBe(401);
	});

	it('throws 401 when there is no session cookie', async () => {
		const err = (await requireUser(stubEvent({ token: null })).catch((e: unknown) => e)) as {
			status?: number;
		};
		expect(err.status).toBe(401);
	});

	/*
	 * The engine answers 503 when its database cannot check a session, so that
	 * an outage signs nobody out. Reading that as 401 would end the session the
	 * engine kept, so it surfaces as the outage it is.
	 */
	it.each([
		['the engine cannot check the session', async () => jsonResponse({ error: 'session check unavailable' }, 503)],
		['the engine fails with a status nothing here names', async () => jsonResponse({ error: 'internal error' }, 500)],
		[
			'the engine does not answer',
			async (): Promise<Response> => {
				throw new TypeError('fetch failed');
			},
		],
	])('throws 503 with the outage wording when %s', async (_case, answer) => {
		const fetchImpl = vi.fn(answer) as unknown as typeof fetch;
		const err = (await requireUser(stubEvent({ fetchImpl })).catch((e: unknown) => e)) as {
			status?: number;
			body?: { message?: string };
		};
		expect(err.status).toBe(503);
		expect(err.body?.message).toBe(OUTAGE.body);
	});

	/*
	 * Three answers are refusals, not outages. The engine answered, so the
	 * outage page would mislead, and the session is intact, so neither ends it.
	 */
	describe('a refused session check', () => {
		async function refusedWith(status: number, body: unknown) {
			const fetchImpl = vi.fn(async () => jsonResponse(body, status)) as unknown as typeof fetch;
			return (await requireUser(stubEvent({ fetchImpl })).catch((e: unknown) => e)) as {
				status?: number;
				body?: { message?: string };
			};
		}

		it('throws 402 with the seat count when no admin seat is left', async () => {
			const err = await refusedWith(402, { error: 'cap_exceeded', cap: 'admin.seats', limit: 5, current: 5, upgrade_url: '' });
			expect(err.status).toBe(402);
			expect(err.body?.message).toContain('Every admin seat is taken.');
			expect(err.body?.message).toContain("You're using 5 of 5");
		});

		it('throws 402 with the seat sentence when the body names nothing', async () => {
			const err = await refusedWith(402, {});
			expect(err.status).toBe(402);
			expect(err.body?.message).toBe('This engine has no admin seat left for this account.');
		});

		it('throws 403 for an address rule or a firewall in front of the engine', async () => {
			const err = await refusedWith(403, { error: 'forbidden' });
			expect(err.status).toBe(403);
			expect(err.body?.message).toBe('Access to the admin is blocked for this account or network.');
		});

		it('throws 429 for the request rate, never with the outage wording', async () => {
			const err = await refusedWith(429, { error: 'rate limit exceeded' });
			expect(err.status).toBe(429);
			expect(err.body?.message).toBe(BUSY.body);
		});
	});
});

// requireRole

describe('requireRole', () => {
	function withRoles(roles: string[]): typeof fetch {
		const user = { id: 'u1', email: 'a@b.co', roles, tenant_id: 't', disabled: false, created_at: '' };
		return vi.fn(
			async (_url: string, _init: RequestInit): Promise<Response> => jsonResponse(user)
		) as unknown as typeof fetch;
	}

	it('returns the user when they hold one of the required roles', async () => {
		const out = await requireRole(stubEvent({ fetchImpl: withRoles(['editor']) }), ['admin', 'editor']);
		expect(out.roles).toContain('editor');
	});

	it('throws 403 when the user lacks every required role', async () => {
		const err = (await requireRole(stubEvent({ fetchImpl: withRoles(['reader']) }), ['admin']).catch(
			(e: unknown) => e
		)) as { status?: number };
		expect(err.status).toBe(403);
	});

	it('throws 401 (not 403) when unauthenticated', async () => {
		const err = (await requireRole(stubEvent({ token: null }), ['admin']).catch((e: unknown) => e)) as {
			status?: number;
		};
		expect(err.status).toBe(401);
	});
});

// stripProtectedFields

describe('stripProtectedFields', () => {
	it('removes the columns the engine writes itself', () => {
		const out = stripProtectedFields({
			id: 'x',
			_status: 'draft',
			created_at: 't',
			updated_at: 't',
			deleted_at: 't',
			tenant_id: 't',
			title: 'keep me',
		});
		expect(out).toEqual({ title: 'keep me' });
	});

	it('keeps user fields whose names only sound like system ones', () => {
		const data = { status: 'shipped', _id: 'y', created_by: 'u', updated_by: 'u', system: 'north', _locale: 'fr' };
		expect(stripProtectedFields(data)).toEqual(data);
	});

	it('leaves an ordinary payload untouched', () => {
		const data = { title: 'Hello', body: 'World', published: true };
		expect(stripProtectedFields(data)).toEqual(data);
	});

	it('returns an empty object when every field is protected', () => {
		expect(stripProtectedFields({ id: '1', tenant_id: 't' })).toEqual({});
	});
});

describe('authedClient exact integers', () => {
	const raw =
		'{"over":9007199254740993,"max":9223372036854775807,"min":-9223372036854775808,' +
		'"fraction":12.5,"small":42,"exponent":1e21,"huge":1e400,"json":{"big":1790000000000000000}}';
	const read = async () => {
		const fetchImpl = vi.fn(
			async (): Promise<Response> => new Response(raw, { status: 200, headers: { 'content-type': 'application/json' } })
		) as unknown as typeof fetch;
		return authedClient(stubEvent({ fetchImpl })).get<Record<string, unknown>>('/api/admin/content/e1');
	};

	it('parses a response as JSON.parse does', async () => {
		const body = await read();
		expect(body.over).toBe(9007199254740992);
		expect(body.small).toBe(42);
		expect(body.json).toEqual({ big: 1790000000000000000 });
	});

	it('parses the same response again with the digits of every integer past 2^53 kept', async () => {
		const exact = exactParse(await read()) as Record<string, unknown>;
		expect(exact.over).toBe('9007199254740993');
		expect(exact.max).toBe('9223372036854775807');
		expect(exact.min).toBe('-9223372036854775808');
		expect(exact.fraction).toBe(12.5);
		expect(exact.small).toBe(42);
		expect(exact.exponent).toBe(1e21);
		expect(exact.huge).toBe(Infinity);
		expect(exactParse({ over: 1 })).toBeUndefined();
	});

	it('takes only integer fields from the exact parse', async () => {
		const body = await read();
		const fields = [
			{ name: 'over', field_type: 'integer' },
			{ name: 'small', field_type: 'integer' },
			{ name: 'json', field_type: 'json' },
		] as SchemaField[];
		const out = withExactIntegers(fields, body, exactParse(body));
		expect(out.over).toBe('9007199254740993');
		expect(out.small).toBe(42);
		expect(out.json).toEqual({ big: 1790000000000000000 });
		expect(out.max).toBe(9223372036854775807);
	});
});
