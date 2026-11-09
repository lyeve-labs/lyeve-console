import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@lyeve-labs/client';

const engine = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('$lib/server/authz', async (importOriginal) => ({
	...((await importOriginal()) as object),
	authedClient: vi.fn(() => engine),
	requireRole: vi.fn(async () => ({ id: 'u1', roles: ['admin'] })),
}));

import { assertRole, requireRole } from '$lib/server/authz';
import { actions, load } from './+page.server';

const ID = 'eec2c34c-da5e-47fc-a666-e8c7be1455eb';

function loadEvent() {
	return {
		params: { id: ID },
		url: new URL(`http://localhost/admin/experiments/${ID}`),
		parent: async () => ({ plugins: { state: 'named', running: ['ab-testing'], withheld: [] } }),
	} as never;
}

const experiment = {
	id: ID,
	tenant_id: 'default',
	name: 'signup-button',
	description: '',
	status: 'running',
	traffic_split: {},
	auto_stop_enabled: true,
	significance_threshold: 0.95,
	min_sample_size: 500,
	created_at: '2026-10-11T18:36:53Z',
	updated_at: '2026-10-11T18:36:53Z',
};

const variant = (id: string, name: string) => ({
	id,
	experiment_id: ID,
	name,
	config: '',
	traffic_percentage: 50,
	is_control: name === 'control',
	created_at: '2026-10-11T18:36:53Z',
});

const metric = { id: 'm1', experiment_id: ID, name: 'Signed up', event_name: 'signup', metric_type: 'conversion', created_at: '2026-10-11T18:36:53Z' };

function route(map: Record<string, unknown>) {
	engine.get.mockImplementation(async (url: string) => {
		const path = String(url).split('?')[0] ?? '';
		for (const [suffix, body] of Object.entries(map)) {
			if (path.endsWith(suffix)) {
				if (body instanceof Error) throw body;
				return body;
			}
		}
		throw new ApiError(404, 'not found', {});
	});
}

beforeEach(() => vi.clearAllMocks());

describe('the experiment load', () => {
	// The plugin answers both panels as paged lists. The page read them as
	// bare arrays, handed an object to every loop on the page, and answered
	// 500 for every experiment.
	it('reads variants and metrics out of the paged answer', async () => {
		route({
			'/variants': { data: [variant('v1', 'control'), variant('v2', 'green')], limit: 500, offset: 0, total_count: 2 },
			'/metrics': { data: [metric], limit: 500, offset: 0, total_count: 1 },
			'/results': { experiment_id: ID, status: 'running', variants: [], significant: false, sample_sizes: {} },
			[`/experiments/${ID}`]: experiment,
		});

		const out = (await load(loadEvent())) as Record<string, unknown>;

		expect(out.variants).toEqual({ ok: true, value: [variant('v1', 'control'), variant('v2', 'green')] });
		expect(out.metrics).toEqual({ ok: true, value: [metric] });
	});

	it('asks for every variant and metric in one page', async () => {
		route({
			'/variants': { data: [], total_count: 0 },
			'/metrics': { data: [], total_count: 0 },
			'/results': new ApiError(404, 'none', {}),
			[`/experiments/${ID}`]: experiment,
		});

		await load(loadEvent());

		const asked = engine.get.mock.calls.map(([u]) => String(u));
		expect(asked.find((u) => u.includes('/variants'))).toContain('limit=500');
		expect(asked.find((u) => u.includes('/metrics'))).toContain('limit=500');
	});

	it('keeps the page when one panel cannot be read', async () => {
		route({
			'/variants': new ApiError(503, 'down', {}),
			'/metrics': { data: [metric], total_count: 1 },
			'/results': new ApiError(503, 'down', {}),
			[`/experiments/${ID}`]: experiment,
		});

		const out = (await load(loadEvent())) as Record<string, unknown>;

		expect(out.variants).toEqual({ ok: false, gate: { state: 'unavailable' } });
		expect(out.metrics).toEqual({ ok: true, value: [metric] });
		expect(out.results).toEqual({ ok: false, gate: { state: 'unavailable' } });
	});

	it.each([
		[403, 403],
		[402, 402],
		[404, 404],
		[429, 429],
		[503, 503],
	])('answers an experiment read refused with %i as %i', async (engineStatus, pageStatus) => {
		route({ [`/experiments/${ID}`]: new ApiError(engineStatus, 'refused', {}) });

		await expect(load(loadEvent())).rejects.toMatchObject({ status: pageStatus });
	});
});

function actionEvent(form: Record<string, string>) {
	const data = new FormData();
	data.set('confirmed', 'yes');
	for (const [k, v] of Object.entries(form)) data.set(k, v);
	return { params: { id: ID }, request: { formData: async () => data, clone: () => ({ formData: async () => data }) } } as never;
}

const EXP = `/api/admin/ab/experiments/${ID}`;

interface WriteCase {
	name: 'addVariant' | 'removeVariant' | 'addMetric' | 'removeMetric';
	form: Record<string, string>;
	call: 'post' | 'delete';
	url: string;
	done: Record<string, string>;
}

// Each write is tagged with its action, so the drawer that sent it is the
// one that shows its failure.
describe.each<WriteCase>([
	{
		name: 'addVariant',
		form: { name: 'treatment', traffic_percentage: '50' },
		call: 'post',
		url: `${EXP}/variants`,
		done: { saved: 'treatment' },
	},
	{ name: 'removeVariant', form: { vid: 'v2' }, call: 'delete', url: `${EXP}/variants/v2`, done: { removed: 'v2' } },
	{
		name: 'addMetric',
		form: { name: 'Signed up', event_name: 'signup', metric_type: 'conversion' },
		call: 'post',
		url: `${EXP}/metrics`,
		done: { saved: 'Signed up' },
	},
	{ name: 'removeMetric', form: { mid: 'm1' }, call: 'delete', url: `${EXP}/metrics/m1`, done: { removed: 'm1' } },
])('the $name action', ({ name, form, call, url, done }) => {
	const run = (f: Record<string, string>) => actions[name](actionEvent(f));

	it('writes to the plugin and answers what it did', async () => {
		engine[call].mockResolvedValue({});
		expect(await run(form)).toEqual(done);
		expect(engine[call].mock.calls[0][0]).toBe(url);
	});

	it('relays the reason the plugin refused with, tagged with the action', async () => {
		engine[call].mockRejectedValue(new ApiError(409, 'the experiment is running', { error: 'the experiment is running', code: 'conflict' }));
		expect(await run(form)).toMatchObject({ status: 400, data: { action: name, error: 'the experiment is running' } });
	});

	it('keeps driver text out of a write that meets an outage', async () => {
		engine[call].mockRejectedValue(new ApiError(503, 'pq: connection refused'));
		const out = (await run(form)) as { data: { action: string; error: string } };
		expect(out.data.action).toBe(name);
		expect(out.data.error).not.toContain('pq:');
	});

	it('refuses an editor before calling the plugin', async () => {
		vi.mocked(requireRole).mockImplementationOnce(async (_event, roles) => assertRole({ id: 'u2', roles: ['editor'] } as never, roles));
		await expect(run(form)).rejects.toMatchObject({ status: 403 });
		expect(engine[call]).not.toHaveBeenCalled();
	});
});
