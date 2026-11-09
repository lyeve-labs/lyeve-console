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
		url: new URL('http://admin/admin/observability/cache/stored'),
		fetch: vi.fn(),
		cookies: sessionCookies(tenant),
		parent: async () => ({ user: { roles }, plugins }),
	} as never;
}

function formEvent(fields: Record<string, string>) {
	const body = new FormData();
	body.set('confirmed', 'yes');
	for (const [k, v] of Object.entries(fields)) body.set(k, v);
	return {
		request: new Request('http://admin/admin/observability/cache/stored', { method: 'POST', body }),
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
	api.listEntries.mockResolvedValue({ data: [], total_count: 0 });
});

describe('cache stored load', () => {
	it('keeps a failed read of the stored entries as a gate rather than an empty cache', async () => {
		api.listEntries.mockRejectedValue(new ApiError(503, 'down', {}));
		const result = (await load(loadEvent(['super_admin']))) as Loaded;
		expect(result.entriesGate).toEqual({ state: 'unavailable' });
		expect(result.entries).toEqual([]);
	});

	it('sends an offset past the stored entries back to the first page', async () => {
		api.listEntries.mockResolvedValue({ data: [], total_count: 0 });
		const event = loadEvent(['super_admin']) as unknown as { url: URL };
		event.url = new URL('http://admin/admin/observability/cache/stored?offset=100');
		await expect(load(event as never)).rejects.toMatchObject({ status: 307 });
	});

	// The stored keys describe every tenant, so a tenant admin's page never
	// asks for them, and their absence is not an error.
	it('never reads the stored keys for a tenant admin', async () => {
		const result = (await load(loadEvent(['admin']))) as Loaded;
		expect(api.listEntries).not.toHaveBeenCalled();
		expect(result.gate).toEqual({ state: 'ok' });
		expect(result.superAdmin).toBe(false);
		expect(result.entriesGate).toBeNull();
	});


	// The in-memory provider lists its keys. A networked one answers an empty
	// page and a note, which is not an empty cache.
	it('marks a provider that cannot list its entries', async () => {
		api.listEntries.mockResolvedValue({
			data: [],
			total_count: 0,
			limit: 51,
			offset: 0,
			note: 'entry listing is only available with the in-memory provider',
		});
		const result = (await load(loadEvent(['super_admin']))) as Loaded;
		expect(result.unlisted).toBe(true);
		expect(result.entries).toEqual([]);
	});

	it('reads an empty page with no note as an empty cache', async () => {
		const result = (await load(loadEvent(['super_admin']))) as Loaded;
		expect(result.unlisted).toBe(false);
	});

	it("scopes the flush to the session's tenant whenever the session names one", async () => {
		expect(((await load(loadEvent(['admin']))) as Loaded).flushScoped).toBe(true);
		expect(((await load(loadEvent(['super_admin'], 'acme'))) as Loaded).flushScoped).toBe(true);
		expect(((await load(loadEvent(['super_admin']))) as Loaded).flushScoped).toBe(false);
	});

	// The shell says why while the plugin does not run, so the page reads nothing.
	it('reads nothing while the plugin does not run', async () => {
		const plugins = { state: 'named', running: [], withheld: [] };
		const result = (await load(loadEvent(['super_admin'], '', plugins))) as Loaded;
		expect(result.gate).toEqual({ state: 'absent' });
		expect(api.listEntries).not.toHaveBeenCalled();
	});
});

describe('cache flush', () => {
	// The plugin admits a tenant admin and scopes the flush to the tenant.
	it('flushes for a tenant admin', async () => {
		api.flushAll.mockResolvedValue(undefined);
		expect(await actions.flush(formEvent({}))).toEqual({ flushed: 'everything' });
		expect(api.flushAll).toHaveBeenCalled();
	});

	it('flushes one tag for a super admin', async () => {
		authz.roles = ['super_admin'];
		api.flushTag.mockResolvedValue(undefined);
		expect(await actions.flush(formEvent({ tag: 'posts' }))).toEqual({ flushed: 'posts' });
		expect(api.flushTag).toHaveBeenCalledWith(expect.anything(), 'posts');
	});

	// A tag other than a tenant tag is flushed from every tenant's entries.
	it('refuses a tag flush from a tenant admin', async () => {
		await expect(actions.flush(formEvent({ tag: 'posts' }))).rejects.toThrow('403');
		expect(api.flushTag).not.toHaveBeenCalled();
	});

	it('refuses a role the plugin does not admit', async () => {
		authz.roles = ['editor'];
		await expect(actions.flush(formEvent({}))).rejects.toThrow('403');
		expect(api.flushAll).not.toHaveBeenCalled();
	});

	it("relays the plugin's refusal", async () => {
		authz.roles = ['super_admin'];
		api.flushTag.mockRejectedValue(new ApiError(403, "cannot flush another tenant's cache entries", { error: "cannot flush another tenant's cache entries", code: 'forbidden' }));
		const out = (await actions.flush(formEvent({ tag: 'tenant:other' }))) as { status: number; data: { error: string } };
		expect(out.status).toBe(400);
		expect(out.data.error).toBe("cannot flush another tenant's cache entries");
	});

	it('says an outage failed the flush', async () => {
		api.flushAll.mockRejectedValue(new ApiError(503, 'down', {}));
		const out = (await actions.flush(formEvent({}))) as { status: number; data: { error: string } };
		expect(out.status).toBe(400);
		expect(out.data.error).toBe('Could not flush the cache. Try again.');
	});
});
