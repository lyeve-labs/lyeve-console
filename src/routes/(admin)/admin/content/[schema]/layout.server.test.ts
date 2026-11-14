import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Cookies } from '@sveltejs/kit';

const rest = vi.hoisted(() => ({
	getSchema: vi.fn(async (name: string): Promise<unknown> => ({ name, fields: [] })),
}));
vi.mock('@lyeve-labs/client-rest', () => rest);

import { load } from './+layout.server';

const LIST = '/(admin)/admin/content/[schema]';

const posts = {
	name: 'posts',
	fields: [
		{ name: 'headline', field_type: 'text' },
		{ name: 'author', field_type: 'relation', relation_type: 'belongs_to', relation_to: 'people' },
		{ name: 'reviewers', field_type: 'relation', relation_type: 'many_to_many', relation_to: 'people' },
		{ name: 'parent', field_type: 'relation', relation_type: 'belongs_to', relation_to: 'posts' },
		{ name: 'tags', field_type: 'relation', relation_type: 'has_many', relation_to: 'tag' },
	],
};

function cookies(): Cookies {
	const jar: Record<string, string> = { '__Host-sys_session': 'tok' };
	return { get: (name: string) => jar[name], getAll: () => [], set: vi.fn(), delete: vi.fn(), serialize: vi.fn() } as unknown as Cookies;
}

function listed(input: string | URL | Request): Response {
	const u = new URL(String(input), 'http://localhost');
	const schema = u.searchParams.get('schema');
	const body = { data: [{ id: `${schema}-1`, title: `First ${schema}` }], total_count: schema === 'people' ? 900 : 1 };
	return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

/**
 * An address that records each read SvelteKit tracks. A server load reruns
 * when a URL property it read changes, and SvelteKit tracks href, pathname,
 * search, toString, toJSON and every searchParams read
 * (`make_trackable` in @sveltejs/kit's utils/url.js). The scheme is not
 * tracked, and the session client reads only that.
 */
function trackedUrl(href: string, reads: string[]): URL {
	const url = new URL(href);
	return new Proxy(url, {
		get(target, key) {
			if (['href', 'pathname', 'search', 'searchParams', 'toString', 'toJSON'].includes(String(key))) {
				reads.push(String(key));
			}
			const value = Reflect.get(target, key);
			return typeof value === 'function' ? value.bind(target) : value;
		},
	});
}

function event(routeId: string, fetch: typeof globalThis.fetch, reads: string[] = []) {
	return {
		fetch,
		cookies: cookies(),
		params: { schema: 'posts' },
		route: { id: routeId },
		url: trackedUrl('http://localhost/admin/content/posts?filters[headline][contains]=a&sort=title', reads),
	} as never;
}

type Choices = Record<string, { items: { id: string }[]; total: number; failed: boolean }> | null;

describe('the entry list layout reads the relation filter choices', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		rest.getSchema.mockImplementation(async (name: string) => (name === 'posts' ? posts : { name, fields: [] }));
	});

	it('reads each related content type once, however many fields point at it', async () => {
		const fetch = vi.fn(async (input: string | URL | Request) => listed(input));
		const data = (await load(event(LIST, fetch as never))) as { relationChoices: Promise<Choices> };
		const choices = await data.relationChoices;

		const reads = fetch.mock.calls.map((c) => new URL(String(c[0]), 'http://localhost').searchParams.get('schema'));
		expect(reads.sort()).toEqual(['people', 'posts', 'tag']);
		expect(choices?.people).toMatchObject({ total: 900, failed: false, items: [{ id: 'people-1' }] });
		expect(choices?.posts).toMatchObject({ total: 1, failed: false });
		// The list has no assistant, so no related definition is read for its labels.
		expect(rest.getSchema.mock.calls.map((c) => c[0])).toEqual(['posts']);
		expect(choices?.people).not.toHaveProperty('assistantLabels');
	});

	it('returns the choices unawaited, so the list streams before they arrive', () => {
		let release: (r: Response) => void = () => {};
		const fetch = vi.fn(() => new Promise<Response>((resolve) => (release = resolve)));
		const data = load(event(LIST, fetch as never)) as unknown as { relationChoices: Promise<Choices> };

		expect(data.relationChoices).toBeInstanceOf(Promise);
		release(new Response('{}'));
	});

	it('depends on the content type and the route, never on the address', async () => {
		const reads: string[] = [];
		const fetch = vi.fn(async (input: string | URL | Request) => listed(input));
		const data = (await load(event(LIST, fetch as never, reads))) as { relationChoices: Promise<Choices> };
		await data.relationChoices;

		expect(reads).toEqual([]);
	});

	it('reads nothing for the entry pages under the list', async () => {
		const fetch = vi.fn(async (input: string | URL | Request) => listed(input));
		for (const route of [`${LIST}/[id]`, `${LIST}/new`]) {
			expect(await load(event(route, fetch as never))).toEqual({});
		}
		expect(fetch).not.toHaveBeenCalled();
		expect(rest.getSchema).not.toHaveBeenCalled();
	});

	it('says the choices failed, rather than offering none, when a read fails', async () => {
		const fetch = vi.fn(async (input: string | URL | Request) =>
			String(input).includes('schema=tag') ? new Response('nope', { status: 503 }) : listed(input),
		);
		const data = (await load(event(LIST, fetch as never))) as { relationChoices: Promise<Choices> };
		const choices = await data.relationChoices;
		expect(choices?.tag).toEqual({ items: [], total: 0, failed: true });

		rest.getSchema.mockRejectedValueOnce(new Error('down'));
		const unread = (await load(event(LIST, fetch as never))) as { relationChoices: Promise<Choices> };
		expect(await unread.relationChoices).toBeNull();
	});
});
