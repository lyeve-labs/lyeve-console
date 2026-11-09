import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Cookies } from '@sveltejs/kit';

const authz = vi.hoisted(() => ({ roles: ['super_admin'] as string[] }));
vi.mock('$lib/server/authz', async (importOriginal) => ({
	...((await importOriginal()) as object),
	requireUser: vi.fn(async () => ({ id: 'u1', roles: authz.roles })),
}));

import { actions } from './+page.server';

type Failure = { status: number; data: { tryError: string } };

function tryEvent(fields: Record<string, string>, fetch: typeof globalThis.fetch) {
	const data = new FormData();
	for (const [k, v] of Object.entries(fields)) data.set(k, v);
	return {
		fetch,
		cookies: { get: vi.fn(() => 'tok') } as unknown as Cookies,
		request: { formData: async () => data },
		url: new URL('http://admin.test/admin/api-reference'),
	} as never;
}

const answer = (body: unknown, status = 200) =>
	vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })) as unknown as typeof globalThis.fetch;

beforeEach(() => {
	vi.clearAllMocks();
	authz.roles = ['super_admin'];
});

describe('trying an endpoint', () => {
	it('returns what the engine answered, with its status', async () => {
		const fetch = answer({ data: [] });
		const out = (await actions.try(tryEvent({ method: 'GET', path: '/api/admin/tenants' }, fetch))) as {
			tried: { status: number };
		};
		expect(out.tried.status).toBe(200);
		expect(String((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0])).toContain('/api/admin/tenants');
	});

	// A write from this page is a super admin's. An admin's post never
	// reaches the engine.
	it('refuses a write to an admin before the engine is asked', async () => {
		authz.roles = ['admin'];
		const fetch = answer({});
		const out = (await actions.try(
			tryEvent({ method: 'POST', path: '/api/admin/tenants', acknowledge: 'on' }, fetch),
		)) as Failure;
		expect(out.status).toBe(422);
		expect(out.data.tryError).toContain('Only a super admin can send');
		expect(fetch).not.toHaveBeenCalled();
	});

	// The engine's refusal is the answer the reader is looking for.
	it("shows the engine's refusal as the response", async () => {
		const out = (await actions.try(
			tryEvent({ method: 'GET', path: '/api/admin/tenants' }, answer({ error: 'forbidden' }, 403)),
		)) as { tried: { status: number } };
		expect(out.tried.status).toBe(403);
	});

	it('says a request that never reached the engine did not', async () => {
		const fetch = vi.fn(async () => {
			throw new TypeError('fetch failed');
		}) as unknown as typeof globalThis.fetch;
		const out = (await actions.try(tryEvent({ method: 'GET', path: '/api/admin/tenants' }, fetch))) as Failure;
		expect(out.status).toBe(502);
		expect(out.data.tryError).toBe('Could not send the request. Try again.');
	});

	// The runtime's words for a failed connection can name an internal address.
	it('prints none of the transport error', async () => {
		const fetch = vi.fn(async () => {
			throw new TypeError('fetch failed: connect ECONNREFUSED 10.0.0.5:8080');
		}) as unknown as typeof globalThis.fetch;
		const out = (await actions.try(tryEvent({ method: 'GET', path: '/api/admin/tenants' }, fetch))) as Failure;
		expect(out.data.tryError).not.toContain('ECONNREFUSED');
	});
});
