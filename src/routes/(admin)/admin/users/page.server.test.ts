import { describe, it, expect, vi } from 'vitest';
import type { Cookies } from '@sveltejs/kit';

// Mock requireRole so the action tests don't ask the engine for the session.
// The session client stays real and runs over the event's own fetch, which the
// tests stub, so every call carries the headers it would send.
vi.mock('$lib/server/authz', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/authz')>()),
	requireRole: vi.fn(
		async () => ({ id: 'u1', email: 'admin@test.invalid', roles: ['super_admin'] }) as never
	),
}));

import { ApiError } from '@lyeve-labs/client';
import { load, actions } from './+page.server';
import { requireRole } from '$lib/server/authz';

// helpers

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' },
	});
}

interface CookieStore {
	[key: string]: string;
}

function mockCookies(initial: CookieStore = {}): Cookies {
	const store = { ...initial };
	return {
		get: vi.fn((name: string) => store[name] ?? undefined),
		set: vi.fn((name: string, value: string, _opts?: object) => {
			store[name] = value;
		}),
		delete: vi.fn((name: string, _opts?: object) => {
			delete store[name];
		}),
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
		}
	);
}

function mockEvent(overrides: Record<string, unknown> = {}) {
	return {
		getClientAddress: () => '127.0.0.1',
		...overrides,
	};
}

function form(data: Record<string, string>): FormData {
	const fd = new FormData();
	fd.set('confirmed', 'yes');
	for (const [k, v] of Object.entries(data)) fd.set(k, v);
	return fd;
}

// load

function accounts(count: number, from = 0) {
	return Array.from({ length: count }, (_, i) => ({
		id: `u${from + i}`,
		email: `user${from + i}@b.co`,
		roles: ['editor'],
	}));
}

/** A load event whose fetch answers with `rows` and records the URL asked for. */
function loadEvent(rows: unknown[], search = '') {
	const seen: string[] = [];
	const fetch = vi.fn(async (url: string, _init: RequestInit) => {
		seen.push(String(url));
		return json(rows);
	}) as unknown as typeof globalThis.fetch;

	return {
		seen,
		event: {
			fetch,
			cookies: mockCookies({ '__Host-sys_session': 'tok' }),
			url: new URL(`http://localhost/admin/users${search}`),
			parent: async () => ({ user: { roles: ['super_admin'] } }),
		} as never,
	};
}

/**
 * The load's declared return includes void, because the 403 path returns
 * through error(). Every case here is a success path, so the result is narrowed
 * once rather than at each assertion.
 */
type Loaded = Exclude<Awaited<ReturnType<typeof load>>, void>;
const run = async (event: never): Promise<Loaded> => (await load(event)) as Loaded;

describe('the accounts list', () => {
	it('lists the accounts for a super admin', async () => {
		const { event } = loadEvent([{ id: 'u1', email: 'a@b.co' }]);

		const result = await run(event);

		expect(result).toEqual({
			users: { ok: true, value: [{ id: 'u1', email: 'a@b.co' }] },
			limit: 25,
			offset: 0,
			hasMore: false,
			tenants: { ok: true, value: [] },
		});
	});

	// The endpoint clamps at its own default and sends no row count, so a page
	// that asks for nothing shows the default page and reads as the whole list.
	it('asks for one row past the page so a next page can be offered', async () => {
		const { event, seen } = loadEvent(accounts(26));

		const result = await run(event);

		expect(seen[0]).toContain('limit=26');
		expect(seen[0]).toContain('offset=0');
		expect(result.hasMore).toBe(true);
		expect(result.users).toEqual({ ok: true, value: expect.any(Array) });
		expect(result.users.ok && result.users.value).toHaveLength(25);
	});

	it('reports no next page when the probe row does not come back', async () => {
		const { event } = loadEvent(accounts(25));

		const result = await run(event);

		expect(result.hasMore).toBe(false);
		expect(result.users).toEqual({ ok: true, value: expect.any(Array) });
		expect(result.users.ok && result.users.value).toHaveLength(25);
	});

	it('carries the requested offset and page size through to the engine', async () => {
		const { event, seen } = loadEvent(accounts(10, 50), '?limit=10&offset=50');

		const result = await run(event);

		expect(seen[0]).toContain('limit=11');
		expect(seen[0]).toContain('offset=50');
		expect(result.limit).toBe(10);
		expect(result.offset).toBe(50);
	});

	// The engine clamps a page at 200 rows, so a page of 200 would have its
	// probe row clamped away and the last page would always look like the last.
	it('keeps the page one row under the engine ceiling', async () => {
		const { event, seen } = loadEvent(accounts(200), '?limit=500');

		const result = await run(event);

		expect(result.limit).toBe(199);
		expect(seen[0]).toContain('limit=200');
	});

	// The pager numbers pages, so an offset between two boundaries snaps down
	// to the page that holds it rather than drawing rows the pager misnames.
	it('snaps an offset between two page boundaries to its page', async () => {
		const { event, seen } = loadEvent(accounts(10, 50), '?limit=10&offset=55');
		const result = (await load(event)) as { offset: number };
		expect(result.offset).toBe(50);
		expect(seen[0]).toContain('offset=50');
	});

	it('refuses a negative offset rather than passing it on', async () => {
		const { event, seen } = loadEvent(accounts(5), '?offset=-40');

		const result = await run(event);

		expect(result.offset).toBe(0);
		expect(seen[0]).toContain('offset=0');
	});

	it('reports an unreachable engine rather than an empty list', async () => {
		const fetch = vi.fn(async () => {
			throw new TypeError('fetch failed');
		}) as unknown as typeof globalThis.fetch;

		const result = await run({
			fetch,
			cookies: mockCookies({ '__Host-sys_session': 'tok' }),
			url: new URL('http://localhost/admin/users'),
			parent: async () => ({ user: { roles: ['super_admin'] } }),
		} as never);

		expect(result.users).toEqual({ ok: false, gate: { state: 'unavailable' } });
		expect(result.hasMore).toBe(false);
	});

	it('keeps a refused read apart from an empty one', async () => {
		const { event } = loadEvent([]);
		const failing = {
			...(event as Record<string, unknown>),
			fetch: vi.fn(async () => json({ error: 'boom' }, 500)) as unknown as typeof globalThis.fetch,
		};

		const result = await run(failing as never);

		expect(result.users.ok).toBe(false);
	});

	it('sends a page past the end back to the first page', async () => {
		const { event } = loadEvent([], '?offset=50&limit=25');

		const out = await catchRedirect(() => load(event));

		expect(out.status).toBe(307);
		expect(out.location).toBe('/admin/users?offset=0&limit=25');
	});

	it('throws 403 when user lacks super_admin role', async () => {
		const fetch = vi.fn() as unknown as typeof globalThis.fetch;
		const cookies = mockCookies({ '__Host-sys_session': 'tok' });

		await expect(
			load({
				fetch,
				cookies,
				url: new URL('http://localhost/admin/users'),
				parent: async () => ({ user: { roles: ['editor'] } }),
			} as never)
		).rejects.toThrow();
	});
});

// actions.create

describe('creating an account', () => {
	it('asks for the email on its field before calling the engine', async () => {
		const fetch = vi.fn() as never;
		const cookies = mockCookies({ '__Host-sys_session': 'tok' });

		const result = await actions.create(mockEvent({
			request: { formData: () => Promise.resolve(form({ password: 'password12345' })) } as never,
			fetch,
			cookies,
		}) as never);

		// The banner names no field, because the field messages are what say which
		// control was rejected and the two would otherwise say it twice.
		expect(result).toEqual({
			status: 400,
			data: {
				action: 'create',
				error: 'Check the highlighted fields.',
				fields: { email: 'Enter an email address.' },
			},
		});
	});

	it('asks for the password on its field before calling the engine', async () => {
		const fetch = vi.fn() as never;
		const cookies = mockCookies({ '__Host-sys_session': 'tok' });

		const result = await actions.create(mockEvent({
			request: { formData: () => Promise.resolve(form({ email: 'a@b.co' })) } as never,
			fetch,
			cookies,
		}) as never);

		expect(result).toEqual({
			status: 400,
			data: {
				action: 'create',
				error: 'Check the highlighted fields.',
				fields: { password: 'Enter a password.' },
			},
		});
	});

	// The engine's minimum is a setting an install may lower, so a short
	// password goes to the engine, which judges it and names its own rule.
	it('leaves the shortest password to the engine', async () => {
		const fetch = vi.fn(async (_url: string, _init: RequestInit) => json({ id: 'u1' })) as unknown as typeof globalThis.fetch;
		const cookies = mockCookies({ '__Host-sys_session': 'tok' });

		const result = await actions.create(mockEvent({
			request: { formData: () => Promise.resolve(form({ email: 'a@b.co', password: 'short' })) } as never,
			fetch,
			cookies,
		}) as never);

		expect(result).toEqual({ ok: true });
		expect(fetch).toHaveBeenCalled();
	});

	// The engine's hasher fails a password over 72 bytes with a 500 that names
	// no rule, so both forms refuse one on the field before sending it.
	it('refuses a new account password over 72 bytes before sending it', async () => {
		const fetch = vi.fn() as unknown as typeof globalThis.fetch;
		const long = 'é'.repeat(37);
		const result = (await actions.create(mockEvent({
			request: { formData: () => Promise.resolve(form({ email: 'a@b.co', password: long })) } as never,
			fetch,
			cookies: mockCookies({ '__Host-sys_session': 'tok' }),
		}) as never)) as { status: number; data: { fields: { password: string } } };
		expect(result.status).toBe(400);
		expect(result.data.fields.password).toMatch(/at most 72 bytes/);
		expect(fetch).not.toHaveBeenCalled();
	});

	// The engine's policy can be stricter than the length checked here. Its
	// 422 names the rule, and that sentence belongs on the password control.
	it('puts the engine password refusal on the password field', async () => {
		const fetch = vi.fn(async () =>
			json({ error: 'password must contain a digit', code: 'password_policy' }, 422)
		) as unknown as typeof globalThis.fetch;

		const result = await actions.create(mockEvent({
			request: { formData: () => Promise.resolve(form({ email: 'a@b.co', password: 'longenoughpassword' })) } as never,
			fetch,
			cookies: mockCookies({ '__Host-sys_session': 'tok' }),
		}) as never);

		expect(result).toEqual({
			status: 422,
			data: {
				action: 'create',
				error: 'Check the highlighted field.',
				fields: { password: 'password must contain a digit' },
			},
		});
	});

	// The engine makes an account sent no role an editor, so the action names
	// the reading role instead.
	it('creates a viewer when the roles field is missing', async () => {
		const fetch = vi.fn(async (_url: string, _init: RequestInit) =>
			json({ id: 'u1' })
		) as unknown as typeof globalThis.fetch;
		const cookies = mockCookies({ '__Host-sys_session': 'tok' });

		const result = await actions.create(mockEvent({
			request: { formData: () => Promise.resolve(form({ email: 'a@b.co', password: 'password12345' })) } as never,
			fetch,
			cookies,
		}) as never);

		expect(result).toEqual({ ok: true });
		const body = JSON.parse(String((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1]?.body));
		expect(body.roles).toEqual(['viewer']);
	});

	it('succeeds on a valid create with roles', async () => {
		const fetch = vi.fn(async (_url: string, _init: RequestInit) =>
			json({ id: 'u1' })
		) as unknown as typeof globalThis.fetch;
		const cookies = mockCookies({ '__Host-sys_session': 'tok' });

		const result = await actions.create(mockEvent({
			request: {
				formData: () => Promise.resolve(form({ email: 'a@b.co', password: 'password12345', roles: 'admin,editor' })),
			} as never,
			fetch,
			cookies,
		}) as never);

		expect(result).toEqual({ ok: true });
	});
});

// actions.setPassword

/*
 * A super admin sets a password here. The engine judges the policy and ends
 * every session the account held. The action's job is to carry the refusal
 * to the control and nothing else.
 */
describe('setting an account password', () => {
	function submit(fetch: unknown, data: Record<string, string>) {
		return actions.setPassword(mockEvent({
			request: { formData: () => Promise.resolve(form(data)) } as never,
			fetch,
			cookies: mockCookies({ '__Host-sys_session': 'tok' }),
		}) as never);
	}

	it('refuses a password over 72 bytes on its field before sending it', async () => {
		const fetch = vi.fn();
		const result = (await submit(fetch, { id: 'u1', new_password: 'é'.repeat(37) })) as {
			status: number;
			data: { fields: { new_password: string } };
		};
		expect(result.status).toBe(400);
		expect(result.data.fields.new_password).toMatch(/at most 72 bytes/);
		expect(fetch).not.toHaveBeenCalled();
	});

	it('puts the password to the account and answers ok', async () => {
		const fetch = vi.fn(async (_url: string, _init: RequestInit) =>
			json({ id: 'u1', email: 'a@b.co', roles: ['editor'] })
		) as unknown as typeof globalThis.fetch;

		const result = await submit(fetch, { id: 'u1', new_password: 'correct horse battery', remove_passkeys: 'on' });

		expect(result).toEqual({ ok: true, passkeysRemoved: 0 });
		const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
		expect(url).toBe('/api/admin/users/u1/password');
		expect(init.method).toBe('PUT');
		expect(JSON.parse(String(init.body))).toEqual({ password: 'correct horse battery', remove_passkeys: true });
	});

	it('keeps the passkeys when the box is cleared, and answers how many a removal took', async () => {
		const keep = vi.fn(async () => json({ id: 'u1', passkeys_removed: 0 })) as unknown as typeof globalThis.fetch;
		await submit(keep, { id: 'u1', new_password: 'correct horse battery' });
		const [, init] = (keep as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
		expect(JSON.parse(String(init.body)).remove_passkeys).toBe(false);

		const remove = vi.fn(async () => json({ id: 'u1', passkeys_removed: 3 })) as unknown as typeof globalThis.fetch;
		expect(await submit(remove, { id: 'u1', new_password: 'correct horse battery', remove_passkeys: 'on' })).toEqual({
			ok: true,
			passkeysRemoved: 3,
		});
	});

	// The client above answers with the body whatever the status, so a refusal
	// is thrown the way the real client throws it: as the error the engine
	// wrote, with its status.
	function refusing(status: number, message: string, code: string): typeof globalThis.fetch {
		return vi.fn(async () => {
			throw new ApiError(status, message, { error: message, code });
		}) as unknown as typeof globalThis.fetch;
	}

	// The policy's refusal names the rule, and that sentence is what the
	// operator needs beside the control they are about to retype into.
	it('puts the engine refusal on the password control', async () => {
		const fetch = refusing(422, 'password must be at least 12 characters', 'http_422');

		const result = await submit(fetch, { id: 'u1', new_password: 'short' });

		expect(result).toEqual({
			status: 422,
			data: {
				action: 'setPassword',
				error: 'Check the highlighted field.',
				fields: { new_password: 'password must be at least 12 characters' },
			},
		});
	});

	it('relays an unknown account as the banner, not as a field message', async () => {
		const fetch = refusing(404, 'user not found', 'not_found');

		const result = await submit(fetch, { id: 'nope', new_password: 'correct horse battery' });

		expect(result).toEqual({ status: 400, data: { action: 'setPassword', error: 'user not found' } });
	});

	it('refuses an empty password before asking the engine', async () => {
		const fetch = vi.fn() as unknown as typeof globalThis.fetch;

		const result = await submit(fetch, { id: 'u1' });

		expect(result).toEqual({
			status: 400,
			data: { action: 'setPassword', error: 'Check the highlighted field.', fields: { new_password: 'Enter a password.' } },
		});
		expect(fetch).not.toHaveBeenCalled();
	});

	// The page is served to super admins only, and the action holds the
	// same line on its own: a crafted POST from any other role reaches no
	// engine route.
	it('refuses a caller without super_admin before any request is made', async () => {
		const fetch = vi.fn() as unknown as typeof globalThis.fetch;
		vi.mocked(requireRole).mockRejectedValueOnce(
			Object.assign(new Error('Requires one of roles: super_admin'), { status: 403 })
		);

		await expect(submit(fetch, { id: 'u1', new_password: 'correct horse battery' })).rejects.toMatchObject({
			status: 403,
		});
		expect(fetch).not.toHaveBeenCalled();
	});
});

describe('the admin seat ceiling', () => {
	const seatsFull = (): typeof globalThis.fetch =>
		vi.fn(async () => {
			throw new ApiError(402, 'cap_exceeded', {
				error: 'cap_exceeded',
				cap: 'admin.seats',
				limit: 7,
				current: 7,
				upgrade_url: 'https://shop.example.com/pricing?utm_campaign=admin.seats',
			});
		}) as unknown as typeof globalThis.fetch;

	// The numbers and the link are the refusal's, so the page holds no ceiling
	// and no address of its own.
	const expected =
		"Every admin seat is taken. You're using 7 of 7, the most this engine allows. A license that allows more lifts the limit. Removing the admin role from an account also frees a seat. Editors and viewers take no seat.";
	const refused = { kind: 'cap', cap: 'admin.seats', limit: 7, current: 7, upgradeUrl: 'https://shop.example.com/pricing?utm_campaign=admin.seats' };

	it('says the seats are full when creating an admin is refused', async () => {
		const result = await actions.create(mockEvent({
			request: { formData: () => Promise.resolve(form({ email: 'a@b.co', password: 'password12345', roles: 'admin' })) } as never,
			fetch: seatsFull(),
			cookies: mockCookies({ '__Host-sys_session': 'tok' }),
		}) as never);

		expect(result).toEqual({ status: 402, data: { action: 'create', error: expected, refused } });
	});

	it('says the seats are full when a promotion is refused', async () => {
		const result = await actions.updateRoles(mockEvent({
			request: { formData: () => Promise.resolve(form({ id: 'u1', roles: 'admin' })) } as never,
			fetch: seatsFull(),
			cookies: mockCookies({ '__Host-sys_session': 'tok' }),
		}) as never);

		expect(result).toEqual({ status: 402, data: { action: 'updateRoles', error: expected, refused } });
	});

	it('leaves a refusal at another cap to the usual message', async () => {
		const result = (await actions.create(mockEvent({
			request: { formData: () => Promise.resolve(form({ email: 'a@b.co', password: 'password12345', roles: 'admin' })) } as never,
			fetch: vi.fn(async () => {
				throw new ApiError(402, 'cap_exceeded', { error: 'cap_exceeded', cap: 'example.items', limit: 4, current: 4 });
			}) as unknown as typeof globalThis.fetch,
			cookies: mockCookies({ '__Host-sys_session': 'tok' }),
		}) as never)) as { status: number; data: { error: string } };

		expect(result.status).toBe(402);
		expect(result.data.error).not.toContain('admin seat');
	});

	it('relays any other refusal', async () => {
		const result = await actions.updateRoles(mockEvent({
			request: { formData: () => Promise.resolve(form({ id: 'u1', roles: 'admin' })) } as never,
			fetch: vi.fn(async () => {
				throw new ApiError(404, 'user not found', { error: 'user not found', code: 'not_found' });
			}) as unknown as typeof globalThis.fetch,
			cookies: mockCookies({ '__Host-sys_session': 'tok' }),
		}) as never);

		expect(result).toEqual({ status: 400, data: { action: 'updateRoles', error: 'user not found' } });
	});
});

// An account belongs to one tenant. With several, the form names it and the
// engine is asked in that tenant.
describe('the tenant a new account belongs to', () => {
	it('offers the tenants the multitenant plugin lists, leaving out archived ones', async () => {
		const fetch = vi.fn(async (url: string) =>
			String(url).startsWith('/api/admin/tenants')
				? json({ data: [
						{ slug: 'acme', name: 'Acme', archived: false },
						{ slug: 'old', name: 'Old', archived: true },
					], total_count: 2 })
				: json([]),
		) as unknown as typeof globalThis.fetch;
		const out = (await load({
			fetch,
			cookies: mockCookies({ '__Host-sys_session': 'tok' }),
			url: new URL('http://localhost/admin/users'),
			parent: async () => ({ user: { roles: ['super_admin'] }, plugins: { state: 'named', running: ['multitenant'], withheld: [] } }),
		} as never)) as Loaded;
		expect(out.tenants).toEqual({ ok: true, value: [{ slug: 'acme', name: 'Acme' }] });
	});

	it('asks for no tenants on an engine without the multitenant plugin', async () => {
		const seen: string[] = [];
		const fetch = vi.fn(async (url: string) => {
			seen.push(String(url));
			return json([]);
		}) as unknown as typeof globalThis.fetch;
		const out = (await load({
			fetch,
			cookies: mockCookies({ '__Host-sys_session': 'tok' }),
			url: new URL('http://localhost/admin/users'),
			parent: async () => ({ user: { roles: ['super_admin'] }, plugins: { state: 'named', running: [], withheld: [] } }),
		} as never)) as Loaded;
		expect(out.tenants).toEqual({ ok: true, value: [] });
		expect(seen.some((u) => u.startsWith('/api/admin/tenants'))).toBe(false);
	});

	it('says the tenants could not be read rather than offering no choice', async () => {
		const fetch = vi.fn(async (url: string) =>
			String(url).startsWith('/api/admin/tenants') ? json({ error: 'down' }, 503) : json([]),
		) as unknown as typeof globalThis.fetch;
		const out = (await load({
			fetch,
			cookies: mockCookies({ '__Host-sys_session': 'tok' }),
			url: new URL('http://localhost/admin/users'),
			parent: async () => ({ user: { roles: ['super_admin'] }, plugins: { state: 'named', running: ['multitenant'], withheld: [] } }),
		} as never)) as Loaded;
		expect(out.tenants).toEqual({ ok: false, gate: { state: 'unavailable' } });
		expect(out.users.ok).toBe(true);
	});

	it('creates the account in the tenant the form names', async () => {
		const calls: { url: string; headers: Record<string, string> }[] = [];
		const fetch = vi.fn(async (url: string, init?: RequestInit) => {
			calls.push({ url: String(url), headers: Object.fromEntries(new Headers(init?.headers).entries()) });
			return json({ id: 'n1', email: 'new@b.co', roles: ['editor'] }, 201);
		});
		const result = await actions.create(mockEvent({
			request: { formData: () => Promise.resolve(form({ email: 'new@b.co', password: 'password12345', tenant_id: 'acme', tenant_required: '1' })) } as never,
			fetch,
			cookies: mockCookies({ '__Host-sys_session': 'tok' }),
		}) as never);
		expect(result).toEqual({ ok: true });
		const post = calls.find((c) => c.url.endsWith('/api/admin/users'));
		expect(post?.headers['x-tenant-id']).toBe('acme');
		expect(post?.headers.authorization).toBe('Bearer tok');
	});

	it('asks for a tenant when the form offered a choice and none was made', async () => {
		const fetch = vi.fn();
		const result = await actions.create(mockEvent({
			request: { formData: () => Promise.resolve(form({ email: 'new@b.co', password: 'password12345', tenant_required: '1' })) } as never,
			fetch,
			cookies: mockCookies({ '__Host-sys_session': 'tok' }),
		}) as never);
		expect(result).toEqual({
			status: 400,
			data: { action: 'create', error: 'Check the highlighted fields.', fields: { tenant_id: 'Choose the tenant this account belongs to' } },
		});
		expect(fetch).not.toHaveBeenCalled();
	});
});


describe('deleting an account', () => {
	function remove(reply: () => Response | Promise<Response>) {
		const calls: { method: string; url: string }[] = [];
		const fetch = vi.fn(async (url: string, init?: RequestInit) => {
			calls.push({ method: init?.method ?? 'GET', url: String(url) });
			return reply();
		}) as unknown as typeof globalThis.fetch;
		const posted = form({ id: 'u1' });
		const event = mockEvent({
			request: { formData: async () => posted, clone: () => ({ formData: async () => posted }) } as never,
			fetch,
			cookies: mockCookies({ '__Host-sys_session': 'tok' }),
		});
		return { calls, run: () => actions.delete(event as never) };
	}

	it('deletes the named account', async () => {
		const { calls, run } = remove(() => new Response(null, { status: 204 }));
		expect(await run()).toEqual({ ok: true });
		expect(calls).toEqual([{ method: 'DELETE', url: '/api/admin/users/u1' }]);
	});

	it('relays the engine refusal on the page', async () => {
		const { run } = remove(() => json({ error: 'cannot delete the last super admin', code: 'conflict' }, 409));
		expect(await run()).toEqual({ status: 400, data: { action: 'delete', error: 'cannot delete the last super admin' } });
	});

	it('keeps outage detail off the page', async () => {
		const { run } = remove(() => Promise.reject(new TypeError('fetch failed')));
		expect(await run()).toEqual({ status: 400, data: { action: 'delete', error: 'Could not delete the user. Try again.' } });
	});

	it('holds the delete to a super admin', async () => {
		vi.mocked(requireRole).mockRejectedValueOnce(Object.assign(new Error('Requires one of roles: super_admin'), { status: 403 }));
		const { calls, run } = remove(() => new Response(null, { status: 204 }));
		await expect(run()).rejects.toMatchObject({ status: 403 });
		expect(calls).toEqual([]);
	});
});
