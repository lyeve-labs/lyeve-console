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
		url: new URL('http://admin/admin/observability/cache/rules'),
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
		request: new Request('http://admin/admin/observability/cache/rules', { method: 'POST', body }),
		cookies: {},
		fetch: vi.fn(),
	} as never;
}

const rule = {
	id: '7d3c6f0e-1d1b-4a8e-9f55-0a4f2b1c9e11',
	pattern: '/api/v1/content/posts/**',
	ttl_seconds: 300,
	tags: ['posts'],
	enabled: true,
	created_at: '2026-10-01T00:00:00Z',
	updated_at: '2026-10-01T00:00:00Z',
};

beforeEach(() => {
	vi.clearAllMocks();
	authz.roles = ['admin'];
	authz.requireRole.mockImplementation(async (_event: unknown, allowed: string[]) => {
		if (!allowed.some((r) => authz.roles.includes(r))) throw new Error('403');
		return { id: 'u1', roles: authz.roles };
	});
	api.listRules.mockResolvedValue({
		data: [rule],
		total_count: 1,
		licensed: false,
		limits: { rules: { limit: 10, current: 1 } },
	});
});

describe('cache rules load', () => {
	it('reads the rules with their ceiling and tier for a tenant admin', async () => {
		const result = (await load(loadEvent(['admin']))) as Loaded;
		expect(result.gate).toEqual({ state: 'ok' });
		expect(result.rules.rows).toEqual([rule]);
		expect(result.rules.limit).toEqual({ limit: 10, current: 1 });
		expect(result.rules.licensed).toBe(false);
	});

	it('says a failed rules read failed and keeps the page', async () => {
		api.listRules.mockRejectedValue(new Error('down'));
		const result = (await load(loadEvent(['admin']))) as Loaded;
		expect(result.gate).toEqual({ state: 'ok' });
		expect(result.rules.gate.state).toBe('error');
	});

	// The shell says why while the plugin does not run, so the page reads nothing.
	it('reads nothing while the plugin does not run', async () => {
		const plugins = { state: 'named', running: [], withheld: [] };
		const result = (await load(loadEvent(['super_admin'], '', plugins))) as Loaded;
		expect(result.gate).toEqual({ state: 'absent' });
		expect(api.listRules).not.toHaveBeenCalled();
	});
});

describe('cache rule actions', () => {
	it('creates a rule with its tags split and its switch read', async () => {
		api.createRule.mockResolvedValue(rule);
		const out = await actions.createRule(
			formEvent({ pattern: '/api/v1/content/posts/**', ttl_seconds: '300', tags: 'posts, news posts', enabled: 'true' }),
		);
		expect(api.createRule).toHaveBeenCalledWith(expect.anything(), {
			pattern: '/api/v1/content/posts/**',
			ttl_seconds: 300,
			tags: ['posts', 'news'],
			enabled: true,
		});
		expect(out).toEqual({ savedRule: '/api/v1/content/posts/**' });
	});

	it('refuses a pattern outside the content API before the round trip', async () => {
		const out = (await actions.createRule(formEvent({ pattern: '/admin/x', ttl_seconds: '60' }))) as {
			status: number;
		};
		expect(out.status).toBe(400);
		expect(api.createRule).not.toHaveBeenCalled();
	});

	// The ceiling is the plugin's. The page renders its numbers from the
	// refusal, never from a constant of its own.
	it('returns the ceiling refusal with the numbers the plugin sent', async () => {
		api.createRule.mockRejectedValue(
			new ApiError(402, 'cap_exceeded', { error: 'cap_exceeded', cap: 'example.rules', limit: 10, current: 10 }),
		);
		const out = (await actions.createRule(formEvent({ pattern: '/api/v1/content/x', ttl_seconds: '60' }))) as {
			status: number;
			data: { refused: { kind: string; limit: number; current: number } };
		};
		expect(out.status).toBe(402);
		expect(out.data.refused).toMatchObject({ kind: 'cap', limit: 10, current: 10 });
	});

	it('purges one rule, a tag or everything', async () => {
		api.purgeRule.mockResolvedValue(3);
		api.purgeResponses.mockResolvedValue(5);
		expect(await actions.purge(formEvent({ rule: rule.id }))).toEqual({ purged: 3, purgedWhat: 'rule' });
		expect(api.purgeRule).toHaveBeenCalledWith(expect.anything(), rule.id);
		expect(await actions.purge(formEvent({ tag: 'posts' }))).toEqual({ purged: 5, purgedWhat: 'tag posts' });
		expect(api.purgeResponses).toHaveBeenLastCalledWith(expect.anything(), 'posts');
		expect(await actions.purge(formEvent({}))).toEqual({ purged: 5, purgedWhat: 'all' });
		expect(api.purgeResponses).toHaveBeenLastCalledWith(expect.anything(), '');
	});

	it('purges nothing on a post that skipped the question, and keeps what it named for the second post', async () => {
		const body = new FormData();
		body.set('tag', 'posts');
		const url = new URL('http://admin/admin/observability/cache/rules?/purge');
		const out = await actions.purge({ url, request: new Request(url, { method: 'POST', body }), cookies: {}, fetch: vi.fn() } as never);
		expect(api.purgeResponses).not.toHaveBeenCalled();
		expect(api.purgeRule).not.toHaveBeenCalled();
		expect(out).toMatchObject({
			unconfirmed: { question: 'Purge these cached responses?', label: 'Purge', action: '/admin/observability/cache/rules?/purge', fields: [['tag', 'posts']] },
		});
	});
});

describe('cache rule update', () => {
	const fields = { id: rule.id, pattern: '/api/v1/content/posts/**', ttl_seconds: '600', tags: 'posts', enabled: 'false' };

	it('saves the rule it names', async () => {
		api.updateRule.mockResolvedValue(rule);
		expect(await actions.updateRule(formEvent(fields))).toEqual({ savedRule: '/api/v1/content/posts/**' });
		expect(api.updateRule).toHaveBeenCalledWith(expect.anything(), rule.id, {
			pattern: '/api/v1/content/posts/**',
			ttl_seconds: 600,
			tags: ['posts'],
			enabled: false,
		});
	});

	it('refuses a save that names no rule', async () => {
		const out = (await actions.updateRule(formEvent({ ...fields, id: '' }))) as { status: number };
		expect(out.status).toBe(400);
		expect(api.updateRule).not.toHaveBeenCalled();
	});

	it('refuses a role the plugin does not admit', async () => {
		authz.roles = ['editor'];
		await expect(actions.updateRule(formEvent(fields))).rejects.toThrow('403');
	});

	it("relays the plugin's refusal into the rule drawer", async () => {
		api.updateRule.mockRejectedValue(new ApiError(422, 'pattern overlaps another rule', { error: 'pattern overlaps another rule', code: 'http_422' }));
		const out = (await actions.updateRule(formEvent(fields))) as { status: number; data: Record<string, unknown> };
		expect(out.status).toBe(400);
		expect(out.data.error).toBe('pattern overlaps another rule');
		expect(out.data.drawer).toBe('rule');
	});

	it('says an outage failed the save', async () => {
		api.updateRule.mockRejectedValue(new ApiError(503, 'down', {}));
		const out = (await actions.updateRule(formEvent(fields))) as { status: number; data: Record<string, unknown> };
		expect(out.status).toBe(400);
		expect(out.data.error).toBe('Could not save the rule. Try again.');
		expect(out.data.drawer).toBe('rule');
	});
});

describe('which surface a failure belongs to', () => {
	it('tags a failed rule save for the rule drawer', async () => {
		api.createRule.mockRejectedValue(new ApiError(503, 'down', {}));
		const out = (await actions.createRule(formEvent({ pattern: '/api/v1/content/x', ttl_seconds: '60' }))) as { data: Record<string, unknown> };
		expect(out.data.drawer).toBe('rule');
	});

	it('leaves a failed delete untagged, for the page', async () => {
		authz.roles = ['admin'];
		api.deleteRule.mockRejectedValue(new ApiError(503, 'down', {}));
		const out = (await actions.deleteRule(formEvent({ id: rule.id }))) as { data: Record<string, unknown> };
		expect(out.data.drawer).toBeUndefined();
	});
});
