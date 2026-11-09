import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiError } from '@lyeve-labs/client';

const api = vi.hoisted(() => ({ readStatus: vi.fn() }));

vi.mock('$lib/api/rate-limit', async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	...api,
}));

vi.mock('$lib/server/authz', () => ({ authedClient: vi.fn(() => ({})) }));

import { load } from './+page.server';

type Loaded = Exclude<Awaited<ReturnType<typeof load>>, void>;

function loadEvent(roles: string[], running?: string[]) {
	return {
		url: new URL('http://admin/admin/settings/rate-limits/live'),
		fetch: vi.fn(),
		cookies: {},
		parent: async () => ({
			user: { roles },
			plugins: running ? { state: 'named', running, withheld: [] } : undefined,
		}),
	} as never;
}

beforeEach(() => {
	vi.clearAllMocks();
	api.readStatus.mockResolvedValue({ buckets: [], count: 0 });
});

describe('rate-limits live load', () => {
	it('reads the live buckets the status route answers', async () => {
		const bucket = {
			rule_id: 'r1',
			kind: 'custom',
			client_ip: '10.0.0.0',
			endpoint: 'GET /api/x',
			rate: 1,
			burst: 2,
			remaining: 0,
			reset_at: '2026-10-14T00:00:00Z',
		};
		api.readStatus.mockResolvedValue({ buckets: [bucket], count: 1 });
		const result = (await load(loadEvent(['super_admin']))) as Loaded;
		expect(result.status).toEqual({ ok: true, value: [bucket] });
	});

	it('keeps a failed live read as its gate, so a busy engine is not drawn as quiet', async () => {
		api.readStatus.mockRejectedValue(new ApiError(429, 'slow down'));
		const result = (await load(loadEvent(['admin']))) as Loaded;
		expect(result.status).toEqual({ ok: false, gate: { state: 'busy' } });
		expect(result.gate.state).toBe('ok');
	});

	it('asks nothing while the rate limit plugin does not run', async () => {
		const result = (await load(loadEvent(['super_admin'], []))) as Loaded;
		expect(api.readStatus).not.toHaveBeenCalled();
		expect(result.gate.state).toBe('absent');
		expect(result.status.ok).toBe(false);
	});
});
