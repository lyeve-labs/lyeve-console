import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Cookies } from '@sveltejs/kit';

vi.mock('@lyeve-labs/client', () => ({
	createClient: vi.fn(() => ({})),
	ApiError: class ApiError extends Error {
		status: number;
		body?: unknown;
		constructor(status: number, message: string, body?: unknown) {
			super(message);
			this.status = status;
			this.body = body;
		}
	},
}));

vi.mock('@lyeve-labs/client-rest', () => ({
	listPermissions: vi.fn(),
	getSchemas: vi.fn(),
	upsertPermission: vi.fn(),
	deletePermission: vi.fn(),
}));

const flows = vi.hoisted(() => ({ listAllFlows: vi.fn(async () => [] as { id: string; slug: string; name: string }[]) }));
vi.mock('$lib/api/flows', () => ({ listAllFlows: flows.listAllFlows }));

const limits = vi.hoisted(() => ({ getRoleLimits: vi.fn(async (): Promise<{ roles: { limit: number; current: number } }> => ({ roles: { limit: 0, current: 0 } })) }));
vi.mock('$lib/api/permissions', () => ({ getRoleLimits: limits.getRoleLimits }));

const session = vi.hoisted(() => ({ user: { roles: ['super_admin'] } as { roles: string[] } }));
vi.mock('$lib/server/authz', () => ({
	authedClient: vi.fn(() => ({})),
	requireRole: vi.fn(async () => ({ id: 'u1', roles: ['super_admin'] })),
	loadUser: vi.fn(async () => session.user),
}));

import { load, actions } from './+page.server';
import { listPermissions, getSchemas, upsertPermission } from '@lyeve-labs/client-rest';
import { ApiError } from '@lyeve-labs/client';

const mockedListPermissions = vi.mocked(listPermissions);
const mockedGetSchemas = vi.mocked(getSchemas);
const mockedUpsertPermission = vi.mocked(upsertPermission);

function mockCookies(): Cookies {
	return { get: vi.fn(() => 'session-token') } as unknown as Cookies;
}

function loadEvent() {
	session.user = { roles: ['super_admin'] };
	return {
		fetch: vi.fn(),
		cookies: mockCookies(),
	} as never;
}

interface LoadResult {
	permissions: unknown[];
	schemas: unknown[];
	loadGate: { state: string; message?: string } | null;
}

const permission = {
	id: 'a1b2c3d4-0000-0000-0000-000000000000',
	role: 'editor',
	schema_name: 'article',
	actions: ['read'],
	field_mask: [],
	created_at: '2026-01-01T00:00:00Z',
};

beforeEach(() => {
	vi.clearAllMocks();
});

describe('reading the rules', () => {
	it('returns the rules and schemas when both reads succeed', async () => {
		mockedListPermissions.mockResolvedValue([permission] as never);
		mockedGetSchemas.mockResolvedValue([{ name: 'article' }] as never);

		const result = (await load(loadEvent())) as unknown as LoadResult;

		expect(result.permissions).toEqual([permission]);
		expect(result.schemas).toEqual([{ name: 'article' }]);
		expect(result.loadGate).toBeNull();
	});

	it('reports a failed read rather than an empty matrix', async () => {
		// Swallowing the failure would render a page that says this instance
		// restricts nothing, on a screen whose next action grants access.
		mockedListPermissions.mockRejectedValue(new Error('503 service unavailable'));
		mockedGetSchemas.mockResolvedValue([{ name: 'article' }] as never);

		const result = (await load(loadEvent())) as unknown as LoadResult;

		expect(result.loadGate).toBeTruthy();
		expect(result.permissions).toEqual([]);
	});

	it('reports a failed schema read too', async () => {
		mockedListPermissions.mockResolvedValue([permission] as never);
		mockedGetSchemas.mockRejectedValue(new Error('session expired'));

		const result = (await load(loadEvent())) as unknown as LoadResult;

		expect(result.loadGate).toBeTruthy();
		expect(result.schemas).toEqual([]);
	});

	it('keeps the engine message out of the response', async () => {
		mockedListPermissions.mockRejectedValue(new Error('pq: SSL is not enabled on the server'));
		mockedGetSchemas.mockResolvedValue([] as never);

		const result = (await load(loadEvent())) as unknown as LoadResult;

		expect(JSON.stringify(result.loadGate)).not.toContain('pq:');
		expect(JSON.stringify(result.loadGate)).not.toContain('SSL');
	});

	it('refuses a session without super_admin', async () => {
		session.user = { roles: ['editor'] };
		const event = {
			fetch: vi.fn(),
			cookies: mockCookies(),
		} as never;

		await expect(load(event)).rejects.toMatchObject({ status: 403 });
		expect(mockedListPermissions).not.toHaveBeenCalled();
	});
});

function upsertEvent(fields: Record<string, string | string[]>) {
	const body = new FormData();
	for (const [k, v] of Object.entries(fields)) {
		for (const one of Array.isArray(v) ? v : [v]) body.append(k, one);
	}
	return {
		request: new Request('http://localhost/admin/settings/permissions?/upsert', {
			method: 'POST',
			body,
		}),
		fetch: vi.fn(),
		cookies: mockCookies(),
	} as never;
}

describe('the role ceiling', () => {
	it('takes the ceiling and the count from the plugin', async () => {
		mockedListPermissions.mockResolvedValue([permission] as never);
		mockedGetSchemas.mockResolvedValue([] as never);
		limits.getRoleLimits.mockResolvedValueOnce({ roles: { limit: 7, current: 6 } });
		const result = (await load(loadEvent())) as LoadResult & { roleCap: number; roleCount: number | null };
		expect(result.roleCap).toBe(7);
		expect(result.roleCount).toBe(6);
	});

	it('states no ceiling when the plugin has no limits read, and still lists the rules', async () => {
		mockedListPermissions.mockResolvedValue([permission] as never);
		mockedGetSchemas.mockResolvedValue([] as never);
		limits.getRoleLimits.mockRejectedValueOnce(new Error('not found'));
		const result = (await load(loadEvent())) as LoadResult & { roleCap: number; roleCount: number | null };
		expect(result.roleCap).toBe(0);
		expect(result.roleCount).toBeNull();
		expect(result.loadGate).toBeNull();
		expect(result.permissions).toHaveLength(1);
	});

	it('keeps the ceiling when the rules cannot be read', async () => {
		mockedListPermissions.mockRejectedValue(new Error('down'));
		limits.getRoleLimits.mockResolvedValueOnce({ roles: { limit: 7, current: 7 } });
		const result = (await load(loadEvent())) as LoadResult & { roleCap: number };
		expect(result.roleCap).toBe(7);
		expect(result.loadGate).toBeTruthy();
	});
});

describe('flows as resources', () => {
	it('lists the flows beside the schemas', async () => {
		mockedListPermissions.mockResolvedValue([permission] as never);
		mockedGetSchemas.mockResolvedValue([{ name: 'article' }] as never);
		flows.listAllFlows.mockResolvedValueOnce([{ id: 'f1', slug: 'send-receipt', name: 'Send receipt' }]);
		const result = (await load(loadEvent())) as LoadResult & { flows: { slug: string }[] };
		expect(result.flows.map((f) => f.slug)).toEqual(['send-receipt']);
		expect(result.loadGate).toBeNull();
	});

	it('reads an engine without the flow plugin as no flows, not a failed read', async () => {
		mockedListPermissions.mockResolvedValue([permission] as never);
		mockedGetSchemas.mockResolvedValue([] as never);
		flows.listAllFlows.mockRejectedValueOnce(new ApiError(404, 'not found'));
		const result = (await load(loadEvent())) as LoadResult & { flows: unknown[]; flowsFailed: boolean };
		expect(result.flows).toEqual([]);
		expect(result.flowsFailed).toBe(false);
		expect(result.loadGate).toBeNull();
	});

	it('says the flows could not be read when the list fails for another reason', async () => {
		mockedListPermissions.mockResolvedValue([permission] as never);
		mockedGetSchemas.mockResolvedValue([] as never);
		flows.listAllFlows.mockRejectedValueOnce(new ApiError(500, 'boom'));
		const result = (await load(loadEvent())) as LoadResult & { flows: unknown[]; flowsFailed: boolean };
		expect(result.flows).toEqual([]);
		expect(result.flowsFailed).toBe(true);
		expect(result.loadGate).toBeNull();
	});

	it('refuses activate on a schema before calling the engine', async () => {
		mockedUpsertPermission.mockClear();
		const result = (await actions.upsert(upsertEvent({ role: 'editor', schema_name: 'article', actions: ['read', 'activate'] }))) as { status: number; data: { error: string } };
		expect(result.status).toBe(422);
		expect(result.data.error).toContain('only to flows');
		expect(mockedUpsertPermission).not.toHaveBeenCalled();
	});

	it('writes activate on a flow resource', async () => {
		mockedUpsertPermission.mockResolvedValue(permission as never);
		const result = await actions.upsert(upsertEvent({ role: 'publisher', schema_name: 'flow:send-receipt', actions: ['read', 'activate'] }));
		expect(result).toEqual({ success: true });
		expect(mockedUpsertPermission).toHaveBeenCalledWith(
			{ role: 'publisher', schema_name: 'flow:send-receipt', actions: ['read', 'activate'], field_mask: [] },
			expect.anything(),
		);
	});
});

describe('saving a rule', () => {
	it('writes a wildcard rule with no actions for a new role', async () => {
		mockedUpsertPermission.mockResolvedValue(permission as never);

		const result = await actions.upsert(upsertEvent({ role: 'reviewer', schema_name: '*' }));

		expect(result).toEqual({ success: true });
		expect(mockedUpsertPermission).toHaveBeenCalledWith(
			{ role: 'reviewer', schema_name: '*', actions: [], field_mask: [] },
			expect.anything(),
		);
	});

	it('trims a hand typed role name', async () => {
		// Untrimmed, "editor " is a second role the matrix lists beside the
		// real one and no session ever matches.
		mockedUpsertPermission.mockResolvedValue(permission as never);

		await actions.upsert(upsertEvent({ role: '  reviewer ', schema_name: '*' }));

		expect(mockedUpsertPermission).toHaveBeenCalledWith(
			expect.objectContaining({ role: 'reviewer' }),
			expect.anything(),
		);
	});

	it('rejects a blank role without calling the engine', async () => {
		const result = await actions.upsert(upsertEvent({ role: '   ', schema_name: '*' }));

		expect(result).toMatchObject({ status: 422 });
		expect(mockedUpsertPermission).not.toHaveBeenCalled();
	});
});

describe('refused writes', () => {
	type Failed = { status: number; data: Record<string, unknown> };

	// The plugin's ceiling refusal, as its handler writes it: a 402 whose body
	// names the cap and carries the ceiling and the count.
	it('reads the role ceiling refusal with the numbers the plugin sent', async () => {
		const body = { error: 'cap_exceeded', cap: 'rbac.roles', limit: 3, current: 3, upgrade_url: '' };
		mockedUpsertPermission.mockRejectedValueOnce(new ApiError(402, 'cap_exceeded', body));
		const result = (await actions.upsert(upsertEvent({ role: 'auditor', schema_name: '*', drawer: 'role' }))) as Failed;
		expect(result).toEqual({
			status: 402,
			data: {
				action: 'role',
				roleCapReached: true,
				refused: { kind: 'cap', cap: 'rbac.roles', limit: 3, current: 3, upgradeUrl: '' },
			},
		});
	});

	it('renders a license refusal that is not the role ceiling as a refusal, not as engine text', async () => {
		const refusal = Object.assign(new ApiError(402, 'payment_required'), {
			body: { error: 'payment_required', feature: 'feature:example_feature', plugin: 'permissions' },
		});
		mockedUpsertPermission.mockRejectedValueOnce(refusal);
		const result = (await actions.upsert(upsertEvent({ role: 'editor', schema_name: 'article', drawer: 'rule' }))) as Failed;
		expect(result.status).toBe(402);
		expect(result.data.refused).toMatchObject({ kind: 'feature' });
		expect(result.data.roleCapReached).toBeUndefined();
		expect(result.data.action).toBe('rule');
	});

	it('names the drawer that posted, so the failure shows in that drawer only', async () => {
		mockedUpsertPermission.mockRejectedValueOnce(new ApiError(500, 'pq: boom'));
		const result = (await actions.upsert(upsertEvent({ role: 'reviewer', schema_name: '*', drawer: 'role' }))) as Failed;
		expect(result.data.action).toBe('role');
		expect(result.data.error).toBe('Could not save the rule. Try again.');
	});
});
