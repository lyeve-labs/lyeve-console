import { describe, it, expect, vi } from 'vitest';
import type { Cookies } from '@sveltejs/kit';

import { actions, load } from './+page.server';

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' },
	});
}

function mockCookies(): Cookies {
	return {
		get: vi.fn(() => 'tok'),
		set: vi.fn(),
		delete: vi.fn(),
		getAll: vi.fn(() => []),
		serialize: vi.fn(() => ''),
	} as unknown as Cookies;
}

type Loaded = Exclude<Awaited<ReturnType<typeof load>>, void>;

/** A load event whose list and schema reads answer with the given statuses. */
function loadEvent(list: number, schemas = 200) {
	const fetch = vi.fn(async (url: string) => {
		const asked = String(url);
		if (asked.includes('/schemas')) return schemas === 200 ? json([]) : json({ error: 'nope' }, schemas);
		return list === 200 ? json({ data: [] }) : json({ error: 'nope' }, list);
	}) as unknown as typeof globalThis.fetch;
	return {
		fetch,
		cookies: mockCookies(),
		url: new URL('http://localhost/admin/webhooks/incoming'),
	} as never;
}

/*
 * An empty list is the first-run state with an offer to create the first
 * endpoint. A read that failed is a gate, never that state.
 */
describe('admin/webhooks/incoming load', () => {
	it('keeps a failed list read as its gate, never as no endpoints', async () => {
		expect(((await load(loadEvent(500))) as Loaded).incomingWebhooks).toMatchObject({ ok: false, gate: { state: 'error' } });
		expect(((await load(loadEvent(503))) as Loaded).incomingWebhooks).toEqual({ ok: false, gate: { state: 'unavailable' } });
		expect(((await load(loadEvent(403))) as Loaded).incomingWebhooks).toEqual({ ok: false, gate: { state: 'forbidden' } });
	});

	it('keeps a failed schema read apart from a list of none', async () => {
		const result = (await load(loadEvent(200, 503))) as Loaded;
		expect(result.incomingWebhooks).toEqual({ ok: true, value: [] });
		expect(result.schemas).toEqual({ ok: false, gate: { state: 'unavailable' } });
	});
});

/** A load event at the given address whose list read answers with the given body. */
function listEvent(body: unknown, query = '') {
	const asked: string[] = [];
	const fetch = vi.fn(async (url: string) => {
		const u = String(url);
		asked.push(u);
		if (u.includes('/schemas')) return json([]);
		return json(body);
	}) as unknown as typeof globalThis.fetch;
	const event = {
		fetch,
		cookies: mockCookies(),
		url: new URL(`http://localhost/admin/webhooks/incoming${query}`),
	} as never;
	return { event, asked };
}

const row = (id: string) => ({ id, name: id, schema_name: 'orders', enabled: true, field_map: { a: 'b' } });

/*
 * The plugin pages its list. A page that asked for every endpoint at once
 * showed only the plugin's default page and said nothing of the rest.
 */
describe('admin/webhooks/incoming paging', () => {
	it('asks for the page the address names and one row past it', async () => {
		const { event, asked } = listEvent({ data: [row('a')], total_count: 26 }, '?limit=25&offset=25');
		const result = (await load(event)) as Loaded;
		expect(asked.find((u) => u.includes('/incoming-webhooks'))).toContain('limit=26&offset=25');
		expect(result).toMatchObject({ limit: 25, offset: 25, total: 26 });
	});

	it('sends a page past the end back to the last page', async () => {
		const { event } = listEvent({ data: [], total_count: 3 }, '?limit=25&offset=50');
		await expect(load(event)).rejects.toMatchObject({ status: 307, location: '/admin/webhooks/incoming?limit=25&offset=0' });
	});
});

/*
 * The plugin says on its list whether its license opens create and update.
 * Only a stated value reaches the page, so an older plugin that sends nothing
 * leaves both live.
 */
describe('admin/webhooks/incoming license flag', () => {
	it.each([
		[false, false],
		[true, true],
		[undefined, null],
		['no', null],
	])('reads licensed %s as %s', async (sent, read) => {
		const { event } = listEvent({ data: [], total_count: 0, licensed: sent });
		expect(((await load(event)) as Loaded).licensed).toBe(read);
	});
});

/*
 * The plugin serves create, update and delete to a super admin only, so an
 * admin's direct POST stops here before it reaches the engine.
 */
describe('admin/webhooks/incoming writes by role', () => {
	function writeEvent(roles: string[]) {
		const seen: string[] = [];
		const fetch = vi.fn(async (url: string) => {
			seen.push(String(url));
			if (String(url).includes('/auth/me')) return json({ id: 'u1', roles, disabled: false });
			return json({});
		}) as unknown as typeof globalThis.fetch;
		const form = new FormData();
		form.set('confirmed', 'yes');
		form.set('id', 'i1');
		form.set('field_map', '{"id":"external_id"}');
		return {
			seen,
			event: {
				fetch,
				cookies: mockCookies(),
				request: { formData: async () => form, clone: () => ({ formData: async () => form }) },
				url: new URL('http://localhost/admin/webhooks/incoming'),
			} as never,
		};
	}

	it.each(['create', 'update', 'delete'] as const)('refuses %s to an admin', async (name) => {
		const { event, seen } = writeEvent(['admin']);
		await expect(actions[name](event)).rejects.toMatchObject({ status: 403 });
		expect(seen.filter((u) => !u.includes('/auth/me'))).toEqual([]);
	});

	it('lets a super admin delete', async () => {
		const { event, seen } = writeEvent(['super_admin']);
		await actions.delete(event);
		expect(seen.some((u) => u.includes('/api/admin/incoming-webhooks/i1'))).toBe(true);
	});
});

type Call = { method: string; path: string; body: unknown };
type Failure = { status: number; data: { action?: string; error: string } };

/** A super admin's action event against a fake engine that answers every write with `reply`. */
function superAdminWrite(fields: Record<string, string>, reply: Response = json({})) {
	const calls: Call[] = [];
	const fetch = vi.fn(async (url: string, init?: RequestInit) => {
		const path = String(url);
		if (path.includes('/auth/me')) return json({ id: 'u1', roles: ['super_admin'], disabled: false });
		calls.push({ method: init?.method ?? 'GET', path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
		return reply.clone();
	}) as unknown as typeof globalThis.fetch;
	const form = new FormData();
	form.set('confirmed', 'yes');
	for (const [k, v] of Object.entries(fields)) form.set(k, v);
	const url = new URL('http://localhost/admin/webhooks/incoming');
	return { calls, event: { fetch, cookies: mockCookies(), url, request: new Request(url, { method: 'POST', body: form }) } as never };
}

const ENDPOINT = {
	name: 'Orders',
	schema_name: 'orders',
	secret: 's3cret',
	field_map: '{"id":"external_id"}',
	enabled: 'on',
	allowed_ips: '10.0.0.1\n\n 10.0.0.2 \n',
};

describe('admin/webhooks/incoming writes', () => {
	it('creates an endpoint with its map and one address per line', async () => {
		const { event, calls } = superAdminWrite(ENDPOINT);
		expect(await actions.create(event)).toBeUndefined();
		expect(calls).toEqual([
			{
				method: 'POST',
				path: '/api/admin/incoming-webhooks',
				body: {
					name: 'Orders',
					schema_name: 'orders',
					secret: 's3cret',
					field_map: { id: 'external_id' },
					enabled: true,
					allowed_ips: ['10.0.0.1', '10.0.0.2'],
				},
			},
		]);
	});

	it('saves an endpoint under its id', async () => {
		const { event, calls } = superAdminWrite({ ...ENDPOINT, id: 'i1', enabled: 'false' });
		await actions.update(event);
		expect(calls).toHaveLength(1);
		expect(calls[0]).toMatchObject({ method: 'PUT', path: '/api/admin/incoming-webhooks/i1', body: { enabled: false } });
	});

	it.each(['create', 'update'] as const)('refuses a map that is not JSON on %s without a request', async (name) => {
		const { event, calls } = superAdminWrite({ ...ENDPOINT, id: 'i1', field_map: '{id:' });
		expect(((await actions[name](event)) as Failure).data).toEqual({ action: name, error: 'Enter the field map as valid JSON.' });
		expect(calls).toEqual([]);
	});

	it.each(['create', 'update'] as const)('refuses an empty map on %s without a request', async (name) => {
		const { event, calls } = superAdminWrite({ ...ENDPOINT, id: 'i1', field_map: '{}' });
		const out = (await actions[name](event)) as Failure;
		expect(out.data.action).toBe(name);
		expect(out.data.error).toContain('at least one external key');
		expect(calls).toEqual([]);
	});

	it.each(['create', 'update', 'delete'] as const)('relays the engine refusal on %s under its action', async (name) => {
		const { event } = superAdminWrite({ ...ENDPOINT, id: 'i1' }, json({ error: 'schema orders does not exist', code: 'http_422' }, 422));
		const out = (await actions[name](event)) as Failure;
		expect(out.data).toEqual({ action: name, error: 'schema orders does not exist' });
	});

	it.each([
		['create', 'Could not create the incoming webhook. Try again.'],
		['update', 'Could not save the incoming webhook. Try again.'],
		['delete', 'Could not delete the incoming webhook. Try again.'],
	] as const)('keeps outage detail off the page on %s', async (name, sentence) => {
		const { event } = superAdminWrite({ ...ENDPOINT, id: 'i1' }, json({ error: 'dial tcp 10.0.0.4:5432' }, 503));
		expect(((await actions[name](event)) as Failure).data).toEqual({ action: name, error: sentence });
	});
});
