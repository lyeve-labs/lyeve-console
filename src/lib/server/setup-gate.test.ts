import { describe, it, expect, vi, beforeEach } from 'vitest';

type SetupGate = typeof import('./setup-gate');
let isGatedPath: SetupGate['isGatedPath'];
let readEngineSetup: SetupGate['readEngineSetup'];
let safeNext: SetupGate['safeNext'];
let setupGateRedirect: SetupGate['setupGateRedirect'];

/** The gate caches a ready engine in the module, so a case that needs it cold loads the module again. */
async function freshGate(): Promise<void> {
	vi.resetModules();
	({ isGatedPath, readEngineSetup, safeNext, setupGateRedirect } = await import('./setup-gate'));
}

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function engine(body: unknown, status = 200) {
	return vi.fn(async () => json(body, status)) as unknown as typeof fetch;
}

const down = vi.fn(async () => {
	throw new Error('ECONNREFUSED');
}) as unknown as typeof fetch;

beforeEach(freshGate);

describe('readEngineSetup', () => {
	it.each([
		[{ setup_required: true, mode: 'setup', token_source: 'log' }, 'setup_mode'],
		[{ setup_required: true, token_source: 'env' }, 'needs_admin'],
		[{ setup_required: false }, 'ready'],
	])('reads %j as %s', async (body, state) => {
		expect((await readEngineSetup(engine(body))).state).toBe(state);
	});

	it('reads a rate-limited answer as busy, not as down', async () => {
		expect((await readEngineSetup(engine({ error: 'rate limit exceeded' }, 429))).state).toBe('busy');
	});

	it('reads a failed request as unreachable, not as either answer', async () => {
		expect(await readEngineSetup(down)).toEqual({ state: 'unreachable', tokenSource: null });
		expect((await readEngineSetup(engine({ error: 'x' }, 502))).state).toBe('unreachable');
	});
});

describe('isGatedPath', () => {
	it.each([
		['/', true],
		['/login', true],
		['/admin/schema', true],
		['/setup', false],
		['/api/admin/pool', false],
		['/_app/immutable/entry.js', false],
		['/favicon.svg', false],
		['/robots.txt', false],
		['/readyz', false],
	])('%s -> %s', (path, gated) => {
		expect(isGatedPath(path)).toBe(gated);
	});
});

describe('safeNext', () => {
	it.each([
		['/admin/users', '/admin/users'],
		['/admin/users?page=2', '/admin/users?page=2'],
		['//evil.example', null],
		['/\\evil.example', null],
		['https://evil.example', null],
		['/setup', null],
		// The browser drops a tab or line break from a URL, so each of these
		// would become //evil.example/x and leave the origin.
		['/\t/evil.example/x', null],
		['/\n/evil.example/x', null],
		['/\r/evil.example/x', null],
		[null, null],
	])('%j -> %j', (next, want) => {
		expect(safeNext(next)).toBe(want);
	});
});

describe('setupGateRedirect', () => {
	it('lets every page through once the engine has an account', async () => {
		expect(await setupGateRedirect(new URL('http://a/admin/schema'), engine({ setup_required: false }))).toBeNull();
	});

	it.each([
		['setup mode', engine({ setup_required: true, mode: 'setup' })],
		['no account yet', engine({ setup_required: true })],
		['engine unreachable', down],
	])('sends every page to the setup screen when %s', async (_name, fetchFn) => {
		expect(await setupGateRedirect(new URL('http://a/admin/users?page=2'), fetchFn)).toBe(
			'/setup?next=%2Fadmin%2Fusers%3Fpage%3D2',
		);
		expect(await setupGateRedirect(new URL('http://a/login'), fetchFn)).toBe('/setup?next=%2Flogin');
		expect(await setupGateRedirect(new URL('http://a/'), fetchFn)).toBe('/setup');
	});

	it('never gates the setup screen or assets, and asks the engine nothing for them', async () => {
		const fetchFn = engine({ setup_required: true, mode: 'setup' });
		expect(await setupGateRedirect(new URL('http://a/setup'), fetchFn)).toBeNull();
		expect(await setupGateRedirect(new URL('http://a/_app/x.js'), fetchFn)).toBeNull();
		expect(fetchFn).not.toHaveBeenCalled();
	});

	it('remembers a ready engine briefly, and nothing else', async () => {
		const ready = engine({ setup_required: false });
		await setupGateRedirect(new URL('http://a/admin'), ready, 1_000);
		await setupGateRedirect(new URL('http://a/admin'), ready, 2_000);
		expect(ready).toHaveBeenCalledTimes(1);
		await setupGateRedirect(new URL('http://a/admin'), ready, 1_000 + 16_000);
		expect(ready).toHaveBeenCalledTimes(2);

		await freshGate();
		const setup = engine({ setup_required: true, mode: 'setup' });
		await setupGateRedirect(new URL('http://a/admin'), setup, 1_000);
		await setupGateRedirect(new URL('http://a/admin'), setup, 1_001);
		expect(setup).toHaveBeenCalledTimes(2);
	});
});

describe('setupGateRedirect for a signed-in request', () => {
	it('lets it through an unreachable engine, and keeps it out of the ready cache', async () => {
		expect(await setupGateRedirect(new URL('http://a/admin/users'), down, 1_000, true)).toBeNull();
		expect(await setupGateRedirect(new URL('http://a/admin/users'), down, 1_001)).toBe('/setup?next=%2Fadmin%2Fusers');
	});

	it.each([
		['setup mode', engine({ setup_required: true, mode: 'setup' })],
		['no account yet', engine({ setup_required: true })],
	])('still sends it to the setup screen in %s', async (_name, fetchFn) => {
		expect(await setupGateRedirect(new URL('http://a/admin'), fetchFn, 1_000, true)).toBe('/setup?next=%2Fadmin');
	});
});

describe('setupGateRedirect when the engine is rate limiting', () => {
	// A sign-in the engine refused with 429 must reach its own action, which
	// reports the refusal. Redirecting it to setup would lose the message.
	it('lets the request through and does not cache it as ready', async () => {
		const busy = engine({ error: 'rate limit exceeded' }, 429);
		expect(await setupGateRedirect(new URL('http://admin/login'), busy, 1_000)).toBeNull();
		expect(await setupGateRedirect(new URL('http://admin/login'), down, 1_001)).toBe('/setup?next=%2Flogin');
	});
});
