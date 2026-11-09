import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiError } from '@lyeve-labs/client';

const api = vi.hoisted(() => ({
	readProviderWindow: vi.fn(),
	saveProviderWindow: vi.fn(),
}));

vi.mock('$lib/api/provider-window', async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	...api,
}));

const authz = vi.hoisted(() => ({
	authedClient: vi.fn(() => ({})),
	requireRole: vi.fn(async () => ({ id: 'u1', roles: ['admin'] })),
}));
vi.mock('$lib/server/authz', () => authz);

import { load, actions } from './+page.server';

type Loaded = Exclude<Awaited<ReturnType<typeof load>>, void>;
type Failed = { status: number; data: { error: string; days?: string } };

function loadEvent() {
	return {
		url: new URL('http://admin/admin/settings/sign-in'),
		fetch: vi.fn(),
		cookies: {},
		parent: async () => ({ user: { roles: ['admin'] } }),
	} as never;
}

function formEvent(fields: Record<string, string>) {
	const body = new FormData();
	for (const [k, v] of Object.entries(fields)) body.set(k, v);
	return {
		request: new Request('http://admin/admin/settings/sign-in', { method: 'POST', body }),
		cookies: {},
		fetch: vi.fn(),
	} as never;
}

beforeEach(() => vi.clearAllMocks());

describe('sign-in window load', () => {
	it('carries the window the engine read', async () => {
		api.readProviderWindow.mockResolvedValue({ days: 30 });
		const result = (await load(loadEvent())) as Loaded;
		expect(result.gate).toEqual({ state: 'ok' });
		expect(result.window).toEqual({ days: 30 });
	});

	it('reports an engine without the route as absent', async () => {
		api.readProviderWindow.mockRejectedValue(new ApiError(404, 'not found'));
		const result = (await load(loadEvent())) as Loaded;
		expect(result.gate.state).toBe('absent');
		expect(result.window).toBeNull();
	});

	it('reports a role the engine refuses as forbidden', async () => {
		api.readProviderWindow.mockRejectedValue(new ApiError(403, 'forbidden'));
		const result = (await load(loadEvent())) as Loaded;
		expect(result.gate.state).toBe('forbidden');
	});

	it('reports a failed read as a failure, never as a default', async () => {
		api.readProviderWindow.mockRejectedValue(new Error('down'));
		const result = (await load(loadEvent())) as Loaded;
		expect(result.gate.state).toBe('error');
		expect(result.window).toBeNull();
	});
});

describe('sign-in window save', () => {
	it.each(['0', '30', '365'])('saves %s days', async (days) => {
		api.saveProviderWindow.mockResolvedValue({ days: Number(days) });
		const result = await actions.save(formEvent({ days }));
		expect(api.saveProviderWindow).toHaveBeenCalledWith({}, Number(days));
		expect(result).toEqual({ saved: true, days });
	});

	it('asks for an admin before it writes', async () => {
		api.saveProviderWindow.mockResolvedValue({ days: 7 });
		await actions.save(formEvent({ days: '7' }));
		expect(authz.requireRole).toHaveBeenCalledWith(expect.anything(), ['admin', 'super_admin']);
	});

	it.each(['-1', '366', '1.5', '', 'thirty', '1e2'])('refuses %j before the engine sees it', async (days) => {
		const result = (await actions.save(formEvent({ days }))) as unknown as Failed;
		expect(result.status).toBe(400);
		expect(result.data.error).toBe('Enter a whole number of days from 0 to 365.');
		expect(result.data.days).toBe(days);
		expect(api.saveProviderWindow).not.toHaveBeenCalled();
	});

	it('relays a refusal the engine states', async () => {
		api.saveProviderWindow.mockRejectedValue(new ApiError(422, 'days must be a whole number from 0 to 365', { error: 'days must be a whole number from 0 to 365', code: 'http_422' }));
		const result = (await actions.save(formEvent({ days: '12' }))) as unknown as Failed;
		expect(result.status).toBe(400);
		expect(result.data.error).toBe('days must be a whole number from 0 to 365');
	});

	it('reports an outage without the engine detail', async () => {
		api.saveProviderWindow.mockRejectedValue(new ApiError(503, 'dial tcp 10.0.0.4:5432: connection refused'));
		const result = (await actions.save(formEvent({ days: '12' }))) as unknown as Failed;
		expect(result.data.error).toBe('Could not save the sign-in window. Try again.');
	});
});
