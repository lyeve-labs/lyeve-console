import { afterEach, describe, it, expect, vi } from 'vitest';

const KEY = '0123456789abcdef0123456789abcdef';

vi.hoisted(() => {
	process.env.LYEVE_CONSOLE_KEY = '0123456789abcdef0123456789abcdef';
	process.env.CORE_INTERNAL_URL = 'http://engine.internal:3001';
});
vi.mock('$app/env', () => ({ dev: false }));

import { handleFetch } from './hooks.server';
import {
	CONSOLE_CLIENT_HEADER,
	CONSOLE_SIGNATURE_HEADER,
	CONSOLE_TIME_HEADER,
	consoleSignature
} from '#lib/server/engine.ts';

async function call(url: string, headers: Record<string, string> = {}, browser?: string): Promise<Request> {
	const sent: Request[] = [];
	const fetch = vi.fn(async (req: Request) => {
		sent.push(req);
		return new Response(null, { status: 204 });
	});
	const event = {
		url: new URL('https://admin.example.com/admin/users'),
		getClientAddress: () => '203.0.113.9',
		request: new Request('https://admin.example.com/admin/users', {
			headers: browser ? { 'User-Agent': browser } : {}
		})
	};
	await handleFetch({
		request: new Request(url, { headers }),
		fetch,
		event
	} as unknown as Parameters<typeof handleFetch>[0]);
	return sent[0];
}

describe('handleFetch', () => {
	it('sends an engine call to the engine, signed for the browser', async () => {
		const req = await call('https://admin.example.com/api/admin/users?page=2', {
			Authorization: 'Bearer abc'
		});
		expect(req.url).toBe('http://engine.internal:3001/api/admin/users?page=2');
		expect(req.headers.get(CONSOLE_CLIENT_HEADER)).toBe('203.0.113.9');
		const stamp = req.headers.get(CONSOLE_TIME_HEADER) ?? '';
		expect(req.headers.get(CONSOLE_SIGNATURE_HEADER)).toBe(
			consoleSignature(KEY, stamp, 'GET', '/api/admin/users', 'page=2', '203.0.113.9', 'Bearer abc')
		);
	});

	it('replaces console headers the browser sent with its own', async () => {
		const req = await call('https://admin.example.com/api/admin/users', {
			[CONSOLE_CLIENT_HEADER]: '198.51.100.1',
			[CONSOLE_SIGNATURE_HEADER]: 'forged'
		});
		expect(req.headers.get(CONSOLE_CLIENT_HEADER)).toBe('203.0.113.9');
		expect(req.headers.get(CONSOLE_SIGNATURE_HEADER)).not.toBe('forged');
	});

	it('names the browser to the engine, not this server', async () => {
		const browser = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 Safari/605.1.15';
		const req = await call('https://admin.example.com/api/admin/devices', {}, browser);
		expect(req.headers.get('user-agent')).toBe(browser);
	});

	it('leaves a call to another origin alone', async () => {
		const req = await call('https://elsewhere.example.net/api/items');
		expect(req.url).toBe('https://elsewhere.example.net/api/items');
		expect(req.headers.has(CONSOLE_CLIENT_HEADER)).toBe(false);
		expect(req.headers.has(CONSOLE_SIGNATURE_HEADER)).toBe(false);
	});

	it('leaves a non-api call alone', async () => {
		const req = await call('https://admin.example.com/robots.txt');
		expect(req.url).toBe('https://admin.example.com/robots.txt');
		expect(req.headers.has(CONSOLE_SIGNATURE_HEADER)).toBe(false);
	});

	it('passes the engine\'s CSRF cookie on to the browser', async () => {
		const set = vi.fn();
		const fetch = vi.fn(async () => {
			const headers = new Headers();
			headers.append('Set-Cookie', '__Host-sys_session=jwt; Path=/; HttpOnly; Secure; SameSite=Strict');
			headers.append('Set-Cookie', '__Host-csrf=pair; Path=/; Max-Age=900; Secure; SameSite=Strict');
			return new Response('{}', { status: 200, headers });
		});
		await handleFetch({
			request: new Request('https://admin.example.com/api/admin/auth/login', { method: 'POST' }),
			fetch,
			event: {
				url: new URL('https://admin.example.com/login'),
				getClientAddress: () => '203.0.113.9',
				cookies: { set }
			}
		} as unknown as Parameters<typeof handleFetch>[0]);
		expect(set).toHaveBeenCalledTimes(1);
		expect(set).toHaveBeenCalledWith('__Host-csrf', 'pair', expect.objectContaining({ path: '/', secure: true }));
	});
});

describe('handleFetch key names', () => {
	afterEach(() => {
		vi.unstubAllEnvs();
		vi.resetModules();
	});

	async function signedWith(env: Record<string, string>): Promise<{ req: Request; sign: typeof consoleSignature }> {
		for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
		vi.resetModules();
		const hook = (await import('./hooks.server')).handleFetch;
		const sign = (await import('#lib/server/engine.ts')).consoleSignature;
		const sent: Request[] = [];
		await hook({
			request: new Request('https://admin.example.com/api/admin/users'),
			fetch: vi.fn(async (req: Request) => {
				sent.push(req);
				return new Response(null, { status: 204 });
			}),
			event: {
				url: new URL('https://admin.example.com/admin/users'),
				getClientAddress: () => '203.0.113.9',
				request: new Request('https://admin.example.com/admin/users')
			}
		} as unknown as Parameters<typeof handleFetch>[0]);
		return { req: sent[0], sign };
	}

	const OTHER = 'fedcba9876543210fedcba9876543210';

	it('signs with LYEVE_CONSOLE_KEY when only it is set', async () => {
		const { req, sign } = await signedWith({ LYEVE_CONSOLE_KEY: OTHER, ADMIN_CONSOLE_KEY: '' });
		const stamp = req.headers.get(CONSOLE_TIME_HEADER) ?? '';
		expect(req.headers.get(CONSOLE_SIGNATURE_HEADER)).toBe(
			sign(OTHER, stamp, 'GET', '/api/admin/users', '', '203.0.113.9', '')
		);
	});

	it('signs with ADMIN_CONSOLE_KEY when only the old name is set', async () => {
		const { req, sign } = await signedWith({ LYEVE_CONSOLE_KEY: '', ADMIN_CONSOLE_KEY: OTHER });
		const stamp = req.headers.get(CONSOLE_TIME_HEADER) ?? '';
		expect(req.headers.get(CONSOLE_SIGNATURE_HEADER)).toBe(
			sign(OTHER, stamp, 'GET', '/api/admin/users', '', '203.0.113.9', '')
		);
	});
});

describe('handleFetch without CORE_INTERNAL_URL', () => {
	afterEach(() => {
		vi.unstubAllEnvs();
		vi.resetModules();
	});

	/** The hook as a console started with only the dev proxy's targets loads it. */
	async function fallbackHook(): Promise<typeof handleFetch> {
		vi.stubEnv('CORE_INTERNAL_URL', '');
		vi.stubEnv('CORE_API_INTERNAL_URL', '');
		vi.stubEnv('PROXY_ADMIN_TARGET', 'http://engine.local:3001');
		vi.stubEnv('PROXY_API_TARGET', 'http://engine.local:3002');
		vi.resetModules();
		return (await import('./hooks.server')).handleFetch;
	}

	async function sendWith(hook: typeof handleFetch, url: string, set = vi.fn()): Promise<Request> {
		const sent: Request[] = [];
		const fetch = vi.fn(async (req: Request) => {
			sent.push(req);
			const headers = new Headers();
			headers.append('Set-Cookie', '__Host-csrf=pair; Path=/; Max-Age=900; Secure; SameSite=Strict');
			return new Response('{}', { status: 200, headers });
		});
		await hook({
			request: new Request(url, { method: 'POST' }),
			fetch,
			event: {
				url: new URL('https://admin.example.com/admin/users'),
				getClientAddress: () => '203.0.113.9',
				cookies: { set }
			}
		} as unknown as Parameters<typeof handleFetch>[0]);
		return sent[0];
	}

	// Left inside this app, the call runs the console's own hooks with the
	// browser's cookies, and a session renewal sent that way waits on itself.
	it('sends an admin call to the admin listener the dev proxy names', async () => {
		const req = await sendWith(await fallbackHook(), 'https://admin.example.com/api/admin/auth/refresh');
		expect(req.url).toBe('http://engine.local:3001/api/admin/auth/refresh');
		expect(req.headers.get(CONSOLE_CLIENT_HEADER)).toBe('203.0.113.9');
	});

	it('sends a content call to the content listener the dev proxy names', async () => {
		const req = await sendWith(await fallbackHook(), 'https://admin.example.com/api/v1/auth/token');
		expect(req.url).toBe('http://engine.local:3002/api/v1/auth/token');
	});

	it('still passes the engine\'s CSRF cookie on to the browser', async () => {
		const set = vi.fn();
		await sendWith(await fallbackHook(), 'https://admin.example.com/api/admin/auth/login', set);
		expect(set).toHaveBeenCalledWith('__Host-csrf', 'pair', expect.objectContaining({ path: '/' }));
	});
});
