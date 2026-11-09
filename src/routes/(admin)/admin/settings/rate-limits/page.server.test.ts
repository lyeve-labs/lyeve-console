import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiError } from '@lyeve-labs/client';

const api = vi.hoisted(() => ({
	listRules: vi.fn(),
	readOverview: vi.fn(),
	createRule: vi.fn(),
	updateRule: vi.fn(),
	deleteRule: vi.fn(),
	updateGlobal: vi.fn(),
	setProtection: vi.fn(),
	resetProtection: vi.fn(),
}));

vi.mock('$lib/api/rate-limit', async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	...api,
}));

const authz = vi.hoisted(() => ({
	roles: ['super_admin'] as string[],
	requireRole: vi.fn(),
}));

vi.mock('$lib/server/authz', () => ({
	authedClient: vi.fn(() => ({})),
	requireRole: authz.requireRole,
}));

import { load, actions } from './+page.server';

function formEvent(fields: Record<string, string>) {
	const body = new FormData();
	body.set('confirmed', 'yes');
	for (const [k, v] of Object.entries(fields)) body.set(k, v);
	return {
		request: new Request('http://admin/settings/rate-limits', { method: 'POST', body }),
		cookies: {},
		fetch: vi.fn(),
	} as never;
}

function loadEvent(roles: string[], search = '') {
	return {
		url: new URL(`http://admin/admin/settings/rate-limits${search}`),
		fetch: vi.fn(),
		cookies: {},
		parent: async () => ({ entitlements: { features: ['rate-limit'] }, user: { roles } }),
	} as never;
}

const overview = {
	custom_licensed: false,
	global: null,
	protections: [],
	engine: [],
};

beforeEach(() => {
	vi.clearAllMocks();
	authz.roles = ['super_admin'];
	authz.requireRole.mockImplementation(async (_event: unknown, allowed: string[]) => {
		if (!allowed.some((r) => authz.roles.includes(r))) throw new Error('403');
		return { id: 'u1', roles: authz.roles };
	});
	api.listRules.mockResolvedValue({ data: [], total: 0 });
	api.readOverview.mockResolvedValue(overview);
});

describe('rate-limits load', () => {
	it('lists only custom rules and carries the capability flag from the engine', async () => {
		const result = (await load(loadEvent(['admin']))) as Record<string, unknown>;
		expect(api.listRules).toHaveBeenCalledWith(expect.anything(), 51, 0, 'custom');
		expect(result.overview).toEqual(overview);
		expect(result.superAdmin).toBe(false);
	});

	it('sends an offset past the last rule back to the last page that holds one', async () => {
		api.listRules.mockResolvedValue({ data: [], total: 60 });
		await expect(load(loadEvent(['admin'], '?limit=50&offset=200'))).rejects.toMatchObject({
			status: 307,
			location: '/admin/settings/rate-limits?limit=50&offset=50',
		});
	});

	it('leaves a failed read alone rather than redirecting it', async () => {
		api.listRules.mockRejectedValue(new Error('down'));
		const result = (await load(loadEvent(['admin'], '?offset=200'))) as { gate: { state: string } };
		expect(result.gate.state).toBe('error');
	});

	it('reports an unread overview as unknown, not as locked', async () => {
		api.readOverview.mockRejectedValue(new Error('down'));
		const result = (await load(loadEvent(['super_admin']))) as Record<string, unknown>;
		expect(result.overview).toBeNull();
		expect(result.superAdmin).toBe(true);
	});
});

describe('rate-limits actions', () => {
	it('refuses a rate or burst of zero, which the engine refuses too', async () => {
		const zeroRate = await actions.create(
			formEvent({ endpoint: 'GET /api/x', rate: '0', burst: '5', enabled: 'true' }),
		);
		expect(zeroRate).toMatchObject({ status: 400 });
		const zeroBurst = await actions.create(
			formEvent({ endpoint: 'GET /api/x', rate: '1', burst: '0', enabled: 'true' }),
		);
		expect(zeroBurst).toMatchObject({ status: 400 });
		expect(api.createRule).not.toHaveBeenCalled();
	});

	it('sends the role and key, and the tenant only for a super admin', async () => {
		await actions.create(
			formEvent({
				endpoint: 'GET /api/content/{schema}',
				rate: '2',
				burst: '4',
				enabled: 'true',
				role: 'editor',
				key_by: 'user',
				tenant_id: 'acme',
			}),
		);
		expect(api.createRule).toHaveBeenLastCalledWith(expect.anything(), {
			endpoint: 'GET /api/content/{schema}',
			rate: 2,
			burst: 4,
			enabled: true,
			role: 'editor',
			key_by: 'user',
			tenant_id: 'acme',
		});

		authz.roles = ['admin'];
		await actions.create(
			formEvent({ endpoint: 'GET /api/x', rate: '1', burst: '1', enabled: 'true', tenant_id: 'other' }),
		);
		const body = api.createRule.mock.calls.at(-1)?.[1] as Record<string, unknown>;
		expect(body).not.toHaveProperty('tenant_id');
	});

	it('clears a role on edit with an empty string and leaves the tenant as stored', async () => {
		await actions.update(
			formEvent({ id: 'r1', endpoint: 'GET /api/x', rate: '1', burst: '1', enabled: 'true', role: '', tenant_id: '' }),
		);
		const body = api.updateRule.mock.calls.at(-1)?.[2] as Record<string, unknown>;
		expect(body.role).toBe('');
		expect(body).not.toHaveProperty('tenant_id');
	});

	it('moves a rule to the tenant named on edit', async () => {
		await actions.update(
			formEvent({ id: 'r1', endpoint: 'GET /api/x', rate: '1', burst: '1', enabled: 'true', tenant_id: ' beta ' }),
		);
		const body = api.updateRule.mock.calls.at(-1)?.[2] as Record<string, unknown>;
		expect(body.tenant_id).toBe('beta');
	});

	it('never sends a tenant on edit for an admin', async () => {
		authz.roles = ['admin'];
		await actions.update(
			formEvent({ id: 'r1', endpoint: 'GET /api/x', rate: '1', burst: '1', enabled: 'true', tenant_id: 'beta' }),
		);
		const body = api.updateRule.mock.calls.at(-1)?.[2] as Record<string, unknown>;
		expect(body).not.toHaveProperty('tenant_id');
	});

	it('keeps the global limit and the protections for a super admin', async () => {
		authz.roles = ['admin'];
		await expect(
			actions.global(formEvent({ rate: '1', burst: '1', enabled: 'true' })),
		).rejects.toThrow('403');
		await expect(
			actions.protection(formEvent({ name: 'mfa.verify', requests: '5', window_minutes: '5' })),
		).rejects.toThrow('403');
		expect(api.updateGlobal).not.toHaveBeenCalled();
		expect(api.setProtection).not.toHaveBeenCalled();
	});

	it('refuses a protection of zero requests and converts minutes to seconds', async () => {
		const zero = await actions.protection(
			formEvent({ name: 'mfa.verify', requests: '0', window_minutes: '5' }),
		);
		expect(zero).toMatchObject({ status: 400 });

		await actions.protection(formEvent({ name: 'mfa.verify', requests: '7', window_minutes: '10' }));
		expect(api.setProtection).toHaveBeenCalledWith(expect.anything(), {
			name: 'mfa.verify',
			requests: 7,
			window_seconds: 600,
		});
	});
});

describe('rate-limits rule edits, deletes and protection resets', () => {
	const RULE = { id: 'r1', endpoint: 'GET /api/x', rate: '1', burst: '2', enabled: 'true', role: 'editor' };
	const outage = new ApiError(503, 'dial tcp 10.0.0.4:5432: connection refused');

	it('saves, deletes and resets the named item', async () => {
		api.updateRule.mockResolvedValue({});
		api.deleteRule.mockResolvedValue(undefined);
		api.resetProtection.mockResolvedValue(undefined);
		expect(await actions.update(formEvent(RULE))).toEqual({ saved: 'GET /api/x' });
		expect(api.updateRule).toHaveBeenCalledWith(expect.anything(), 'r1', expect.objectContaining({ role: 'editor' }));
		expect(await actions.delete(formEvent({ id: 'r1' }))).toEqual({ removed: 'r1' });
		expect(api.deleteRule).toHaveBeenCalledWith(expect.anything(), 'r1');
		expect(await actions.resetProtection(formEvent({ name: 'mfa.verify' }))).toEqual({ resetProtection: 'mfa.verify' });
		expect(api.resetProtection).toHaveBeenCalledWith(expect.anything(), 'mfa.verify');
	});

	it('relays the plugin refusal under the action that met it', async () => {
		api.updateRule.mockRejectedValue(new ApiError(409, 'a built-in rule is changed through its own route', { error: 'a built-in rule is changed through its own route', code: 'conflict' }));
		api.deleteRule.mockRejectedValue(new ApiError(404, 'rate-limit rule not found', { error: 'rate-limit rule not found', code: 'not_found' }));
		api.resetProtection.mockRejectedValue(new ApiError(400, 'unknown protection', { error: 'unknown protection', code: 'bad_request' }));
		expect(await actions.update(formEvent(RULE))).toMatchObject({
			status: 400,
			data: { action: 'rule', error: 'a built-in rule is changed through its own route' },
		});
		expect(await actions.delete(formEvent({ id: 'r1' }))).toMatchObject({ data: { action: 'delete', error: 'rate-limit rule not found' } });
		expect(await actions.resetProtection(formEvent({ name: 'x' }))).toMatchObject({
			data: { action: 'resetProtection', error: 'unknown protection' },
		});
	});

	it('keeps an outage body off the page', async () => {
		api.updateRule.mockRejectedValue(outage);
		api.deleteRule.mockRejectedValue(outage);
		api.resetProtection.mockRejectedValue(outage);
		expect(await actions.update(formEvent(RULE))).toMatchObject({ data: { error: 'Could not save the rule. Try again.' } });
		expect(await actions.delete(formEvent({ id: 'r1' }))).toMatchObject({ data: { error: 'Could not delete the rule. Try again.' } });
		expect(await actions.resetProtection(formEvent({ name: 'x' }))).toMatchObject({ data: { error: 'Could not reset the protection. Try again.' } });
	});

	it('holds a rule edit and delete to an admin and a protection reset to a super admin', async () => {
		authz.roles = ['editor'];
		await expect(actions.update(formEvent(RULE))).rejects.toThrow('403');
		await expect(actions.delete(formEvent({ id: 'r1' }))).rejects.toThrow('403');
		authz.roles = ['admin'];
		await expect(actions.resetProtection(formEvent({ name: 'mfa.verify' }))).rejects.toThrow('403');
		expect(api.updateRule).not.toHaveBeenCalled();
		expect(api.deleteRule).not.toHaveBeenCalled();
		expect(api.resetProtection).not.toHaveBeenCalled();
	});
});
