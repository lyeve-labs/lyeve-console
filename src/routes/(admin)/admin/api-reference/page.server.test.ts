import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Cookies } from '@sveltejs/kit';
import { load } from './+page.server';
import type { ReferencePageData } from './+page.server';
import { staticGroups } from '#lib/api/reference.ts';
import { signedIn } from '#lib/server/test-support/signed-in.ts';

function engineDocument(collections: string[]) {
	const paths: Record<string, unknown> = {
		'/api/admin/setup': { get: { tags: ['Admin / Auth'], summary: 'Check setup status' } },
		'/api/admin/tenants': { get: { tags: ['Admin / Tenants'], summary: 'List tenants', security: [{ bearerAuth: [] }, { cookieAuth: [] }] } },
	};
	for (const c of collections) {
		paths[`/api/v1/content/${c}`] = { get: { tags: [`Content / ${c}`], summary: `List ${c}`, security: [{ bearerAuth: [] }] } };
	}
	return { openapi: '3.1.0', paths };
}

async function runLoad(
	fetchImpl: typeof globalThis.fetch,
	{ roles = ['admin'], search = '' }: { roles?: string[]; search?: string } = {},
): Promise<ReferencePageData> {
	const event = {
		fetch: signedIn(fetchImpl, { roles }),
		cookies: { get: vi.fn(() => 'tok') } as unknown as Cookies,
		url: new URL(`http://admin.test/admin/api-reference${search}`),
	} as never;
	return (await load(event)) as unknown as ReferencePageData;
}

const okFetch = (body: unknown, want = '/api/admin/openapi/public.json') =>
	vi.fn(async (url: string, init?: RequestInit) => {
		expect(url).toBe(want);
		expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer tok');
		return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
	}) as unknown as typeof globalThis.fetch;

beforeEach(() => {
	vi.clearAllMocks();
});

describe('api-reference load', () => {
	it('reads the engine document and documents the content API once', async () => {
		const few = await runLoad(okFetch(engineDocument(['a', 'b'])));
		const many = await runLoad(okFetch(engineDocument(Array.from({ length: 300 }, (_, i) => `c${i}`))));
		expect(few.source).toBe('engine');
		expect(many.groups.length).toBe(few.groups.length);
		expect(many.collections).toBe(300);
		expect(many.groups.flatMap((g) => g.endpoints).filter((e) => e.path.startsWith('/api/v1/content/'))).toHaveLength(1);
	});

	it('shows a route the catalog never wrote up', async () => {
		const data = await runLoad(okFetch(engineDocument([])));
		expect(data.groups.flatMap((g) => g.endpoints).some((e) => e.path === '/api/admin/tenants')).toBe(true);
	});

	it('falls back to the catalog, and says so, when the document cannot be read', async () => {
		const down = vi.fn(async () => new Response('', { status: 503 })) as unknown as typeof globalThis.fetch;
		const data = await runLoad(down);
		expect(data.source).toBe('catalog');
		expect(data.groups).toEqual(staticGroups.filter((g) => g.server !== 'admin'));
		expect(data.collections).toBe(0);

		const thrown = vi.fn(async () => {
			throw new Error('ECONNREFUSED');
		}) as unknown as typeof globalThis.fetch;
		expect((await runLoad(thrown)).source).toBe('catalog');

		const noPaths = vi.fn(async () => new Response('{"openapi":"3.1.0"}', { status: 200 })) as unknown as typeof globalThis.fetch;
		expect((await runLoad(noPaths)).source).toBe('catalog');
	});

	it('reads the admin half for a super admin who asks for it', async () => {
		const data = await runLoad(okFetch(engineDocument([]), '/api/admin/openapi/admin.json'), { roles: ['super_admin'], search: '?api=admin' });
		expect(data.half).toBe('admin');
		expect(data.canSeeAdmin).toBe(true);
		expect(data.specHref).toBe('/api/admin/openapi/admin.json');
	});

	it('shows an admin the public half even when the URL asks for the other', async () => {
		const data = await runLoad(okFetch(engineDocument([])), { roles: ['admin'], search: '?api=admin' });
		expect(data.half).toBe('public');
		expect(data.canSeeAdmin).toBe(false);
	});

	it('keeps the catalog fallback to the half it was asked for', async () => {
		const down = vi.fn(async () => new Response('', { status: 503 })) as unknown as typeof globalThis.fetch;
		const pub = await runLoad(down);
		expect(pub.groups.length).toBeGreaterThan(0);
		expect(pub.groups.every((g) => g.server !== 'admin')).toBe(true);
		const adm = await runLoad(down, { roles: ['super_admin'], search: '?api=admin' });
		expect(adm.groups.length).toBeGreaterThan(0);
		expect(adm.groups.every((g) => g.server === 'admin')).toBe(true);
	});
});
