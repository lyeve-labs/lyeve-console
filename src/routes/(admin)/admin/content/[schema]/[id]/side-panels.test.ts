import { describe, expect, it, vi } from 'vitest';
import type { Cookies } from '@sveltejs/kit';

// Both side reads throw, as one does when a read it waits on fails in a way
// it does not catch. The rest of the load runs over the event's fetch.
vi.mock('#lib/server/entry-panels.ts', async (importOriginal) => ({
	...((await importOriginal()) as object),
	loadComments: vi.fn(async () => {
		throw new Error('directory read failed');
	}),
	loadReleases: vi.fn(async () => {
		throw new Error('release read failed');
	}),
}));
vi.mock('#lib/server/authz.ts', async (importOriginal) => ({
	...((await importOriginal()) as object),
	requireUser: vi.fn(async () => ({ id: 'u1', email: 'admin@test.invalid' }) as never),
}));
vi.mock('@lyeve-labs/client-rest', () => ({
	getSchema: vi.fn(async () => ({ name: 'article', with_draft_publish: true, fields: [] })),
}));

import { load } from './+page.server';

const entry = { id: 'e1', created_at: '', updated_at: '', title: 'One', body: {}, status: 'draft' };

describe('content editor load, comments and releases that throw', () => {
	it('keeps both panels on the entry as failed reads, never drops them without a word', async () => {
		const fetch = vi.fn(async (path: string) => {
			const body = path.includes('/revisions') ? { data: [] } : path.includes('/api/admin/content?') ? { data: [] } : entry;
			return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
		}) as unknown as typeof globalThis.fetch;
		const cookies = { get: vi.fn((name: string) => (name === '__Host-csrf' ? 'csrf-tok' : 'token')) } as unknown as Cookies;
		const result = (await load({
			fetch,
			cookies,
			params: { schema: 'article', id: 'e1' },
			parent: async () => ({ plugins: { state: 'named', running: [], withheld: [] } }),
		} as never)) as { comments: unknown; releases: unknown };

		expect(result.comments).toMatchObject({ threads: [], unavailable: true });
		expect(result.releases).toEqual({ open: [], holding: [], failed: true });
	});
});
