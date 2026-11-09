import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@lyeve-labs/client';

const engine = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
const authz = vi.hoisted(() => ({ roles: ['admin'] as string[] }));
vi.mock('$lib/server/authz', async (importOriginal) => ({
	...((await importOriginal()) as object),
	authedClient: vi.fn(() => engine),
	requireRole: vi.fn(async (_event: unknown, allowed: string[]) => {
		if (!allowed.some((r) => authz.roles.includes(r))) throw new Error('403');
		return { id: 'u1', roles: authz.roles };
	}),
}));

import { actions, load } from './+page.server';

type Loaded = Exclude<Awaited<ReturnType<typeof load>>, void>;
type Failure = { status: number; data: Record<string, unknown> };

function loadEvent(query = '') {
	return {
		url: new URL(`http://localhost/admin/observability/errors${query}`),
		parent: async () => ({ plugins: { state: 'named', running: ['error-tracking'], withheld: [] } }),
	} as never;
}

function actionEvent(fields: Record<string, string>) {
	const data = new FormData();
	for (const [k, v] of Object.entries(fields)) data.set(k, v);
	return { request: { formData: async () => data } } as never;
}

function route(map: Record<string, unknown>) {
	engine.get.mockImplementation(async (url: string) => {
		for (const [needle, body] of Object.entries(map)) {
			if (url.includes(needle)) {
				if (body instanceof Error) throw body;
				return body;
			}
		}
		throw new ApiError(404, 'not found', {});
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	authz.roles = ['admin'];
});

describe('the errors load', () => {
	it('asks the plugin for the status the address names', async () => {
		route({ '/alerts': { data: [], limit: 50, offset: 0, total_count: 0 }, '/codes': { data: [] }, '/events': { data: [], total_count: 0, hidden_older: 0 } });
		const out = (await load(loadEvent('?status=resolved'))) as Loaded;
		expect(engine.get.mock.calls.find(([u]) => String(u).includes('/alerts'))?.[0]).toContain('status=resolved');
		expect(out.status).toBe('resolved');
	});

	it('ignores a status the plugin does not know', async () => {
		route({ '/alerts': { data: [], limit: 50, offset: 0, total_count: 0 }, '/codes': { data: [] }, '/events': { data: [] } });
		const out = (await load(loadEvent('?status=closed'))) as Loaded;
		expect(engine.get.mock.calls.find(([u]) => String(u).includes('/alerts'))?.[0]).not.toContain('status=');
		expect(out.status).toBe('');
	});

	// The plugin answers the paged envelope every admin list answers. Reading
	// other names found no rows and no count, and the page said nothing had
	// failed while the plugin held open alerts.
	it('lists the alerts and the count the plugin sends', async () => {
		const sample = {
			id: 'a1',
			fingerprint: 'fp1',
			error_code_id: 'c1',
			source_file: '/app/pay/gateway.go',
			source_line: 42,
			message_sample: 'Gateway timed out',
			error_count: 3,
			first_seen: '2026-10-11T18:36:19Z',
			last_seen: '2026-10-11T18:36:19Z',
			acknowledged: false,
			acknowledged_by: '',
			created_at: '2026-10-11T18:36:19Z',
			status: 'open',
		};
		route({
			'/alerts': { data: [sample, { ...sample, id: 'a2' }], limit: 2, offset: 0, total_count: 3 },
			'/codes': { data: [] },
			'/events': { data: [] },
		});
		const out = (await load(loadEvent('?limit=2'))) as Loaded;
		expect(out.alerts.map((a: { id: string }) => a.id)).toEqual(['a1', 'a2']);
		expect(out.total).toBe(3);
	});

	it('states no count when the plugin sends none', async () => {
		route({ '/alerts': { data: [] }, '/codes': { data: [] }, '/events': { data: [] } });
		const out = (await load(loadEvent())) as Loaded;
		expect(out.alerts).toEqual([]);
		expect(out.total).toBeNull();
	});

	it('carries the count of older events the plugin left out', async () => {
		route({
			'/alerts': { data: [], limit: 50, offset: 0, total_count: 0 },
			'/codes': { data: [] },
			'/events': { data: [{ id: 'e1', ts: '2026-10-01T00:00:00Z', endpoint: '/x', http_status: 500, message: 'boom' }], total_count: 1, hidden_older: 42, window_days: 30 },
		});
		const out = (await load(loadEvent())) as Loaded;
		expect(out.events).toMatchObject({ total: 1, hiddenOlder: 42, windowDays: 30 });
		expect(out.events?.data).toHaveLength(1);
	});

	it('says the events could not be read rather than that there are none', async () => {
		route({ '/alerts': { data: [], limit: 50, offset: 0, total_count: 0 }, '/codes': { data: [] }, '/events': new ApiError(503, 'down', {}) });
		const out = (await load(loadEvent())) as Loaded;
		expect(out.events).toBeNull();
		expect(out.gate.state).toBe('ok');
	});
});

describe('triage', () => {
	it.each(['resolve', 'ignore', 'reopen'] as const)('posts %s to its own route', async (action) => {
		engine.post.mockResolvedValue({ status: 'x' });
		const out = await actions.triage(actionEvent({ id: 'a1', action }));
		expect(engine.post).toHaveBeenCalledWith(`/api/admin/error-tracking/alerts/a1/${action}`, {});
		expect(out).toEqual({ triaged: 'a1', action });
	});

	it('refuses an action the plugin has no route for, without a request', async () => {
		const out = (await actions.triage(actionEvent({ id: 'a1', action: 'delete' }))) as Failure;
		expect(out.status).toBe(400);
		expect(engine.post).not.toHaveBeenCalled();
	});

	it('relays a 404 for an alert that is gone', async () => {
		engine.post.mockRejectedValue(new ApiError(404, 'alert not found', { error: 'alert not found', code: 'not_found' }));
		const out = (await actions.triage(actionEvent({ id: 'a1', action: 'resolve' }))) as Failure;
		expect(out.data.error).toBe('alert not found');
	});
});

describe('assign', () => {
	it('puts the assignee, trimmed', async () => {
		engine.put.mockResolvedValue({ assigned_to: 'ana' });
		await actions.assign(actionEvent({ id: 'a1', assignee: '  ana  ' }));
		expect(engine.put).toHaveBeenCalledWith('/api/admin/error-tracking/alerts/a1/assignee', { assignee: 'ana' });
	});

	it('clears the assignee with an empty one', async () => {
		engine.put.mockResolvedValue({ assigned_to: '' });
		const out = await actions.assign(actionEvent({ id: 'a1', assignee: '' }));
		expect(engine.put.mock.calls[0][1]).toEqual({ assignee: '' });
		expect(out).toEqual({ assigned: 'a1', assignee: '' });
	});
});

describe('the alert pager', () => {
	it('sends an offset past the end back to the last page', async () => {
		route({ '/alerts': { data: [], limit: 50, offset: 500, total_count: 60 }, '/codes': { data: [] }, '/events': { data: [] } });
		await expect(load(loadEvent('?limit=50&offset=500'))).rejects.toMatchObject({
			status: 307,
			location: expect.stringContaining('offset=50'),
		});
	});
});

describe('acknowledging an alert', () => {
	it('acknowledges the alert it names', async () => {
		engine.post.mockResolvedValue({});
		expect(await actions.acknowledge(actionEvent({ id: 'a1' }))).toEqual({ acknowledged: 'a1' });
		expect(engine.post.mock.calls[0][0]).toContain('/alerts/a1/acknowledge');
	});

	it('refuses a role the plugin does not admit', async () => {
		authz.roles = ['editor'];
		await expect(actions.acknowledge(actionEvent({ id: 'a1' }))).rejects.toThrow('403');
		expect(engine.post).not.toHaveBeenCalled();
	});

	it("relays the plugin's refusal", async () => {
		engine.post.mockRejectedValue(new ApiError(404, 'alert not found', { error: 'alert not found', code: 'not_found' }));
		const out = (await actions.acknowledge(actionEvent({ id: 'a1' }))) as Failure;
		expect(out.data.error).toBe('alert not found');
	});

	it('says an outage failed the acknowledgment', async () => {
		engine.post.mockRejectedValue(new ApiError(503, 'down', {}));
		const out = (await actions.acknowledge(actionEvent({ id: 'a1' }))) as Failure;
		expect(out.data.error).toBe('Could not acknowledge the alert. Try again.');
	});
});
