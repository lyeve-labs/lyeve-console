import { describe, expect, it, vi } from 'vitest';
import type { Cookies } from '@sveltejs/kit';
import { load } from './+page.server';
import { signedIn } from '$lib/server/test-support/signed-in';

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const cookies = { get: () => 'tok', set: vi.fn(), delete: vi.fn(), getAll: () => [], serialize: () => '' } as unknown as Cookies;

/** A load event whose fetch answers each path with what `answer` returns. */
function event(answer: (path: string) => Response, search = '') {
	return {
		fetch: signedIn(vi.fn(async (url: string) => answer(String(url))) as unknown as typeof fetch, { roles: ['super_admin'] }),
		cookies,
		url: new URL(`http://localhost/admin/api-keys${search}`),
	} as never;
}

type Loaded = Exclude<Awaited<ReturnType<typeof load>>, void>;

const key = { id: 'k1', name: 'deploy', roles: ['editor'], schemas: [], enabled: true };

describe('API keys load', () => {
	it('keeps a failed key read apart from an empty one', async () => {
		const out = (await load(event(() => json({ error: 'boom' }, 500)))) as Loaded;
		expect(out.keys).toEqual({ ok: false, gate: { state: 'error', message: expect.any(String) } });
	});

	it('sends a page past the end back to the last page that holds keys', async () => {
		const answer = (path: string) =>
			path.startsWith('/api/admin/api-keys') ? json({ data: [], total_count: 60 }) : json({});
		await expect(load(event(answer, '?offset=100&limit=50'))).rejects.toMatchObject({
			status: 307,
			location: '/admin/api-keys?offset=50&limit=50',
		});
	});

	it('marks the usage unknown when its read failed, and absent when the route is missing', async () => {
		const failing = (path: string) => {
			if (path.startsWith('/api/admin/api-keys')) return json({ data: [key], total_count: 1 });
			if (path.startsWith('/api/admin/usage')) return json({ error: 'down' }, 500);
			return json([]);
		};
		const out = (await load(event(failing))) as Loaded;
		expect(out.usageUnknown).toEqual(['k1']);

		const missing = (path: string) => {
			if (path.startsWith('/api/admin/api-keys')) return json({ data: [key], total_count: 1 });
			if (path.startsWith('/api/admin/usage')) return json({ error: 'not found' }, 404);
			return json([]);
		};
		const none = (await load(event(missing))) as Loaded;
		expect(none.usageUnknown).toEqual([]);
	});

	it('reads the usage of every key on the page in one request', async () => {
		const page = [key, { ...key, id: 'k2' }, { ...key, id: 'k3' }];
		const calls: string[] = [];
		const answer = (path: string) => {
			calls.push(path);
			if (path.startsWith('/api/admin/api-keys?')) return json({ data: page, total_count: 3 });
			if (path.startsWith('/api/admin/usage/api-keys?')) {
				return json([
					{ api_key_id: 'k1', requests: 5 },
					{ api_key_id: 'k3', requests: 9 },
				]);
			}
			return json([]);
		};
		const out = (await load(event(answer))) as Loaded;
		const usageCalls = calls.filter((p) => p.startsWith('/api/admin/usage'));
		expect(usageCalls).toHaveLength(1);
		expect(new URL(usageCalls[0], 'http://x').searchParams.get('ids')).toBe('k1,k2,k3');
		expect(out.usageMap.k1?.requests).toBe(5);
		expect(out.usageMap.k3?.requests).toBe(9);
		expect(out.usageMap.k2).toBeUndefined();
		expect(out.usageUnknown).toEqual([]);
	});

	it('reads no usage for an empty page', async () => {
		const calls: string[] = [];
		const answer = (path: string) => {
			calls.push(path);
			if (path.startsWith('/api/admin/api-keys?')) return json({ data: [], total_count: 0 });
			return json([]);
		};
		await load(event(answer));
		expect(calls.filter((p) => p.startsWith('/api/admin/usage'))).toEqual([]);
	});

	it('says when the schemas or the route catalog could not be read', async () => {
		const answer = (path: string) => {
			if (path.startsWith('/api/admin/api-keys?')) return json({ data: [key], total_count: 1 });
			if (path.startsWith('/api/admin/api-key-scopes')) return json({ error: 'down' }, 503);
			if (path.startsWith('/api/admin/schemas')) return json({ error: 'boom' }, 500);
			return json({});
		};
		const out = (await load(event(answer))) as Loaded;
		expect(out.catalogFailed).toBe(true);
		expect(out.schemasFailed).toBe(true);
	});

	it('says the route catalog could not be read when its answer has no route list', async () => {
		const answer = (path: string) => {
			if (path.startsWith('/api/admin/api-keys?')) return json({ data: [key], total_count: 1 });
			if (path.startsWith('/api/admin/api-key-scopes')) return json({ actions: ['read'] });
			return json([]);
		};
		const out = (await load(event(answer))) as Loaded;
		expect(out.catalog).toBeNull();
		expect(out.catalogFailed).toBe(true);
	});

	it('offers no catalog and says nothing when the engine does not serve one', async () => {
		const answer = (path: string) => {
			if (path.startsWith('/api/admin/api-keys?')) return json({ data: [key], total_count: 1 });
			if (path.startsWith('/api/admin/api-key-scopes')) return json({ error: 'not found' }, 404);
			return json([]);
		};
		const out = (await load(event(answer))) as Loaded;
		expect(out.catalogFailed).toBe(false);
	});
});

/** An action event whose engine knows the session's roles and answers the write with `reply`. */
function write(roles: string[], reply: () => Response | Promise<Response>) {
	const calls: { method: string; path: string }[] = [];
	const fetch = vi.fn(async (url: string, init?: RequestInit) => {
		const path = String(url);
		if (path.startsWith('/api/admin/auth/me')) return json({ id: 'u1', email: 'a@b.co', roles });
		calls.push({ method: init?.method ?? 'GET', path });
		return reply();
	}) as unknown as typeof globalThis.fetch;
	const form = new FormData();
	form.set('confirmed', 'yes');
	form.set('id', 'k1');
	const url = new URL('http://localhost/admin/api-keys');
	return { calls, event: { fetch, cookies, url, request: new Request(url, { method: 'POST', body: form }) } as never };
}

describe('API keys revoke and delete', () => {
	it.each([
		['revoke', 'POST', '/api/admin/api-keys/k1/revoke'],
		['delete', 'DELETE', '/api/admin/api-keys/k1'],
	] as const)('sends %s for the named key', async (name, method, path) => {
		const { actions } = await import('./+page.server');
		const { event, calls } = write(['super_admin'], () => json({}));
		const out = await actions[name](event);
		expect(out).toBeUndefined();
		expect(calls).toEqual([{ method, path }]);
	});

	it.each([
		['revoke', 'Could not revoke the API key. Try again.'],
		['delete', 'Could not delete the API key. Try again.'],
	] as const)('names %s on a refusal and keeps outage detail off the page', async (name, fallback) => {
		const { actions } = await import('./+page.server');
		const refused = write(['super_admin'], () => json({ error: 'api key not found', code: 'not_found' }, 404));
		expect(await actions[name](refused.event)).toMatchObject({ status: 400, data: { action: name, error: 'api key not found' } });
		const down = write(['super_admin'], () => json({ error: 'dial tcp 10.0.0.4:5432: connection refused' }, 503));
		expect(await actions[name](down.event)).toMatchObject({ status: 400, data: { action: name, error: fallback } });
	});

	it.each(['revoke', 'delete'] as const)('holds %s to a super admin', async (name) => {
		const { actions } = await import('./+page.server');
		const { event, calls } = write(['admin'], () => json({}));
		await expect(actions[name](event)).rejects.toMatchObject({ status: 403 });
		expect(calls).toEqual([]);
	});
});

// A form posted without a script never sees the Roles field's warning, so
// the action is what stops a write the engine would refuse the key.
describe('API keys create', () => {
	it('refuses a content write on a key without a writing role, and names the roles field', async () => {
		const { actions } = await import('./+page.server');
		const calls: string[] = [];
		const fetch = vi.fn(async (url: string, init?: RequestInit) => {
			const path = String(url);
			if (path.startsWith('/api/admin/auth/me')) return json({ id: 'u1', email: 'a@b.co', roles: ['super_admin'] });
			calls.push(`${init?.method ?? 'GET'} ${path}`);
			return json({ raw_key: 'k', name: 'svc' });
		}) as unknown as typeof globalThis.fetch;
		const form = new FormData();
		form.set('name', 'svc');
		form.set('roles', 'viewer');
		form.set('scopes', 'content:create');
		const url = new URL('http://localhost/admin/api-keys');
		const out = await actions.create({ fetch, cookies, url, request: new Request(url, { method: 'POST', body: form }) } as never);
		expect(out).toMatchObject({ status: 400, data: { action: 'create', fields: { roles: expect.stringContaining('editor') } } });
		expect(calls).toEqual([]);
	});
});
