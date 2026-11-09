import { describe, expect, it, vi } from 'vitest';
import { ApiError, createClient } from '@lyeve-labs/client';
import {
	approveRequest,
	connectionsGate,
	declineRequest,
	getRequest,
	lifetimesUpTo,
	listConnections,
	personOf,
	revokeAllConnections,
	revokeConnection,
	saveSettings,
	shortLabel,
	showable,
	statusOf,
} from './connected-editors';

function recorder() {
	const calls: { method: string; path: string; body: unknown }[] = [];
	const fetch = vi.fn(async (url: string, init?: RequestInit) => {
		calls.push({ method: init?.method ?? 'GET', path: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
		return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
	});
	return { calls, client: createClient(fetch as unknown as typeof globalThis.fetch) };
}

describe('the connected editors routes', () => {
	it('encodes every part it puts in a path', async () => {
		const { calls, client } = recorder();
		await getRequest(client, 'K7F3/../A2M9');
		await approveRequest(client, 'K7F3 A2M9', { fingerprint: 'AB', lifetime_days: 90, password: 'pw' });
		await declineRequest(client, 'a?b');
		await revokeConnection(client, '1/2');
		expect(calls.map((c) => c.path)).toEqual([
			'/api/admin/builder/connections/requests/K7F3%2F..%2FA2M9',
			'/api/admin/builder/connections/requests/K7F3%20A2M9/approve',
			'/api/admin/builder/connections/requests/a%3Fb/decline',
			'/api/admin/builder/connections/1%2F2/revoke',
		]);
	});

	it('sends the approval with its fingerprint, lifetime and confirmation', async () => {
		const { calls, client } = recorder();
		await approveRequest(client, 'K7F3-A2M9', { fingerprint: 'AB12:CD34', lifetime_days: 30, mfa_code: '123456' });
		expect(calls[0]).toEqual({
			method: 'POST',
			path: '/api/admin/builder/connections/requests/K7F3-A2M9/approve',
			body: { fingerprint: 'AB12:CD34', lifetime_days: 30, mfa_code: '123456' },
		});
	});

	it('pages the list, revokes all and saves only the setting it names', async () => {
		const { calls, client } = recorder();
		await listConnections(client, 50, 100);
		await revokeAllConnections(client);
		await saveSettings(client, { writes_per_minute: 60 });
		expect(calls).toEqual([
			{ method: 'GET', path: '/api/admin/builder/connections?limit=50&offset=100', body: undefined },
			{ method: 'POST', path: '/api/admin/builder/connections/revoke-all', body: {} },
			{ method: 'PUT', path: '/api/admin/builder/settings', body: { writes_per_minute: 60 } },
		]);
	});
});

describe('connectionsGate', () => {
	it('says the read failed in its own words', () => {
		expect(connectionsGate(new ApiError(500, 'boom'))).toEqual({
			state: 'error',
			message: 'Could not load builder connections.',
		});
	});

	it('reads each refusal as the gate it stands for', () => {
		expect(connectionsGate(new ApiError(404, 'x'))).toEqual({ state: 'absent' });
		expect(connectionsGate(new ApiError(403, 'x', { code: 'permission_denied' }))).toEqual({ state: 'forbidden' });
		expect(connectionsGate(new ApiError(429, 'x'))).toEqual({ state: 'busy' });
		expect(connectionsGate(new ApiError(503, 'x', { code: 'store_unavailable' }))).toEqual({ state: 'unavailable' });
	});

	it('tells a tenant the plugin was withheld from apart from a role refusal', () => {
		expect(connectionsGate(new ApiError(403, 'x', { code: 'TENANT_FEATURE_WITHHELD' }))).toEqual({ state: 'withheld' });
	});
});

describe('what the page shows', () => {
	it('never offers the builder or engine schemas', () => {
		expect(showable(['posts', 'lyeve_builder_pages', 'sys_users', 'products'])).toEqual(['posts', 'products']);
	});

	it('offers only the lifetimes the tenant allows', () => {
		expect(lifetimesUpTo(90)).toEqual([30, 90]);
		expect(lifetimesUpTo(180)).toEqual([30, 90, 180]);
	});

	it('cuts a long name at 60 characters', () => {
		expect(shortLabel('a'.repeat(80))).toHaveLength(60);
		expect(shortLabel('Maria laptop')).toBe('Maria laptop');
	});

	it('names each status in a word', () => {
		expect(statusOf('approved').label).toBe('Active');
		expect(statusOf('expired').label).toBe('Expired');
		expect(statusOf('revoked').label).toBe('Revoked');
	});

	it('names a person whose account is gone', () => {
		expect(personOf({ approver_email: '' })).toBe('Removed person');
		expect(personOf({ approver_email: 'tom@example.com' })).toBe('tom@example.com');
	});
});
