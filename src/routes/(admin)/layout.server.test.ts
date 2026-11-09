import { describe, it, expect, vi } from 'vitest';
import type { Cookies } from '@sveltejs/kit';

// The load function under test. SvelteKit's redirect() throws a Redirect object.
// We catch it and inspect status/location.
import { load } from './+layout.server';
import { BUSY, OUTAGE } from '$lib/outage';

// helpers

/** HTTP response factory. */
function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' },
	});
}

interface CookieStore {
	[key: string]: string;
}

/** Minimal cookies mock matching the SvelteKit Cookies interface. */
function mockCookies(initial: CookieStore = {}): Cookies {
	const store = { ...initial };
	const m = {
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
	return m;
}

/** Catch a redirect thrown by SvelteKit's redirect() helper. */
function catchRedirect(fn: () => unknown): Promise<{ status: number; location: string }> {
	return Promise.resolve(fn()).then(
		() => {
			throw new Error('expected redirect but got success');
		},
		(e: unknown) => {
			const err = e as { status?: number; location?: string };
			if (err.status && err.location) return { status: err.status, location: err.location };
			throw e; // re-throw real errors
		}
	);
}

// tests

describe('the console frame', () => {
	it('redirects to /login when there is no session cookie', async () => {
		const fetch = vi.fn(async (_url: string, _init: RequestInit) =>
			json({ setup_required: false })
		) as unknown as typeof globalThis.fetch;
		const cookies = mockCookies(); // no __Host-sys_session set

		const r = await catchRedirect(() => load({ fetch, depends: vi.fn(), cookies } as never));
		expect(r.status).toBe(302);
		expect(r.location).toBe('/login');
	});

	it('deletes the session cookie and tells the sign-in page the session ended when the engine answers 401', async () => {
		const fetch = vi.fn(async (url: string, _init: RequestInit) => {
			if (String(url).includes('/api/admin/setup')) return json({ setup_required: false });
			// /me endpoint: return 401 (invalid/expired token)
			if (String(url).includes('/api/admin/auth/me')) return json({ error: 'unauthorized' }, 401);
			return json({});
		}) as unknown as typeof globalThis.fetch;
		const cookies = mockCookies({ '__Host-sys_session': 'expired-token' });
		const url = new URL('https://admin.example.com/admin/content/posts?offset=40');

		const r = await catchRedirect(() => load({ fetch, depends: vi.fn(), cookies, url, request: new Request(url) } as never));

		// The delete has to repeat the attributes the cookie was set with. A
		// __Host- cookie cleared without Secure is discarded by the browser, the
		// dead session survives, and /login bounces its holder straight back here.
		expect(cookies.delete).toHaveBeenCalledWith('__Host-sys_session', {
			path: '/',
			httpOnly: true,
			secure: true,
			sameSite: 'strict',
		});
		expect(r.status).toBe(302);
		// The reader returns to the page they were on once they sign in again.
		expect(r.location).toBe('/login?ended=1&next=%2Fadmin%2Fcontent%2Fposts%3Foffset%3D40');
	});

	// A form posted without script lands here with the action in its address.
	// Sending the reader back there would name the action, not the page.
	it('returns a reader whose form post found the session ended to the page alone', async () => {
		const fetch = vi.fn(async (url: string, _init: RequestInit) =>
			String(url).includes('/api/admin/auth/me') ? json({ error: 'unauthorized' }, 401) : json({})
		) as unknown as typeof globalThis.fetch;
		const url = new URL('https://admin.example.com/admin/users?/delete');
		const request = new Request(url, { method: 'POST' });

		const r = await catchRedirect(() =>
			load({ fetch, depends: vi.fn(), cookies: mockCookies({ '__Host-sys_session': 'expired-token' }), url, request } as never)
		);

		expect(r.location).toBe('/login?ended=1&next=%2Fadmin%2Fusers');
	});

	// SvelteKit re-runs a load that read the address on every navigation, and
	// the shell's reads would then repeat on every page. A standing session
	// must not touch it.
	it('does not read the address while the session stands', async () => {
		const user = { id: 'u1', email: 'a@b.co', roles: ['editor'], tenant_id: 't', disabled: false, created_at: '' };
		const fetch = vi.fn(async (url: string, _init: RequestInit) =>
			String(url).includes('/api/admin/auth/me') ? json(user) : json({})
		) as unknown as typeof globalThis.fetch;
		let read = false;
		const url = new URL('https://admin.example.com/admin/users');
		for (const property of ['href', 'pathname', 'search', 'searchParams']) {
			const value = url[property as keyof URL];
			Object.defineProperty(url, property, {
				get: () => {
					read = true;
					return value;
				},
			});
		}

		await load({ fetch, depends: vi.fn(), cookies: mockCookies({ '__Host-sys_session': 'valid-token' }), url } as never);

		expect(read).toBe(false);
	});

	/*
	 * The engine answers 503 when its database cannot check a session, so that
	 * an outage signs nobody out. The shell has to keep that promise: the cookie
	 * stays, and the reader sees the outage page instead of the sign-in form.
	 */
	describe('when the engine cannot check the session', () => {
		async function outage(me: () => Response | Promise<Response>) {
			const fetch = vi.fn(async (url: string, _init: RequestInit) => {
				if (String(url).includes('/api/admin/auth/me')) return me();
				return json({});
			}) as unknown as typeof globalThis.fetch;
			const cookies = mockCookies({ '__Host-sys_session': 'valid-token' });
			const thrown = (await Promise.resolve(load({ fetch, depends: vi.fn(), cookies } as never)).then(
				() => {
					throw new Error('expected the outage page');
				},
				(e: unknown) => e
			)) as { status?: number; location?: string; body?: { message?: string } };
			return { thrown, cookies };
		}

		it('keeps the cookie and shows the outage page on a 503', async () => {
			const { thrown, cookies } = await outage(() => json({ error: 'session check unavailable' }, 503));
			expect(cookies.delete).not.toHaveBeenCalled();
			expect(thrown.location).toBeUndefined();
			expect(thrown.status).toBe(503);
			expect(thrown.body?.message).toBe(OUTAGE.body);
		});

		it('keeps the cookie and shows the outage page when the engine does not answer', async () => {
			const { thrown, cookies } = await outage(() => Promise.reject(new TypeError('fetch failed')));
			expect(cookies.delete).not.toHaveBeenCalled();
			expect(thrown.location).toBeUndefined();
			expect(thrown.status).toBe(503);
		});

		// A refusal is an answer, so it gets its own page and never the outage
		// wording. The session is intact, so the cookie stays for each.
		it.each([
			[
				402,
				{ error: 'cap_exceeded', cap: 'admin.seats', limit: 3, current: 3, upgrade_url: '' },
				"Every admin seat is taken. You're using 3 of 3, the most this engine allows. A license that allows more lifts the limit. Removing the admin role from an account also frees a seat. Editors and viewers take no seat.",
			],
			[403, { error: 'forbidden' }, 'Access to the admin is blocked for this account or network.'],
			[429, { error: 'rate limit exceeded' }, BUSY.body],
		])('keeps the cookie and shows its own page for a %i', async (status, body, message) => {
			const { thrown, cookies } = await outage(() => json(body, status));
			expect(cookies.delete).not.toHaveBeenCalled();
			expect(thrown.location).toBeUndefined();
			expect(thrown.status).toBe(status);
			expect(thrown.body?.message).toBe(message);
		});
	});

	it('treats an unreadable license as granting nothing, and keeps the reader signed in', async () => {
		const user = { id: 'u1', email: 'a@b.co', roles: ['admin'], tenant_id: 't', disabled: false, created_at: '' };
		const fetch = vi.fn(async (url: string, _init: RequestInit) => {
			if (String(url).includes('/api/admin/setup')) return json({ setup_required: false });
			if (String(url).includes('/api/admin/auth/me')) return json(user);
			// entitlements endpoint: simulate a network error
			if (String(url).includes('/api/admin/entitlements'))
				return Promise.reject(new Error('connection refused'));
			return json({});
		}) as unknown as typeof globalThis.fetch;
		const cookies = mockCookies({ '__Host-sys_session': 'valid-token' });

		const result = await load({ fetch, depends: vi.fn(), cookies } as never);

		expect(result).toBeDefined();
		expect(result!.user).toEqual(user);
		expect(result!.entitlements.plan).toBe('');
		expect(result!.entitlements.state).toBe('');
		expect(result!.entitlements.features).toEqual([]);
	});

	/*
	 * The migration count is the shell's own read: it belongs to the instance
	 * rather than to any page, and this load does not re-run when the reader
	 * moves between admin screens. A fetch in the header component would read
	 * outside load and cost a round trip after hydration on every page.
	 */
	describe('migration status', () => {
		function engine(migrate: () => Response | Promise<Response>, roles = ['super_admin']) {
			const seen: string[] = [];
			const user = {
				id: 'u1',
				email: 'a@b.co',
				roles,
				tenant_id: 't',
				disabled: false,
				created_at: '',
			};
			const fetch = vi.fn(async (url: string, _init: RequestInit) => {
				seen.push(String(url));
				if (String(url).includes('/api/admin/setup')) return json({ setup_required: false });
				if (String(url).includes('/api/admin/auth/me')) return json(user);
				if (String(url).includes('/api/admin/entitlements')) return json({ plan: '', state: '', features: [], caps: {} });
				if (String(url).includes('/api/admin/plugins/running')) return json({ plugins: ['schema'], withheld: [] });
				if (String(url).includes('/api/admin/migrate')) return migrate();
				return json({});
			}) as unknown as typeof globalThis.fetch;
			return { seen, fetch, cookies: mockCookies({ '__Host-sys_session': 'valid-token' }) };
		}

		it('reads the pending count in load, so no component has to', async () => {
			const { seen, fetch, cookies } = engine(() => json({ pending: 3 }));
			const depends = vi.fn();

			const result = await load({ fetch, cookies, depends } as never);

			// A write that changes the queue reads the count again by this name.
			expect(depends).toHaveBeenCalledWith('app:migrations');

			expect(seen.some((u) => u.includes('/api/admin/migrate'))).toBe(true);
			expect(result!.migrations).toEqual({ pending: 3, items: [] });
		});

		it('leaves the count unknown when the engine does not answer', async () => {
			// Reading a failure as zero would paint the chip green and claim the
			// database is in step with schemas nobody checked.
			const { fetch, cookies } = engine(() => Promise.reject(new Error('connection refused')));

			const result = await load({ fetch, depends: vi.fn(), cookies } as never);

			expect(result!.migrations).toEqual({ pending: null, items: [] });
			expect(result!.user).toBeDefined();
		});

		it('does not ask an engine that does not run the schema plugin', async () => {
			const seen: string[] = [];
			const fetch = vi.fn(async (url: string) => {
				seen.push(String(url));
				if (String(url).includes('/api/admin/auth/me')) return json({ id: 'u1', email: 'a@b.co', roles: ['super_admin'] });
				if (String(url).includes('/api/admin/plugins/running')) return json({ plugins: [], withheld: [] });
				return json({});
			}) as unknown as typeof globalThis.fetch;

			const result = await load({ fetch, depends: vi.fn(), cookies: mockCookies({ '__Host-sys_session': 'valid-token' }) } as never);

			expect(result!.migrations).toBeNull();
			expect(seen.some((u) => u.includes('/api/admin/migrate'))).toBe(false);
		});

		it.each([['editor'], ['admin']])('does not ask on behalf of a %s, who may not read the queue', async (role) => {
			// The queue is every tenant's, so the engine holds it to super_admin
			// and an admin's request would only be refused.
			const { seen, fetch, cookies } = engine(() => json({ pending: 3 }), [role]);

			const result = await load({ fetch, depends: vi.fn(), cookies } as never);

			expect(result!.migrations).toBeNull();
			expect(seen.some((u) => u.includes('/api/admin/migrate'))).toBe(false);
		});
	});

	/*
	 * Which plugins run decides which pages exist. Every role reads the
	 * running list, an operator also reads why a plugin does not run, and an
	 * engine without the list is answered from that status report.
	 */
	describe('running plugins', () => {
		type Routes = Record<string, () => Response | Promise<Response>>;
		function engine(roles: string[], routes: Routes) {
			const seen: string[] = [];
			const fetch = vi.fn(async (url: string) => {
				seen.push(String(url));
				if (String(url).includes('/api/admin/auth/me')) return json({ id: 'u1', email: 'a@b.co', roles });
				for (const [path, answer] of Object.entries(routes)) if (String(url).includes(path)) return answer();
				return json({});
			}) as unknown as typeof globalThis.fetch;
			return { seen, run: () => load({ fetch, depends: vi.fn(), cookies: mockCookies({ '__Host-sys_session': 'valid-token' }) } as never) };
		}
		const status = {
			compiled: ['media', 'search', 'audit'],
			entitled: ['media', 'audit'],
			plugins: [
				{ name: 'media', compiled: true, entitled: true, requested: true, active: true, phase: 'running' },
				{ name: 'search', compiled: true, entitled: false, requested: true, active: false, phase: 'registered' },
				{ name: 'audit', compiled: true, entitled: true, requested: true, active: true, phase: 'running' },
			],
		};

		it('takes the running list the engine names, for an editor too', async () => {
			const { seen, run } = engine(['editor'], {
				'/api/admin/plugins/running': () => json({ plugins: ['media'], withheld: ['audit'] }),
			});
			const result = await run();
			expect(result!.plugins).toEqual({ state: 'named', running: ['media'], withheld: ['audit'] });
			expect(result!.pluginStatus).toBeNull();
			// The status report is an operator's, so an editor is never refused it.
			expect(seen.some((u) => u.includes('/api/admin/plugins/status'))).toBe(false);
		});

		it('reads the status report for an operator, so a page can say why its plugin does not run', async () => {
			const { run } = engine(['admin'], {
				'/api/admin/plugins/running': () => json({ plugins: ['media', 'audit'], withheld: [] }),
				'/api/admin/plugins/status': () => json(status),
			});
			const result = await run();
			expect(result!.pluginStatus).toEqual(status);
		});

		it('answers an engine without the list from the status report, less what is withheld', async () => {
			const { run } = engine(['super_admin'], {
				'/api/admin/plugins/running': () => json({ error: 'not found' }, 404),
				'/api/admin/plugins/status': () => json(status),
				'/api/admin/entitlements': () => json({ plan: '', state: '', features: [], withheld: ['audit'] }),
			});
			const result = await run();
			expect(result!.plugins).toEqual({ state: 'named', running: ['media'], withheld: ['audit'] });
		});

		describe('for an operator', () => {
			// Every phase a plugin can be in, and one the build left out. The
			// running list below is what the engine derives from the same report.
			const report = {
				compiled: ['media', 'search', 'audit', 'forms', 'cache'],
				entitled: ['media', 'search', 'audit', 'forms', 'cache'],
				plugins: [
					{ name: 'media', compiled: true, entitled: true, requested: true, active: true, phase: 'running' },
					{ name: 'search', compiled: true, entitled: true, requested: true, active: false, phase: 'lazy' },
					{ name: 'audit', compiled: true, entitled: true, requested: true, active: true, phase: 'running' },
					{ name: 'forms', compiled: true, entitled: true, requested: true, active: false, phase: 'failed' },
					{ name: 'cache', compiled: false, entitled: true, requested: true, active: false, phase: 'registered' },
				],
			};
			const entitlements = { plan: '', state: '', features: [], withheld: ['search'] };
			const routes = {
				'/api/admin/plugins/running': () => json({ plugins: ['audit', 'media'], withheld: ['search'] }),
				'/api/admin/plugins/status': () => json(report),
				'/api/admin/entitlements': () => json(entitlements),
			};
			const listRead = (seen: string[]) => seen.some((u) => u.includes('/api/admin/plugins/running'));

			it('builds the same plugin set from the status report as the running list gives', async () => {
				const editor = engine(['editor'], routes);
				const operator = engine(['super_admin'], routes);
				const fromList = (await editor.run())!.plugins;
				const fromStatus = (await operator.run())!.plugins;
				expect(fromList).toEqual({ state: 'named', running: ['audit', 'media'], withheld: ['search'] });
				expect(fromStatus).toEqual(fromList);
				expect(listRead(editor.seen)).toBe(true);
				expect(listRead(operator.seen)).toBe(false);
			});

			it('reads the running list when the status report could not be read', async () => {
				const { seen, run } = engine(['admin'], { ...routes, '/api/admin/plugins/status': () => json({ error: 'down' }, 503) });
				expect((await run())!.plugins).toEqual({ state: 'named', running: ['audit', 'media'], withheld: ['search'] });
				expect(listRead(seen)).toBe(true);
			});

			it('reads the running list when the entitlements could not be read', async () => {
				// Without them nothing says what is withheld, and a set derived
				// without that would offer a withheld plugin's pages.
				const { seen, run } = engine(['admin'], { ...routes, '/api/admin/entitlements': () => json({ error: 'down' }, 503) });
				expect((await run())!.plugins).toEqual({ state: 'named', running: ['audit', 'media'], withheld: ['search'] });
				expect(listRead(seen)).toBe(true);
			});
		});

		it.each([['editor'], ['viewer']])('never asks the engine for the entitlements on behalf of the %s role', async (role) => {
			const { seen, run } = engine([role], {
				'/api/admin/plugins/running': () => json({ plugins: ['media'], withheld: [] }),
				'/api/admin/entitlements': () => json({ plan: 'example', state: 'active', features: ['example'] }),
			});
			const result = await run();
			expect(seen.some((u) => u.includes('/api/admin/entitlements'))).toBe(false);
			expect(result!.entitlements.features).toEqual([]);
		});

		it.each([['admin'], ['super_admin']])('reads the entitlements for the %s role', async (role) => {
			const { seen, run } = engine([role], {
				'/api/admin/plugins/running': () => json({ plugins: ['media'], withheld: [] }),
				'/api/admin/entitlements': () => json({ plan: 'example', state: 'active', features: ['example'] }),
			});
			const result = await run();
			expect(seen.some((u) => u.includes('/api/admin/entitlements'))).toBe(true);
			expect(result!.entitlements.features).toEqual(['example']);
		});

		it('shows every page to an editor on an engine without the list', async () => {
			const { run } = engine(['editor'], {
				'/api/admin/plugins/running': () => json({ error: 'not found' }, 404),
			});
			expect((await run())!.plugins).toEqual({ state: 'unnamed' });
		});

		it('keeps a failed read apart from an engine that runs nothing', async () => {
			const { run } = engine(['super_admin'], {
				'/api/admin/plugins/running': () => json({ error: 'unavailable' }, 503),
			});
			expect((await run())!.plugins).toEqual({ state: 'unread' });
		});

		it('does not read the customization from an engine without the multitenant plugin', async () => {
			const { seen, run } = engine(['admin'], {
				'/api/admin/plugins/running': () => json({ plugins: ['media'], withheld: [] }),
			});
			const result = await run();
			expect(result!.customization.entitled).toBe(false);
			expect(seen.some((u) => u.includes('/api/admin/customization'))).toBe(false);
		});

		it('reads the customization while the multitenant plugin runs', async () => {
			const { seen, run } = engine(['admin'], {
				'/api/admin/plugins/running': () => json({ plugins: ['multitenant'], withheld: [] }),
				'/api/admin/customization': () => json({ entitled: true, settings: {}, pages: [] }),
			});
			await run();
			expect(seen.some((u) => u.includes('/api/admin/customization'))).toBe(true);
		});

		// Every page reads its title, logo and tab icon from this one copy.
		it('hands the session tenant brand to every page', async () => {
			const { run } = engine(['editor'], {
				'/api/admin/plugins/running': () => json({ plugins: ['multitenant'], withheld: [] }),
				'/api/admin/customization': () =>
					json({ entitled: true, settings: { brand: { name: 'Acme', logo_url: '/api/v1/media/1/l.png', accent: '#0a7cff', welcome: 'Hi', favicon_url: '/api/v1/media/2/i.png' } }, pages: [] }),
			});
			expect((await run())!.brand).toEqual({ name: 'Acme', logo_url: '/api/v1/media/1/l.png', accent: '#0a7cff', favicon_url: '/api/v1/media/2/i.png' });
		});
	});

	/*
	 * The license module serves its own links and says whether this console may
	 * renew. Its route answers every signed-in role, and an engine that links
	 * no module is not asked at all.
	 */
	describe('license module', () => {
		type Routes = Record<string, () => Response | Promise<Response>>;
		function engine(roles: string[], routes: Routes) {
			const seen: string[] = [];
			const fetch = vi.fn(async (url: string) => {
				seen.push(String(url));
				if (String(url).includes('/api/admin/auth/me')) return json({ id: 'u1', email: 'a@b.co', roles });
				for (const [path, answer] of Object.entries(routes)) if (String(url).includes(path)) return answer();
				return json({});
			}) as unknown as typeof globalThis.fetch;
			return { seen, run: () => load({ fetch, depends: vi.fn(), cookies: mockCookies({ '__Host-sys_session': 'valid-token' }) } as never) };
		}
		const presentation = {
			links: [
				{ rel: 'support', label: 'Help', url: 'https://example.test/help' },
				{ rel: 'purchase', label: 'Buy', url: 'javascript:alert(1)' },
			],
			renew: true,
		};
		const asked = (seen: string[]) => seen.some((u) => new URL(u, 'http://x').pathname === '/api/admin/license');

		it('reads the links and the renewal the module serves, keeping only the safe links', async () => {
			const { seen, run } = engine(['super_admin'], {
				'/api/admin/entitlements': () => json({ plan: 'example', state: 'active', features: [], license_module: true }),
				'/api/admin/license': () => json(presentation),
			});
			const result = await run();
			expect(asked(seen)).toBe(true);
			expect(result!.licensing).toEqual({
				links: [{ rel: 'support', label: 'Help', href: 'https://example.test/help' }],
				renew: true,
			});
		});

		it('does not ask an engine that says it links no license module', async () => {
			const { seen, run } = engine(['super_admin'], {
				'/api/admin/entitlements': () => json({ plan: 'free', state: 'free', features: [], license_module: false }),
				'/api/admin/license': () => json(presentation),
			});
			const result = await run();
			expect(asked(seen)).toBe(false);
			expect(result!.licensing).toEqual({ links: [], renew: false });
		});

		it('asks on behalf of an editor, whom the entitlements are refused, and reads a 404 as no links', async () => {
			const { seen, run } = engine(['editor'], {
				'/api/admin/entitlements': () => json({ error: 'forbidden' }, 403),
				'/api/admin/license': () => json({ error: 'not found' }, 404),
			});
			const result = await run();
			expect(asked(seen)).toBe(true);
			expect(result!.licensing).toEqual({ links: [], renew: false });
		});

		it('gives an editor the support link on an engine that links a module', async () => {
			const { run } = engine(['editor'], {
				'/api/admin/entitlements': () => json({ error: 'forbidden' }, 403),
				'/api/admin/license': () => json(presentation),
			});
			expect((await run())!.licensing).toEqual({
				links: [{ rel: 'support', label: 'Help', href: 'https://example.test/help' }],
				renew: true,
			});
		});
	});

	it('gives the console the reader and what the license grants', async () => {
		const user = { id: 'u1', email: 'a@b.co', roles: ['admin'], tenant_id: 't', disabled: false, created_at: '' };
		const entitlements = { plan: 'example', state: 'active', features: ['example'], caps: {} };
		const fetch = vi.fn(async (url: string, _init: RequestInit) => {
			if (String(url).includes('/api/admin/setup')) return json({ setup_required: false });
			if (String(url).includes('/api/admin/auth/me')) return json(user);
			if (String(url).includes('/api/admin/entitlements')) return json(entitlements);
			return json({});
		}) as unknown as typeof globalThis.fetch;
		const cookies = mockCookies({ '__Host-sys_session': 'valid-token' });

		const result = await load({ fetch, depends: vi.fn(), cookies } as never);

		expect(result).toBeDefined();
		expect(result!.user).toEqual(user);
		expect(result!.entitlements).toEqual(entitlements);
	});
});
