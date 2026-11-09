import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Cookies } from '@sveltejs/kit';

// Only the role check is faked. authedHeaders runs for real, because the
// header it builds is the subject of the two cases below: a write that reaches
// the engine without X-CSRF-Token is refused 403, and a stub that returns a
// fixed bag would pass whether the action spread it or not.
const session = vi.hoisted(() => ({ user: { roles: ['super_admin'] } as { roles: string[] } }));
vi.mock('$lib/server/authz', async (importOriginal) => ({
	...((await importOriginal()) as object),
	requireRole: vi.fn(async () => ({ id: 'u1', role: 'super_admin' })),
	loadUser: vi.fn(async () => session.user),
}));

const engine = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@lyeve-labs/client', async (importOriginal) => ({
	...((await importOriginal()) as object),
	createClient: vi.fn(() => engine),
}));

import { actions, load } from './+page.server';
import { endpointQuery, readFilter } from '$lib/server/audit-filter';

function mockCookies(initial: Record<string, string> = {}): Cookies {
	return {
		get: vi.fn((name: string) => initial[name] ?? undefined),
		set: vi.fn(),
		delete: vi.fn(),
		getAll: vi.fn(() => []),
		serialize: vi.fn(() => ''),
	} as unknown as Cookies;
}

// The prune action is the only write on this module. The two exports are
// endpoints under src/routes/api/, because a download cannot be a form
// action, and they are covered beside the proxy they share.
describe('audit-log prune posts to a prefix the engine mounts', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('posts to /api/admin/audit-log/prune carrying the CSRF token', async () => {
		const fetch = vi.fn(async (_url: string, _init?: RequestInit) =>
			new Response('{}', { status: 200 })
		);
		const cookies = mockCookies({ '__Host-sys_session': 'tok', '__Host-csrf': 'csrf-tok' });
		const form = new FormData();
		form.set('older_than', '2026-01-01');

		// A successful prune ends in redirect(), which SvelteKit raises rather
		// than returns. Swallowing it is the only way to reach the assertions.
		try {
			await actions.prune({
				fetch,
				cookies,
				request: { formData: async () => form },
			} as never);
		} catch (thrown) {
			if ((thrown as { status?: number })?.status !== 303) throw thrown;
		}

		expect(fetch).toHaveBeenCalledOnce();
		expect(fetch.mock.calls[0][0]).toBe('/api/admin/audit-log/prune');
		const headers = fetch.mock.calls[0][1]?.headers as Record<string, string>;
		expect(headers.Authorization).toBe('Bearer tok');
		expect(headers['X-CSRF-Token']).toBe('csrf-tok');
	});

	it('relays the reason the plugin gives for a refused prune', async () => {
		const fetch = vi.fn(async () =>
			new Response(JSON.stringify({ error: 'older_than must not be later than now', code: 'bad_request' }), {
				status: 400,
				headers: { 'content-type': 'application/json' },
			}),
		);
		const form = new FormData();
		form.set('older_than', '2099-01-01');
		const out = (await actions.prune({
			fetch,
			cookies: mockCookies({ '__Host-sys_session': 'tok' }),
			request: { formData: async () => form },
		} as never)) as { status: number; data: { error: string } };
		expect(out.status).toBe(400);
		expect(out.data.error).toBe('older_than must not be later than now');
	});

	it('keeps an outage body off the page', async () => {
		const fetch = vi.fn(async () => new Response(JSON.stringify({ error: 'dial tcp: refused' }), { status: 503 }));
		const form = new FormData();
		form.set('older_than', '2026-01-01');
		const out = (await actions.prune({
			fetch,
			cookies: mockCookies({ '__Host-sys_session': 'tok' }),
			request: { formData: async () => form },
		} as never)) as { data: { error: string } };
		expect(out.data.error).toBe('Could not prune the audit log. Try again.');
	});

	it('exposes no export as an action', () => {
		// A form pointing at ?/export would post to a route that answers 404,
		// and this says so here rather than in a browser.
		expect(actions).not.toHaveProperty('export');
		expect(actions).not.toHaveProperty('exportAll');
	});
});

// The engine answers a `{data, total, limit, offset}` envelope. A count
// derived from the page length would report one more row than had been read,
// and the header and the pager both go by the count.
describe('audit-log load reports the row count the engine sent', () => {
	function rows(count: number) {
		return Array.from({ length: count }, (_, i) => ({ id: `e${i}` }));
	}

	async function runLoad(offset: number) {
		session.user = { roles: ['super_admin'] };
		const event = {
			fetch: vi.fn() as unknown as typeof globalThis.fetch,
			cookies: mockCookies({ '__Host-sys_session': 'tok' }),
			url: new URL(`http://localhost/admin/audit-log?offset=${offset}`),
		} as never;
		return (await load(event)) as unknown as { total: number; entries: { ok: true; value: unknown[] } };
	}

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('takes the total from the envelope, not from the page length', async () => {
		engine.get.mockResolvedValue({ data: rows(50), total: 13043, limit: 50, offset: 0 });

		expect((await runLoad(0)).total).toBe(13043);
	});

	it('keeps the rows already read as the floor when no count is sent', async () => {
		engine.get.mockResolvedValue({ data: rows(50) });

		expect((await runLoad(200)).total).toBe(250);
	});

	it('reports an empty log as empty', async () => {
		engine.get.mockResolvedValue({ data: [], total: 0, limit: 50, offset: 0 });

		const result = await runLoad(0);

		expect(result.entries).toEqual({ ok: true, value: [] });
		expect(result.total).toBe(0);
	});
});

/*
 * A log that could not be read is not an empty log. Drawn as one, it tells an
 * auditor that nothing was ever changed on this instance.
 */
describe('audit-log load keeps a failed read apart from an empty log', () => {
	function event(query = '') {
		session.user = { roles: ['admin'] };
		return {
			fetch: vi.fn() as unknown as typeof globalThis.fetch,
			cookies: mockCookies({ '__Host-sys_session': 'tok' }),
			url: new URL(`http://localhost/admin/audit-log${query}`),
		} as never;
	}

	beforeEach(() => {
		vi.clearAllMocks();
		engine.get.mockReset();
	});

	it('returns a gate and no count when the read fails', async () => {
		engine.get.mockRejectedValue(new Error('boom'));

		const result = (await load(event())) as unknown as {
			entries: { ok: boolean; gate?: { state: string } };
			total: number | null;
		};

		expect(result.entries.ok).toBe(false);
		expect(result.entries.gate?.state).toBe('error');
		expect(result.total).toBeNull();
	});

	it('sends a page past the end back to the last page', async () => {
		engine.get.mockResolvedValue({ data: [], total: 120 });

		await expect(load(event('?offset=500'))).rejects.toMatchObject({
			status: 307,
			location: '/admin/audit-log?offset=100',
		});
	});

	it('snaps an offset from the address to a page boundary', async () => {
		engine.get.mockResolvedValue({ data: [{ id: 'e1', action: 'x' }], total: 120 });

		const result = (await load(event('?offset=73'))) as unknown as { offset: number };

		expect(result.offset).toBe(50);
		expect(String(engine.get.mock.calls[0][0])).toContain('offset=50');
	});

	it('reads a negative offset as the first page', async () => {
		engine.get.mockResolvedValue({ data: [{ id: 'e1', action: 'x' }], total: 1 });

		const result = (await load(event('?offset=-40'))) as unknown as { offset: number };

		expect(result.offset).toBe(0);
	});
});

/*
 * The engine matches whole values and takes no free text, so one search box
 * has to pick the column by the shape of what was typed, and the day chosen
 * as "to" is kept whole by asking for everything before the next one.
 */
describe('audit-log search maps to the endpoint filters', () => {
	const filter = (q: string, extra: Partial<ReturnType<typeof readFilter>> = {}) => ({
		q,
		action: '',
		from: '',
		to: '',
		...extra,
	});

	it('sends an id as the actor', () => {
		const params = endpointQuery(filter('a1b2c3d4-0000-0000-0000-000000000000'), 50, 0);
		expect(params.get('actor')).toBe('a1b2c3d4-0000-0000-0000-000000000000');
		expect(params.get('resource_type')).toBeNull();
	});

	it('sends a dotted name as the action, unless the select already chose one', () => {
		expect(endpointQuery(filter('content.delete'), 50, 0).get('action')).toBe('content.delete');
		const both = endpointQuery(filter('content.delete', { action: 'schema.create' }), 50, 0);
		expect(both.get('action')).toBe('schema.create');
		expect(both.get('resource_type')).toBe('content.delete');
	});

	it('sends anything else as the resource type', () => {
		expect(endpointQuery(filter('api_key'), 50, 0).get('resource_type')).toBe('api_key');
	});

	it('keeps the chosen last day whole', () => {
		const params = endpointQuery(filter('', { from: '2026-01-01', to: '2026-01-31' }), 50, 0);
		expect(params.get('from')).toBe('2026-01-01T00:00:00Z');
		expect(params.get('to')).toBe('2026-02-01T00:00:00Z');
	});

	it('drops a day that is not a day', () => {
		const url = new URL('http://localhost/admin/audit-log?from=yesterday&to=2026-01-31&q=%20x%20');
		expect(readFilter(url)).toEqual({ q: 'x', action: '', from: '', to: '2026-01-31' });
	});

	it('swaps a From day later than the To day, which the engine would refuse', () => {
		const url = new URL('http://localhost/admin/audit-log?from=2026-03-10&to=2026-03-01');
		expect(readFilter(url)).toMatchObject({ from: '2026-03-01', to: '2026-03-10' });
	});

	it('offers the other actions in the window while one is in force', async () => {
		engine.get.mockReset();
		engine.get
			.mockResolvedValueOnce({ data: [{ id: 'e1', action: 'content.delete' }], total: 1 })
			.mockResolvedValueOnce({
				data: [
					{ id: 'e1', action: 'content.delete' },
					{ id: 'e2', action: 'schema.create' },
				],
				total: 2,
			});
		session.user = { roles: ['super_admin'] };
		const event = {
			fetch: vi.fn() as unknown as typeof globalThis.fetch,
			cookies: mockCookies({ '__Host-sys_session': 'tok' }),
			url: new URL('http://localhost/admin/audit-log?action=content.delete'),
		} as never;
		const result = (await load(event)) as unknown as { actions: string[] };
		expect(String(engine.get.mock.calls[1][0])).not.toContain('action=');
		expect(result.actions).toEqual(['content.delete', 'schema.create']);
	});

	it('asks again by resource id when an id matched no actor', async () => {
		engine.get.mockReset();
		engine.get
			.mockResolvedValueOnce({ data: [], total: 0 })
			.mockResolvedValueOnce({ data: [{ id: 'e1', action: 'content.delete' }], total: 1 });
		session.user = { roles: ['super_admin'] };
		const event = {
			fetch: vi.fn() as unknown as typeof globalThis.fetch,
			cookies: mockCookies({ '__Host-sys_session': 'tok' }),
			url: new URL('http://localhost/admin/audit-log?q=a1b2c3d4-0000-0000-0000-000000000000'),
		} as never;
		const result = (await load(event)) as unknown as { entries: { ok: true; value: unknown[] }; actions: string[] };
		expect(engine.get).toHaveBeenCalledTimes(2);
		expect(String(engine.get.mock.calls[1][0])).toContain('resource_id=');
		expect(result.entries.value).toHaveLength(1);
		expect(result.actions).toEqual(['content.delete']);
	});
});
