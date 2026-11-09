import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@lyeve-labs/client';

const api = vi.hoisted(() => ({
	getSummary: vi.fn(),
	getDashboard: vi.fn(),
}));

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

type Loaded = { enabled: boolean; upgradeUrl: string; summary: unknown; dashboard: unknown };

beforeEach(() => {
	vi.clearAllMocks();
	api.getSummary.mockResolvedValue({ total: 1 });
	api.getDashboard.mockResolvedValue({ series: [] });
});

describe('tenant costs load', () => {
	it('reads the ledger while its plugin runs', async () => {
		const data = (await load(event())) as Loaded;
		expect(data.enabled).toBe(true);
		expect(data.summary).toEqual({ ok: true, value: { total: 1 } });
	});

	it('asks nothing while the multitenant plugin does not run', async () => {
		await load(event([]));
		expect(api.getSummary).not.toHaveBeenCalled();
		expect(api.getDashboard).not.toHaveBeenCalled();
	});

	it('renders the refusal the ledger answers rather than predicting it, with the link it names', async () => {
		const refusal = new ApiError(402, 'payment_required', { error: 'payment_required', upgrade_url: '/admin/settings/license' });
		for (const read of Object.values(api)) read.mockRejectedValue(refusal);
		const data = (await load(event())) as Loaded;
		expect(data.enabled).toBe(false);
		expect(data.upgradeUrl).toBe('/admin/settings/license');
		expect(data.summary).toMatchObject({ ok: false });
		expect(data.dashboard).toMatchObject({ ok: false });
	});

	it('keeps a read that failed for another reason apart from a refusal', async () => {
		api.getSummary.mockRejectedValue(new ApiError(503, 'unavailable'));
		const data = (await load(event())) as Loaded;
		expect(data.enabled).toBe(true);
		expect(data.summary).toEqual({ ok: false, gate: { state: 'unavailable' } });
		expect(data.dashboard).toEqual({ ok: true, value: { series: [] } });
	});

	it('refuses a role below admin', async () => {
		await expect(load(event(['multitenant'], ['editor']))).rejects.toMatchObject({ status: 403 });
	});
});
