import { describe, expect, it, vi } from 'vitest';
import type { Cookies } from '@sveltejs/kit';
import { actions, load } from './+page.server';
import type { Variable } from '$lib/api/flows';

type Loaded = Exclude<Awaited<ReturnType<typeof load>>, void>;

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function mockCookies(): Cookies {
	return { get: vi.fn(() => 'tok'), set: vi.fn(), delete: vi.fn(), getAll: vi.fn(() => []), serialize: vi.fn(() => '') } as unknown as Cookies;
}

type Route = (url: string, init?: RequestInit) => Response;

function fetchFor(routes: Record<string, Route>) {
	const calls: { url: string; init?: RequestInit }[] = [];
	const fetch = vi.fn(async (url: string, init?: RequestInit) => {
		const asked = String(url);
		calls.push({ url: asked, init });
		if (asked.includes('/auth/me')) return json({ id: 'u1', roles: ['admin'], disabled: false });
		for (const [needle, route] of Object.entries(routes)) if (asked.includes(needle)) return route(asked, init);
		return json({ error: 'no route' }, 404);
	}) as unknown as typeof globalThis.fetch;
	return { fetch, calls };
}

function loadEvent(routes: Record<string, Route>, search = '') {
	const { fetch } = fetchFor(routes);
	return { fetch, cookies: mockCookies(), url: new URL(`http://localhost/admin/flows/variables${search}`), parent: async () => ({}) } as never;
}

function actionEvent(form: FormData, routes: Record<string, Route>) {
	const { fetch, calls } = fetchFor(routes);
	return { calls, event: { fetch, cookies: mockCookies(), request: { formData: async () => form, clone: () => ({ formData: async () => form }) }, url: new URL('http://localhost/admin/flows/variables'), params: {} } as never };
}

describe('admin/flows/variables load', () => {
	it('lists the variables, secrets without a value', async () => {
		const result = (await load(
			loadEvent({
				'/variables': () =>
					json({ data: [{ key: 'region', value: 'eu', is_secret: false, updated_at: 'x' }, { key: 'api_key', is_secret: true, updated_at: 'x' }] }),
			})
		)) as Loaded;
		expect(result.variables.map((v: Variable) => v.key)).toEqual(['region', 'api_key']);
		expect(result.variables[1].value).toBeUndefined();
	});

	// The plugin answers the whole list whatever window is asked for, so the
	// page windows and searches it.
	it('windows and searches the whole list the plugin answers', async () => {
		const many = Array.from({ length: 60 }, (_, i) => ({ key: `k${String(i).padStart(2, '0')}`, value: i === 7 ? 'eu-west' : 'x', is_secret: false, updated_at: 'x' }));
		const first = (await load(loadEvent({ '/variables': () => json({ data: many, total_count: 60, limit: 60, offset: 0 }) }))) as Loaded;
		expect(first.variables).toHaveLength(50);
		expect(first.total).toBe(60);

		const second = (await load(loadEvent({ '/variables': () => json({ data: many, total_count: 60, limit: 60, offset: 0 }) }, '?offset=50'))) as Loaded;
		expect(second.variables.map((v: Variable) => v.key)).toEqual(['k50', 'k51', 'k52', 'k53', 'k54', 'k55', 'k56', 'k57', 'k58', 'k59']);

		const found = (await load(loadEvent({ '/variables': () => json({ data: many, total_count: 60, limit: 60, offset: 0 }) }, '?q=eu-'))) as Loaded;
		expect(found.variables.map((v: Variable) => v.key)).toEqual(['k07']);
	});

	it('sends a page past the end back to the last page', async () => {
		const few = [{ key: 'region', value: 'eu', is_secret: false, updated_at: 'x' }];
		await expect(load(loadEvent({ '/variables': () => json({ data: few }) }, '?offset=100'))).rejects.toMatchObject({ status: 307 });
	});

	it('maps a 402 to the locked state', async () => {
		const result = (await load(loadEvent({ '/variables': () => json({ error: 'nope' }, 402) }))) as Loaded;
		expect(result.locked).toBe(true);
		expect(result.gate).toEqual({ state: 'ok' });
	});

	it('sends an expired session to the login page with the cookie cleared', async () => {
		const event = loadEvent({ '/variables': () => json({ error: 'unauthorized' }, 401) });
		await expect(load(event)).rejects.toMatchObject({ status: 302, location: '/login' });
		expect((event as { cookies: Cookies }).cookies.delete).toHaveBeenCalledWith('__Host-sys_session', expect.objectContaining({ path: '/' }));
	});

	it('names the role as the reason for a 403', async () => {
		const result = (await load(loadEvent({ '/variables': () => json({ error: 'forbidden' }, 403) }))) as Loaded;
		expect(result.locked).toBe(false);
		expect(result.gate).toEqual({ state: 'forbidden' });
	});

	it('keeps the engine banner for a network failure', async () => {
		const result = (await load(
			loadEvent({
				'/variables': () => {
					throw new TypeError('fetch failed');
				},
			})
		)) as Loaded;
		expect(result.gate).toEqual({ state: 'unavailable' });
	});

	it('reports a failed read as a static message rather than an empty list', async () => {
		const result = (await load(loadEvent({ '/variables': () => json({ error: 'pq: connection refused' }, 503) }))) as Loaded;
		expect(result.locked).toBe(false);
		expect(result.gate).toEqual({ state: 'unavailable' });
	});
});

describe('admin/flows/variables actions', () => {
	it('put upserts the key, value and secret flag', async () => {
		const form = new FormData();
		form.set('key', 'api_key');
		form.set('value', 's3cret');
		form.set('is_secret', 'true');
		const { event, calls } = actionEvent(form, { '/variables': () => json({ key: 'api_key', is_secret: true, updated_at: 'x' }) });
		const result = (await actions.put(event)) as { saved: string };
		expect(result.saved).toBe('api_key');
		const call = calls.find((c) => c.init?.method === 'PUT')!;
		expect(JSON.parse(String(call.init?.body))).toEqual({ key: 'api_key', value: 's3cret', is_secret: true });
	});

	it('put refuses a key the engine would reject', async () => {
		const form = new FormData();
		form.set('key', 'Bad Key');
		form.set('value', 'x');
		const { event, calls } = actionEvent(form, {});
		const result = (await actions.put(event)) as { status: number; data: { key: string } };
		expect(result.status).toBe(400);
		expect(result.data.key).toBe('Bad Key');
		expect(calls.some((c) => c.init?.method === 'PUT')).toBe(false);
	});

	it('put keeps a stored secret when the edit left the value blank', async () => {
		const form = new FormData();
		form.set('key', 'api_key');
		form.set('value', '');
		form.set('is_secret', 'true');
		form.set('existing', 'true');
		const { event, calls } = actionEvent(form, {});
		await actions.put(event);
		expect(calls.some((c) => c.init?.method === 'PUT')).toBe(false);
	});

	it('delete removes by key', async () => {
		const form = new FormData();
		form.set('confirmed', 'yes');
		form.set('key', 'region');
		const { event, calls } = actionEvent(form, { '/variables/region': () => new Response(null, { status: 204 }) });
		await actions.delete(event);
		expect(calls.find((c) => c.init?.method === 'DELETE')?.url).toContain('/variables/region');
	});

	it('relays the engine message on refusal', async () => {
		const form = new FormData();
		form.set('key', 'region');
		form.set('value', 'x');
		const { event } = actionEvent(form, { '/variables': () => json({ error: 'value too long', code: 'bad_request' }, 400) });
		const result = (await actions.put(event)) as { data: { error: string } };
		expect(result.data.error).toBe('value too long');
	});
});
