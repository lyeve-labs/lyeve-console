import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiError } from '@lyeve-labs/client';

const api = vi.hoisted(() => ({
	listAddressEntries: vi.fn(),
	readRefusalHistory: vi.fn(),
}));

vi.mock('$lib/api/rate-limit', async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	...api,
}));

vi.mock('$lib/server/authz', () => ({ authedClient: vi.fn(() => ({})) }));

import { load } from './+page.server';

type Loaded = Exclude<Awaited<ReturnType<typeof load>>, void>;

function loadEvent(query = '', running?: string[]) {
	return {
		url: new URL(`http://admin/admin/settings/rate-limits/tenant/refusals${query}`),
		fetch: vi.fn(),
		cookies: {},
		parent: async () => ({
			user: { roles: ['admin'] },
			plugins: running ? { state: 'named', running, withheld: [] } : undefined,
		}),
	} as never;
}

const paymentRequired = () =>
	new ApiError(402, 'payment_required', { error: 'payment_required', plugin: 'example', feature: 'feature:example_feature' });

beforeEach(() => {
	vi.clearAllMocks();
	api.listAddressEntries.mockResolvedValue({ licensed: false, limits: { entries: { limit: 500, current: 0 } }, rules: [] });
	api.readRefusalHistory.mockResolvedValue({ hours: 24, minutes: [], total_refused: 0 });
});

describe('refusal history load', () => {
	it('reads a day of history by default, beside the address lists that name a deny entry', async () => {
		const result = (await load(loadEvent())) as Loaded;
		expect(result.hours).toBe(24);
		expect(api.readRefusalHistory).toHaveBeenCalledWith(expect.anything(), 24);
		expect(result.history).toMatchObject({ ok: true, value: { total_refused: 0 } });
		expect(result.addresses.ok).toBe(true);
	});

	it('takes the history window from the address and ignores one the plugin would refuse', async () => {
		await load(loadEvent('?hours=168'));
		expect(api.readRefusalHistory).toHaveBeenLastCalledWith(expect.anything(), 168);
		await load(loadEvent('?hours=9999'));
		expect(api.readRefusalHistory).toHaveBeenLastCalledWith(expect.anything(), 24);
	});

	// The history needs the license and the lists do not, so a refused history
	// is shown as locked while the lists still read.
	it('locks the history alone when the plugin refuses it for the license', async () => {
		api.readRefusalHistory.mockRejectedValue(paymentRequired());
		const result = (await load(loadEvent())) as Loaded;
		expect(result.history).toMatchObject({ ok: false, gate: { state: 'locked' } });
		expect(result.addresses.ok).toBe(true);
	});

	it('asks nothing while the rate limit plugin does not run', async () => {
		const result = (await load(loadEvent('', []))) as Loaded;
		expect(result.gate.state).toBe('absent');
		expect(api.readRefusalHistory).not.toHaveBeenCalled();
		expect(api.listAddressEntries).not.toHaveBeenCalled();
	});
});
