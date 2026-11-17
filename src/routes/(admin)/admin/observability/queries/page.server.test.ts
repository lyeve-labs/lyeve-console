import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@lyeve-labs/client';

const engine = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('#lib/server/authz.ts', async (importOriginal) => ({
	...((await importOriginal()) as object),
	authedClient: vi.fn(() => engine),
}));

import { load } from './+page.server';

type Loaded = Exclude<Awaited<ReturnType<typeof load>>, void>;

function loadEvent(query = '') {
	return {
		url: new URL(`http://localhost/admin/observability/queries${query}`),
		parent: async () => ({
			user: { roles: ['super_admin'] },
			plugins: { state: 'named', running: ['query-monitor'], withheld: [] },
		}),
	} as never;
}

beforeEach(() => vi.clearAllMocks());

describe('the slow queries load', () => {
	it('names the capture store only when the plugin says its table did not answer', async () => {
		engine.get.mockRejectedValue(new ApiError(503, 'failed to load query log', { error: 'failed to load query log' }));
		const out = (await load(loadEvent())) as Loaded;
		expect(out.gate).toEqual({ state: 'capture_store' });
	});

	it('reads any other 503 as an outage', async () => {
		engine.get.mockRejectedValue(new ApiError(503, 'database unreachable', { error: 'database unreachable' }));
		const out = (await load(loadEvent())) as Loaded;
		expect(out.gate).toEqual({ state: 'unavailable' });
	});

	it('reads a read that never reached the engine as an outage', async () => {
		engine.get.mockRejectedValue(new TypeError('fetch failed'));
		const out = (await load(loadEvent())) as Loaded;
		expect(out.gate).toEqual({ state: 'unavailable' });
	});

	it('sends an offset past the end back to the last page', async () => {
		engine.get.mockResolvedValue({ data: [], total_count: 60 });
		await expect(load(loadEvent('?limit=50&offset=500'))).rejects.toMatchObject({
			status: 307,
			location: expect.stringContaining('offset=50'),
		});
	});

	it('sends the search to the engine and back to the page', async () => {
		engine.get.mockResolvedValue({ data: [], total_count: 0 });
		const out = (await load(loadEvent('?q=sys_content'))) as Loaded;
		const asked = new URL(String(engine.get.mock.calls[0][0]), 'http://e');
		expect(asked.searchParams.get('q')).toBe('sys_content');
		expect(out.q).toBe('sys_content');
	});

	it('does not send a search the engine would refuse', async () => {
		engine.get.mockResolvedValue({ data: [], total_count: 0 });
		const out = (await load(loadEvent(`?q=${'a'.repeat(201)}`))) as Loaded;
		expect(String(engine.get.mock.calls[0][0])).not.toContain('q=');
		expect(out.q).toBe('');
	});
});
