import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiError } from '@lyeve-labs/client';

const api = vi.hoisted(() => ({
	readStats: vi.fn(),
	listProviders: vi.fn(),
	listEntries: vi.fn(),
	listRules: vi.fn(),
	createRule: vi.fn(),
	updateRule: vi.fn(),
	deleteRule: vi.fn(),
	purgeRule: vi.fn(),
	purgeResponses: vi.fn(),
	flushAll: vi.fn(),
	flushTag: vi.fn(),
	resetCircuit: vi.fn(),
}));

vi.mock('$lib/api/cache', async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	...api,
}));

const authz = vi.hoisted(() => ({
	roles: ['admin'] as string[],
	requireRole: vi.fn(),
}));

vi.mock('$lib/server/authz', () => ({
	authedClient: vi.fn(() => ({})),
	requireRole: authz.requireRole,
}));


import { load, actions } from './+page.server';

type Loaded = Exclude<Awaited<ReturnType<typeof load>>, void>;

// The session cookie as the engine signs it. The engine's me answer carries no
// tenant, so the page takes it from the token.
function sessionCookies(tenant: string) {
	const part = (v: object) => Buffer.from(JSON.stringify(v)).toString('base64url');
	const token = `${part({ alg: 'HS256' })}.${part({ sub: 'u', roles: ['super_admin'], ...(tenant ? { tenant_id: tenant } : {}) })}.s`;
	return { get: (name: string) => (name === 'sys_session' ? token : undefined) };
}

function loadEvent(roles: string[], tenant = '', plugins?: unknown) {
	return {
		url: new URL('http://admin/admin/observability/cache'),
		fetch: vi.fn(),
		cookies: sessionCookies(tenant),
		parent: async () => ({ user: { roles }, plugins }),
	} as never;
}

function formEvent(fields: Record<string, string>) {
	const body = new FormData();
	for (const [k, v] of Object.entries(fields)) body.set(k, v);
	return {
		request: new Request('http://admin/admin/observability/cache', { method: 'POST', body }),
		cookies: {},
		fetch: vi.fn(),
	} as never;
}

beforeEach(() => {
	vi.clearAllMocks();
	authz.roles = ['admin'];
	authz.requireRole.mockImplementation(async (_event: unknown, allowed: string[]) => {
		if (!allowed.some((r) => authz.roles.includes(r))) throw new Error('403');
		return { id: 'u1', roles: authz.roles };
	});
	api.readStats.mockResolvedValue({ hits: 1, misses: 1, sets: 0, deletes: 0, flushes: 0, evictions: 0, entries: 1, max_size: 0 });
	api.listProviders.mockResolvedValue({
		data: [{ name: 'memory-0', kind: 'memory', priority: 0, enabled: true }],
		total_count: 1,
		licensed: false,
		inactive: [{ name: 'redis-1', kind: 'redis', priority: 1, reason: 'provider_limit' }],
	});
});

describe('cache overview load', () => {
	// The counters describe every tenant, so a tenant admin's page never asks
	// for them, and their absence is not an error.
	it('reads the providers for a tenant admin and never the engine counters', async () => {
		const result = (await load(loadEvent(['admin']))) as Loaded;
		expect(api.readStats).not.toHaveBeenCalled();
		expect(result.gate).toEqual({ state: 'ok' });
		expect(result.superAdmin).toBe(false);
		expect(result.providers).toHaveLength(1);
	});

	it('carries the provider tier and the providers left out with their reasons', async () => {
		const result = (await load(loadEvent(['super_admin']))) as Loaded;
		expect(api.readStats).toHaveBeenCalled();
		expect(result.providersLicensed).toBe(false);
		expect(result.inactive).toEqual([{ name: 'redis-1', kind: 'redis', priority: 1, reason: 'provider_limit' }]);
	});

	it('keeps a refused providers read as its gate', async () => {
		api.listProviders.mockRejectedValue(new ApiError(503, 'down', {}));
		const result = (await load(loadEvent(['admin']))) as Loaded;
		expect(result.providersRead).toBe(false);
		expect(result.providersGate).toEqual({ state: 'unavailable' });
	});

	it('reads a provider list with no tier as unknown rather than as one that needs no license', async () => {
		api.listProviders.mockResolvedValue({ data: [], total_count: 0 });
		const result = (await load(loadEvent(['admin']))) as Loaded;
		expect(result.providersLicensed).toBeNull();
		expect(result.inactive).toEqual([]);
	});

	// The shell says why while the plugin does not run, so the page reads nothing.
	it('reads nothing while the plugin does not run', async () => {
		const plugins = { state: 'named', running: [], withheld: [] };
		const result = (await load(loadEvent(['super_admin'], '', plugins))) as Loaded;
		expect(result.gate).toEqual({ state: 'absent' });
		expect(api.listProviders).not.toHaveBeenCalled();
	});
});

describe('cache circuit reset', () => {
	it('resets the named provider for a super admin', async () => {
		authz.roles = ['super_admin'];
		api.resetCircuit.mockResolvedValue(undefined);
		expect(await actions.resetCircuit(formEvent({ name: 'redis-1' }))).toEqual({ reset: 'redis-1' });
		expect(api.resetCircuit).toHaveBeenCalledWith(expect.anything(), 'redis-1');
	});

	// Every tenant is served from the providers, so the plugin keeps the reset
	// to a super admin.
	it('refuses a tenant admin', async () => {
		await expect(actions.resetCircuit(formEvent({ name: 'redis-1' }))).rejects.toThrow('403');
		expect(api.resetCircuit).not.toHaveBeenCalled();
	});

	it("relays the plugin's refusal", async () => {
		authz.roles = ['super_admin'];
		api.resetCircuit.mockRejectedValue(new ApiError(404, 'provider not found', {}));
		const out = (await actions.resetCircuit(formEvent({ name: 'gone' }))) as { status: number };
		expect(out.status).toBe(400);
	});

	it('says an outage failed the reset', async () => {
		authz.roles = ['super_admin'];
		api.resetCircuit.mockRejectedValue(new TypeError('fetch failed'));
		const out = (await actions.resetCircuit(formEvent({ name: 'redis-1' }))) as { status: number; data: { error: string } };
		expect(out.status).toBe(400);
		expect(out.data.error).toBe('Could not reset the circuit. Try again.');
	});
});
