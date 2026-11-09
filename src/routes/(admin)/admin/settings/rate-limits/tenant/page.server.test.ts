import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiError } from '@lyeve-labs/client';

const api = vi.hoisted(() => ({
	readTenantGlobal: vi.fn(),
	setTenantGlobal: vi.fn(),
	clearTenantGlobal: vi.fn(),
	listAddressEntries: vi.fn(),
	createAddressEntry: vi.fn(),
	deleteAddressEntry: vi.fn(),
	readRefusalHistory: vi.fn(),
}));

vi.mock('$lib/api/rate-limit', async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	...api,
}));

vi.mock('$lib/server/authz', () => ({
	authedClient: vi.fn(() => ({})),
	requireRole: vi.fn(async () => ({ id: 'u1', roles: ['admin'] })),
}));

import { load, actions } from './+page.server';
import { requireRole } from '$lib/server/authz';

type Loaded = Exclude<Awaited<ReturnType<typeof load>>, void>;

function loadEvent(query = '') {
	return {
		url: new URL(`http://admin/admin/settings/rate-limits/tenant${query}`),
		fetch: vi.fn(),
		cookies: {},
		parent: async () => ({ user: { roles: ['admin'] } }),
	} as never;
}

function formEvent(fields: Record<string, string>) {
	const body = new FormData();
	body.set('confirmed', 'yes');
	for (const [k, v] of Object.entries(fields)) body.set(k, v);
	return {
		request: new Request('http://admin/admin/settings/rate-limits/tenant', { method: 'POST', body }),
		cookies: {},
		fetch: vi.fn(),
	} as never;
}

const paymentRequired = () =>
	new ApiError(402, 'payment_required', { error: 'payment_required', plugin: 'example', feature: 'feature:example_feature' });

beforeEach(() => {
	vi.clearAllMocks();
	api.readTenantGlobal.mockResolvedValue({ licensed: false, tenant_global: null, install_global: null });
	api.listAddressEntries.mockResolvedValue({ licensed: false, limits: { entries: { limit: 500, current: 0 } }, rules: [] });
	api.readRefusalHistory.mockResolvedValue({ hours: 24, minutes: [], total_refused: 0 });
});

describe('tenant rate limits load', () => {
	it('reads the limit and the address lists, and leaves the history to its own page', async () => {
		const result = (await load(loadEvent())) as Loaded;
		expect(result.limit).toMatchObject({ ok: true, value: { licensed: false } });
		expect(result.addresses).toMatchObject({ ok: true, value: { limits: { entries: { limit: 500, current: 0 } } } });
		expect(api.readRefusalHistory).not.toHaveBeenCalled();
	});
});

describe('address list actions', () => {
	it('adds an entry to the list the form names', async () => {
		api.createAddressEntry.mockResolvedValue({});
		const out = await actions.addAddress(formEvent({ cidr: '203.0.113.0/24', list: 'deny', note: 'scraper' }));
		expect(api.createAddressEntry).toHaveBeenCalledWith(expect.anything(), {
			cidr: '203.0.113.0/24',
			list: 'deny',
			note: 'scraper',
		});
		expect(out).toEqual({ savedAddress: '203.0.113.0/24', list: 'deny' });
	});

	it('refuses something that is not an address before the round trip', async () => {
		const out = (await actions.addAddress(formEvent({ cidr: '203.0.113.300', list: 'allow' }))) as { status: number };
		expect(out.status).toBe(400);
		expect(api.createAddressEntry).not.toHaveBeenCalled();
	});

	// Three refusals of a new entry share 409, so the action reads the code
	// the plugin sends beside the sentence and never the sentence itself.
	const conflict = (code: string, message: string) => new ApiError(409, message, { error: message, code });

	it('marks the self-lockout conflict so the page can explain it', async () => {
		api.createAddressEntry.mockRejectedValue(conflict('rate_limit.self_lockout', 'reworded by the plugin'));
		const out = (await actions.addAddress(formEvent({ cidr: '10.0.0.0/8', list: 'deny' }))) as {
			status: number;
			data: { lockout: string };
		};
		expect(out.status).toBe(409);
		expect(out.data.lockout).toBe('10.0.0.0/8');
	});

	it('says the list is full when the tenant holds its ceiling', async () => {
		api.createAddressEntry.mockRejectedValue(conflict('rate_limit.list_full', 'a tenant holds at most 500 address entries'));
		const out = (await actions.addAddress(formEvent({ cidr: '10.0.0.1', list: 'allow' }))) as {
			status: number;
			data: { error: string; listFull?: boolean; lockout?: string };
		};
		expect(out.status).toBe(409);
		expect(out.data.listFull).toBe(true);
		expect(out.data.error).toContain('Remove one before adding another');
		expect(out.data.lockout).toBeUndefined();
	});

	it('names the list a duplicate range is already on', async () => {
		api.createAddressEntry.mockRejectedValue(conflict('rate_limit.duplicate_entry', 'that range is already on the list'));
		const out = (await actions.addAddress(formEvent({ cidr: '10.0.0.1', list: 'deny' }))) as {
			status: number;
			data: { error: string; duplicate?: string };
		};
		expect(out.data.error).toBe('10.0.0.1 is already on the deny list.');
		expect(out.data.duplicate).toBe('10.0.0.1');
	});

	it('relays a conflict without a code as it was sent', async () => {
		api.createAddressEntry.mockRejectedValue(new ApiError(409, 'this entry would refuse the address you are calling from', { error: 'this entry would refuse the address you are calling from', code: 'conflict' }));
		const out = (await actions.addAddress(formEvent({ cidr: '10.0.0.1', list: 'allow' }))) as {
			status: number;
			data: { error: string; lockout?: string };
		};
		expect(out.data.error).toBe('this entry would refuse the address you are calling from');
		expect(out.data.lockout).toBeUndefined();
	});

	it('returns the license refusal on a paid write', async () => {
		api.setTenantGlobal.mockRejectedValue(paymentRequired());
		const out = (await actions.setLimit(formEvent({ rate: '5', burst: '10', enabled: 'true' }))) as {
			status: number;
			data: { refused: { kind: string } };
		};
		expect(out.status).toBe(402);
		expect(out.data.refused.kind).toBe('feature');
	});

	it('clears the tenant limit', async () => {
		api.clearTenantGlobal.mockResolvedValue(undefined);
		expect(await actions.clearLimit(formEvent({}))).toEqual({ clearedLimit: true });
	});
});

describe('removing an address entry', () => {
	it('removes the named entry', async () => {
		api.deleteAddressEntry.mockResolvedValue(undefined);
		expect(await actions.deleteAddress(formEvent({ id: 'a1' }))).toEqual({ removedAddress: 'a1' });
		expect(api.deleteAddressEntry).toHaveBeenCalledWith(expect.anything(), 'a1');
	});

	it('relays the plugin refusal under its action', async () => {
		api.deleteAddressEntry.mockRejectedValue(new ApiError(404, 'entry not found', { error: 'entry not found', code: 'not_found' }));
		expect(await actions.deleteAddress(formEvent({ id: 'a1' }))).toMatchObject({
			status: 400,
			data: { action: 'deleteAddress', error: 'entry not found' },
		});
	});

	it('keeps an outage body off the page', async () => {
		api.deleteAddressEntry.mockRejectedValue(new ApiError(503, 'dial tcp: connection refused'));
		expect(await actions.deleteAddress(formEvent({ id: 'a1' }))).toMatchObject({
			data: { action: 'deleteAddress', error: 'Could not remove the entry. Try again.' },
		});
	});

	it('holds the delete to an admin', async () => {
		vi.mocked(requireRole).mockRejectedValueOnce(Object.assign(new Error('403'), { status: 403 }));
		const e = formEvent({ id: 'a1' });
		await expect(actions.deleteAddress(e)).rejects.toMatchObject({ status: 403 });
		expect(requireRole).toHaveBeenCalledWith(e, ['admin', 'super_admin']);
		expect(api.deleteAddressEntry).not.toHaveBeenCalled();
	});
});
