import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Cookies } from '@sveltejs/kit';
import type { PluginStatusReport } from '@lyeve-labs/client-rest';

const profiler = vi.hoisted(() => ({ listPlugins: vi.fn() }));

vi.mock('#lib/api/profiler.ts', () => profiler);

import { load } from './+page.server';

interface DetailLoadResult {
	pluginName: string;
	plugin: {
		name: string;
		label: string;
		state: string;
		beta: boolean;
		version: string | null;
		startedAt: string | null;
		routes: { method: string; pattern: string; group: string }[];
	} | null;
	traffic: { plugin: string; count: number } | null;
	trafficRead: boolean;
}

const REPORT = {
	compiled: ['search', 'idle'],
	entitled: ['search'],
	plugins: [
		{
			name: 'search',
			compiled: true,
			entitled: true,
			requested: true,
			active: true,
			phase: 'running',
			version: '1.4.0',
			started_at: '2026-10-01T08:00:00Z',
			manifest: { label: 'Search', category: 'content', maturity: 'beta' },
			routes: [
				{ method: 'GET', pattern: '/api/v1/search', group: 'public' },
				{ method: 'POST', pattern: '/api/admin/search/reindex', group: 'admin' },
				{ method: 'GET', pattern: '/api/admin/search/odd', group: 'nobody' },
			],
		},
		{
			name: 'idle',
			compiled: true,
			entitled: false,
			requested: false,
			active: false,
			phase: 'registered',
			started_at: '2026-10-01T08:00:00Z',
			routes: [{ method: 'GET', pattern: '/api/v1/idle', group: 'public' }],
		},
	],
} as unknown as PluginStatusReport;

async function runLoad(name: string, pluginStatus: PluginStatusReport | null, roles = ['admin']): Promise<DetailLoadResult> {
	const event = {
		params: { name },
		fetch: vi.fn() as unknown as typeof globalThis.fetch,
		cookies: { get: vi.fn(() => 'tok') } as unknown as Cookies,
		url: new URL('http://admin.test/admin/plugins/' + name),
		parent: async () => ({ user: { roles }, pluginStatus }),
	} as never;
	return (await load(event)) as unknown as DetailLoadResult;
}

beforeEach(() => {
	vi.clearAllMocks();
	profiler.listPlugins.mockResolvedValue([{ plugin: 'search', count: 42, avg_duration_ns: 1, max_duration_ns: 2, total_alloc_bytes: 3 }]);
});

describe('admin/plugins/[name]/+page.server.ts load', () => {
	it("describes the plugin from the shell's status report", async () => {
		const result = await runLoad('search', REPORT);

		expect(result.plugin).toMatchObject({
			name: 'search',
			label: 'Search',
			state: 'running',
			beta: true,
			version: '1.4.0',
			startedAt: '2026-10-01T08:00:00Z',
		});
	});

	it('lists the routes a running plugin serves, and drops a route in no known group', async () => {
		const result = await runLoad('search', REPORT);

		expect(result.plugin?.routes).toEqual([
			{ method: 'GET', pattern: '/api/v1/search', group: 'public' },
			{ method: 'POST', pattern: '/api/admin/search/reindex', group: 'admin' },
		]);
	});

	it('lists no routes and no start time for a plugin that does not run', async () => {
		const result = await runLoad('idle', REPORT);

		expect(result.plugin).toMatchObject({ state: 'not-enabled', startedAt: null, routes: [] });
	});

	it('says the engine was built without a plugin its report does not carry', async () => {
		expect((await runLoad('media', REPORT)).plugin).toMatchObject({ name: 'media', state: 'not-built' });
	});

	it('says an operator whose status read failed could not be told, rather than describing nothing', async () => {
		const result = (await runLoad('search', null)) as DetailLoadResult & { statusGate: { state: string } | null };
		expect(result.plugin).toBeNull();
		expect(result.statusGate).toMatchObject({ state: 'error' });
	});

	it('tells a reader outside the operator roles the report is not theirs', async () => {
		const result = (await runLoad('search', null, ['editor'])) as DetailLoadResult & { statusGate: { state: string } | null };
		expect(result.statusGate).toEqual({ state: 'forbidden' });
	});

	it('raises no notice when the report was read', async () => {
		const result = (await runLoad('search', REPORT)) as DetailLoadResult & { statusGate: unknown };
		expect(result.statusGate).toBeNull();
	});

	it("reads this plugin's sampled requests for a super admin", async () => {
		const result = await runLoad('search', REPORT, ['super_admin']);

		expect(profiler.listPlugins).toHaveBeenCalledTimes(1);
		expect(result).toMatchObject({ trafficRead: true, traffic: { plugin: 'search', count: 42 } });
	});

	it('tells a plugin the profiler never sampled from a profiler that did not answer', async () => {
		expect(await runLoad('idle', REPORT, ['super_admin'])).toMatchObject({ trafficRead: true, traffic: null });

		profiler.listPlugins.mockRejectedValueOnce(new Error('404'));
		expect(await runLoad('search', REPORT, ['super_admin'])).toMatchObject({ trafficRead: false, traffic: null });
	});

	it('never asks the profiler for anyone but a super admin', async () => {
		const result = await runLoad('search', REPORT, ['admin']);

		expect(profiler.listPlugins).not.toHaveBeenCalled();
		expect(result).toMatchObject({ trafficRead: false, traffic: null });
	});
});
