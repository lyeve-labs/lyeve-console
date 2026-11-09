import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@lyeve-labs/client';

const api = vi.hoisted(() => ({ getRules: vi.fn(), listAccessLog: vi.fn() }));

vi.mock('$lib/api/pii-mask', async (importOriginal) => ({
	...((await importOriginal()) as object),
	...api,
}));

vi.mock('$lib/server/authz', () => ({ authedClient: vi.fn(() => ({})) }));

import { load } from './+page.server';

function loadEvent(query = '', plugins: unknown = null) {
	return {
		url: new URL(`http://admin.test/admin/settings/pii/reads${query}`),
		parent: async () => ({ plugins }),
	} as never;
}

const ENTRY = { id: 'a1', viewer_role: 'admin', pii_type: 'email', record_type: 'user', accessed_at: '2026-09-22T10:00:00Z' };

beforeEach(() => vi.clearAllMocks());

describe('pii reads load', () => {
	it('reads one page of the access log and nothing of the rules', async () => {
		api.listAccessLog.mockResolvedValue({ data: [ENTRY], total_count: 1 });
		expect(await load(loadEvent())).toEqual({ entries: [ENTRY], total: 1, limit: 50, offset: 0, gate: { state: 'ok' } });
		expect(api.listAccessLog).toHaveBeenCalledWith(expect.anything(), 50, 0);
		expect(api.getRules).not.toHaveBeenCalled();
	});

	it('sends an access log page past the end back to the last page', async () => {
		api.listAccessLog.mockResolvedValue({ data: [], total_count: 70 });
		await expect(load(loadEvent('?offset=300'))).rejects.toMatchObject({
			status: 307,
			location: '/admin/settings/pii/reads?offset=50',
		});
	});

	it('makes no engine call while the plugin does not run', async () => {
		const out = await load(loadEvent('', { state: 'named', running: [], withheld: [] }));
		expect(out).toMatchObject({ gate: { state: 'absent' }, entries: [] });
		expect(api.listAccessLog).not.toHaveBeenCalled();
	});

	// A failed log is never drawn as nobody having read anything.
	it('turns a failed log into its gate, and says masking still runs', async () => {
		api.listAccessLog.mockRejectedValue(new ApiError(500, 'boom'));
		expect(await load(loadEvent())).toMatchObject({
			entries: [],
			gate: { state: 'error', message: 'Could not load the unmasked reads. Masking is still running.' },
		});
	});
});
