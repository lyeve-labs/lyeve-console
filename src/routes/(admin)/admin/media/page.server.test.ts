import { describe, it, expect, vi } from 'vitest';
import type { Cookies } from '@sveltejs/kit';

vi.mock('$lib/server/authz', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/authz')>()),
	requireUser: vi.fn(async () => ({ id: 'u1', roles: ['admin'] })),
}));

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

function files(count: number, from = 0) {
	return Array.from({ length: count }, (_, i) => ({
		id: `m${from + i}`,
		key: `k${from + i}`,
		filename: `file-${from + i}.png`,
		content_type: 'image/png',
		size: 1024,
		alt_text: '',
		folder: '',
		uploaded_by: 'u1',
		created_at: '2026-01-01T00:00:00Z',
	}));
}

/** A load event whose fetch answers with `body` and records the URL asked for. */
function loadEvent(body: unknown, search = '') {
	const seen: string[] = [];
	const inits: RequestInit[] = [];
	const fetch = vi.fn(async (url: string, init?: RequestInit) => {
		seen.push(String(url));
		inits.push(init ?? {});
		return json(body);
	}) as unknown as typeof globalThis.fetch;

	return {
		seen,
		inits,
		event: {
			fetch,
			cookies: mockCookies(),
			url: new URL(`http://localhost/admin/media${search}`),
			parent: async () => ({ user: { roles: ['super_admin'] } }),
		} as never,
	};
}

type Loaded = Exclude<Awaited<ReturnType<typeof load>>, void>;

/** The rows a load answered. A failed read fails the test here, so no assertion reads it as empty. */
function rows(result: Loaded) {
	if (!result.items.ok) throw new Error(`the read failed: ${result.items.gate.state}`);
	return result.items.value;
}

/*
 * The request always carries a limit and an offset. A library of ten thousand
 * files is a page the browser cannot lay out, and an operator could not reach
 * the end of it either.
 */
describe('admin/media/+page.server.ts load', () => {
	it('asks the endpoint for a bounded window', async () => {
		const { seen, event } = loadEvent(files(10));

		await load(event);

		expect(seen[0]).toContain('limit=');
		expect(seen[0]).toContain('offset=0');
	});

	it('carries the window the request named', async () => {
		const { seen, event } = loadEvent(files(10), '?limit=10&offset=40');

		const result = (await load(event)) as Loaded;

		expect(seen[0]).toContain('offset=40');
		expect(result.limit).toBe(10);
		expect(result.offset).toBe(40);
	});

	// The probe row answers "is there another page" against an endpoint that
	// states no count. It is never rendered.
	it('keeps the probe row out of the grid', async () => {
		const { event } = loadEvent(files(61), '?limit=60');

		const result = (await load(event)) as Loaded;

		expect(rows(result)).toHaveLength(60);
		expect(result.hasMore).toBe(true);
	});

	it('reports the end of the library when no probe row came back', async () => {
		const { event } = loadEvent(files(12), '?limit=60');

		const result = (await load(event)) as Loaded;

		expect(rows(result)).toHaveLength(12);
		expect(result.hasMore).toBe(false);
	});

	// An endpoint that ignores the window still gets bounded, because the slice
	// happens on this side of the call.
	it('bounds a response that ignored the window', async () => {
		const { event } = loadEvent(files(10_000), '?limit=60');

		const result = (await load(event)) as Loaded;

		expect(rows(result)).toHaveLength(60);
	});

	it('states a total only when the endpoint sent one', async () => {
		const bare = loadEvent(files(10));
		expect(((await load(bare.event)) as Loaded).total).toBeNull();

		const counted = loadEvent({ data: files(10), total_count: 4210 });
		expect(((await load(counted.event)) as Loaded).total).toBe(4210);
	});

	it('keeps a failed read as a failure rather than an empty library', async () => {
		const fetch = vi.fn(async () => json({ error: 'nope' }, 500)) as unknown as typeof globalThis.fetch;
		const event = {
			fetch,
			cookies: mockCookies(),
			url: new URL('http://localhost/admin/media'),
			parent: async () => ({ user: { roles: ['super_admin'] } }),
		} as never;

		const result = (await load(event)) as Loaded;

		expect(result.items.ok).toBe(false);
		if (!result.items.ok) expect(result.items.gate.state).toBe('error');
		expect(result.hasMore).toBe(false);
		expect(result.total).toBeNull();
	});

	it('says the role was refused when the engine answers 403', async () => {
		const fetch = vi.fn(async () => json({ error: 'forbidden' }, 403)) as unknown as typeof globalThis.fetch;
		const event = {
			fetch,
			cookies: mockCookies(),
			url: new URL('http://localhost/admin/media'),
			parent: async () => ({ user: { roles: ['editor'] } }),
		} as never;

		const result = (await load(event)) as Loaded;

		expect(result.items).toEqual({ ok: false, gate: { state: 'forbidden' } });
	});

	/*
	 * The empty state says the library has nothing in it and carries no control
	 * to leave with, so an offset past the end would tell an operator their
	 * files are gone and strand them there. Asserted against the loader rather
	 * than the arithmetic behind it: a correction nothing calls is a correction
	 * that does not happen.
	 */
	it('sends a request past the end back to the last page that has rows', async () => {
		const { event } = loadEvent(
			{ data: [], total_count: 45 },
			'?limit=20&offset=200&folder=logos'
		);

		// rejects rather than a caught value: a load that returned instead of
		// correcting would satisfy any assertion written about what it threw.
		// The folder survives the correction, because rebuilding the query from a
		// named list of parameters is how a corrected page loses the filter it
		// was being corrected within.
		await expect(load(event)).rejects.toMatchObject({
			status: 307,
			location: '/admin/media?limit=20&offset=40&folder=logos'
		});
	});

	it('renders an empty library rather than correcting it', async () => {
		const { event } = loadEvent({ data: [], total_count: 0 });
		const result = (await load(event)) as Loaded;
		expect(result.items).toEqual({ ok: true, value: [] });
	});

	// The list route has no text filter, so a search is a different request
	// with a different answer shape, and the page has to read both alike.
	describe('with a search term', () => {
		it('asks the search endpoint, newest first, for the same window', async () => {
			const { seen, inits, event } = loadEvent({ items: files(3), total: 3 }, '?q=invoice&limit=10');

			const result = (await load(event)) as Loaded;

			expect(seen[0]).toContain('/api/admin/media/search');
			expect(inits[0]?.method).toBe('POST');
			const sent = JSON.parse(String(inits[0]?.body)) as Record<string, unknown>;
			expect(sent.query).toBe('invoice');
			expect(sent.limit).toBe(11);
			expect(sent.offset).toBe(0);
			expect(sent.sort_by).toBe('created_at');
			expect(sent.sort_desc).toBe(true);
			expect(rows(result)).toHaveLength(3);
			expect(result.total).toBe(3);
			expect(result.q).toBe('invoice');
		});

		it('keeps the list route when the term is blank', async () => {
			const { seen, event } = loadEvent(files(2), '?q=%20%20');

			const result = (await load(event)) as Loaded;

			expect(seen[0]).toContain('/api/admin/media?');
			expect(result.q).toBe('');
		});

		it('says the outage when the search does not answer', async () => {
			const fetch = vi.fn(async () => json({ error: 'search failed' }, 503)) as unknown as typeof globalThis.fetch;
			const event = {
				fetch,
				cookies: mockCookies(),
				url: new URL('http://localhost/admin/media?q=x'),
				parent: async () => ({ user: { roles: ['super_admin'] } }),
			} as never;

			const result = (await load(event)) as Loaded;

			expect(result.items).toEqual({ ok: false, gate: { state: 'unavailable' } });
		});
	});
});

type Failure = { status: number; data: Record<string, unknown> };

/** An action event whose fetch answers every call with `answer` and records it. */
function actionEvent(fields: Record<string, string>, answer: () => Response = () => json({})) {
	const calls: { method: string; path: string; body: unknown }[] = [];
	const fetch = vi.fn(async (path: string, init?: RequestInit) => {
		calls.push({ method: init?.method ?? 'GET', path, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
		return answer();
	}) as unknown as typeof globalThis.fetch;
	const fd = new FormData();
	fd.set('confirmed', 'yes');
	for (const [k, v] of Object.entries(fields)) fd.set(k, v);
	return { event: { fetch, cookies: mockCookies(), request: { formData: async () => fd, clone: () => ({ formData: async () => fd }) } } as never, calls };
}

describe('deleting a file', () => {
	// The preview drawer posts the delete. Before the page hydrates, it posts
	// with no question asked.
	it('deletes nothing on a post that skipped the question', async () => {
		const fetch = vi.fn();
		const body = new FormData();
		body.set('id', 'm1');
		const url = new URL('http://admin/admin/media?/delete');
		const out = await actions.delete({ fetch, cookies: mockCookies(), url, request: new Request(url, { method: 'POST', body }) } as never);
		expect(fetch).not.toHaveBeenCalled();
		expect(out).toMatchObject({ unconfirmed: { question: 'Delete this file?', label: 'Delete', action: '/admin/media?/delete', fields: [['id', 'm1']] } });
	});

	it('deletes the file it names', async () => {
		const { event, calls } = actionEvent({ id: 'm 1' }, () => new Response(null, { status: 204 }));
		expect(await actions.delete(event)).toBeUndefined();
		expect(calls).toEqual([{ method: 'DELETE', path: '/api/admin/media/m%201', body: undefined }]);
	});

	// The delete is asked from the preview drawer, which stays open on a
	// refusal, so the failure names its file for that drawer to show.
	it('returns a refusal against the file it was for', async () => {
		const { event } = actionEvent({ id: 'm1' }, () => json({ error: 'media is referenced by a content entry', code: 'conflict' }, 409));
		const out = (await actions.delete(event)) as Failure;
		expect(out.data).toEqual({ deleteError: 'media is referenced by a content entry', deleteId: 'm1' });
	});

	it('keeps outage detail out of the message', async () => {
		const { event } = actionEvent({ id: 'm1' }, () => json({ error: 'pq: down' }, 503));
		expect(((await actions.delete(event)) as Failure).data).toEqual({ deleteError: 'Could not delete the file. Try again.', deleteId: 'm1' });
	});

	it('names no file at the top of the page when none was sent', async () => {
		const { event, calls } = actionEvent({});
		expect(((await actions.delete(event)) as Failure).data).toEqual({ error: 'This form is missing its file. Reload the page and try again.' });
		expect(calls).toEqual([]);
	});
});

describe('importing a file from an address', () => {
	it('sends the address, the alt text and the publish choice', async () => {
		const { event, calls } = actionEvent({ url: 'https://example.com/a.png', alt_text: 'A', public: 'true' }, () => json({ id: 'm9' }, 201));
		expect(await actions.importUrl(event)).toEqual({ imported: { id: 'm9' } });
		expect(calls[0]).toMatchObject({ method: 'POST', body: { url: 'https://example.com/a.png', alt_text: 'A', public: true } });
	});

	it('refuses an address that is not http or https before it reaches the plugin', async () => {
		const { event, calls } = actionEvent({ url: 'file:///etc/passwd' });
		expect(((await actions.importUrl(event)) as Failure).data).toEqual({ importError: 'Enter an http or https address.' });
		expect(calls).toEqual([]);
	});

	it('relays the reason the plugin refused', async () => {
		const { event } = actionEvent({ url: 'https://example.com/a.png' }, () => json({ error: 'file type not allowed', code: 'http_415' }, 415));
		expect(((await actions.importUrl(event)) as Failure).data.importError).toContain('file type not allowed');
	});

	it('keeps outage detail out of the message', async () => {
		const { event } = actionEvent({ url: 'https://example.com/a.png' }, () => json({ error: 'pq: down' }, 503));
		expect(((await actions.importUrl(event)) as Failure).data.importError).toBe('Could not import the file. Try again.');
	});
});

describe('describing an image', () => {
	const describe503 = () => json({ error: 'no enabled AI provider configured' }, 503);

	it('says no AI provider is enabled instead of that nothing came back', async () => {
		const { event } = actionEvent({ id: 'm1' }, describe503);
		const out = (await actions.describe(event)) as Failure;
		expect(out.data.detailsError).toMatch(/^No AI provider is enabled/);
		expect(out.data.detailsId).toBe('m1');
	});

	it('tells a spent budget from a license that leaves AI out', async () => {
		const budget = actionEvent({ id: 'm1' }, () => json({ error: 'ai budget exhausted for this billing period' }, 402));
		expect(((await actions.describe(budget.event)) as Failure).data.detailsError).toMatch(/budget for this billing period is used up/);

		const license = actionEvent({ id: 'm1' }, () =>
			json({ error: 'payment_required', plugin: 'ai', feature: 'feature:ai', upgrade_url: '' }, 402),
		);
		expect(((await actions.describe(license.event)) as Failure).data.detailsError).toBe(
			'This is not enabled on this engine. Nothing was changed.',
		);
	});

	it('still says the outage plainly when the engine itself is down', async () => {
		const { event } = actionEvent({ id: 'm1' }, () => json({ error: 'database unavailable' }, 503));
		expect(((await actions.describe(event)) as Failure).data.detailsError).toBe('Could not suggest alt text. Try again.');
	});
});

