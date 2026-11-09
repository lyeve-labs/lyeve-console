import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@lyeve-labs/client';

const api = vi.hoisted(() => ({ listPrices: vi.fn() }));

vi.mock('$lib/server/authz', () => ({
	authedClient: vi.fn(() => ({})),
	requireRole: vi.fn(async () => ({ roles: ['admin'] })),
}));
vi.mock('$lib/api/cost', async (orig) => ({
	...(await orig<typeof import('$lib/api/cost')>()),
	...api,
}));

import { load } from './+page.server';

function event(running: string[] = ['multitenant'], roles = ['admin']) {
	return { parent: async () => ({ user: { roles }, plugins: { state: 'named', running, withheld: [] } }) } as never;
}

type Loaded = { enabled: boolean; upgradeUrl: string; prices: unknown };

beforeEach(() => {
	vi.clearAllMocks();
	api.listPrices.mockResolvedValue([]);
});

describe('tenant costs prices load', () => {
	it('reads the prices while the multitenant plugin runs', async () => {
		const data = (await load(event())) as Loaded;
		expect(data.enabled).toBe(true);
		expect(data.prices).toEqual({ ok: true, value: [] });
	});

	it('asks nothing while the multitenant plugin does not run', async () => {
		await load(event([]));
		expect(api.listPrices).not.toHaveBeenCalled();
	});

	it('renders the refusal the ledger answers, with the link it names', async () => {
		api.listPrices.mockRejectedValue(new ApiError(402, 'payment_required', { error: 'payment_required', upgrade_url: '/admin/settings/license' }));
		const data = (await load(event())) as Loaded;
		expect(data.enabled).toBe(false);
		expect(data.upgradeUrl).toBe('/admin/settings/license');
		expect(data.prices).toMatchObject({ ok: false });
	});

	it('keeps a read that failed for another reason apart from a refusal', async () => {
		api.listPrices.mockRejectedValue(new ApiError(503, 'unavailable'));
		const data = (await load(event())) as Loaded;
		expect(data.enabled).toBe(true);
		expect(data.prices).toEqual({ ok: false, gate: { state: 'unavailable' } });
	});

	it('refuses a role below admin', async () => {
		await expect(load(event(['multitenant'], ['editor']))).rejects.toMatchObject({ status: 403 });
	});
});
