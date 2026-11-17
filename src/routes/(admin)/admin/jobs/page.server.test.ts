import { describe, it, expect, vi } from 'vitest';
import type { Cookies } from '@sveltejs/kit';

import { load } from './+page.server';
import { signedIn } from '#lib/server/test-support/signed-in.ts';

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

function jobs(count: number, from = 0) {
	return Array.from({ length: count }, (_, i) => ({
		id: `j${from + i}`,
		name: `job-${from + i}`,
		description: '',
		schedule: '0 * * * *',
		endpoint: 'https://example.test/hook',
		payload: null,
		enabled: true,
		last_run_at: null,
		last_status: null,
		created_at: '2026-01-01T00:00:00Z',
		updated_at: '2026-01-01T00:00:00Z',
	}));
}

function loadEvent(body: unknown, search = '', roles = ['super_admin']) {
	const seen: string[] = [];
	const fetch = vi.fn(async (url: string) => {
		seen.push(String(url));
		return json(body);
	}) as unknown as typeof globalThis.fetch;

	return {
		seen,
		event: {
			fetch: signedIn(fetch, { roles }),
			cookies: mockCookies(),
			url: new URL(`http://localhost/admin/jobs${search}`),
		} as never,
	};
}

type Loaded = Exclude<Awaited<ReturnType<typeof load>>, void>;

/*
 * The list asks for a bounded window. Neither shape this endpoint answers with
 * carries a row count, so there is no total to state and a numbered pager
 * could only be built by inventing one.
 */
describe('admin/jobs/+page.server.ts load', () => {
	it('asks the endpoint for a bounded window', async () => {
		const { seen, event } = loadEvent(jobs(5));

		await load(event);

		expect(seen[0]).toContain('limit=');
		expect(seen[0]).toContain('offset=0');
	});

	it('carries the window the request named', async () => {
		const { seen, event } = loadEvent(jobs(5), '?limit=10&offset=20');

		const result = (await load(event)) as Loaded;

		expect(seen[0]).toContain('offset=20');
		expect(result.limit).toBe(10);
		expect(result.offset).toBe(20);
	});

	it('keeps the probe row out of the table', async () => {
		const { event } = loadEvent(jobs(51), '?limit=50');

		const result = (await load(event)) as Loaded;

		expect(result.jobs.value).toHaveLength(50);
		expect(result.hasMore).toBe(true);
	});

	it('reports the end of the list when no probe row came back', async () => {
		const { event } = loadEvent(jobs(7), '?limit=50');

		const result = (await load(event)) as Loaded;

		expect(result.hasMore).toBe(false);
	});

	// The endpoint answers with a bare array or with a `jobs` wrapper. Reading
	// the wrapper that is not there resolves to undefined and renders an empty
	// list.
	it('bounds the wrapped shape as well as the bare one', async () => {
		const { event } = loadEvent({ jobs: jobs(51) }, '?limit=50');

		const result = (await load(event)) as Loaded;

		expect(result.jobs.value).toHaveLength(50);
		expect(result.hasMore).toBe(true);
	});

	it('bounds a response that ignored the window', async () => {
		const { event } = loadEvent(jobs(10_000), '?limit=50');

		const result = (await load(event)) as Loaded;

		expect(result.jobs.value).toHaveLength(50);
	});
});

/*
 * A list that could not be read is not an empty list. The first-run state
 * offers to create the first job, which is the wrong thing to say to a reader
 * whose engine is down or whose role was refused.
 */
describe('admin/jobs/+page.server.ts load when the list cannot be read', () => {
	function failing(answer: () => Response, search = '') {
		const fetch = vi.fn(async () => answer()) as unknown as typeof globalThis.fetch;
		return {
			fetch: signedIn(fetch, { roles: ['super_admin'] }),
			// The page's own calls, without the session check.
			asked: fetch,
			cookies: mockCookies(),
			url: new URL(`http://localhost/admin/jobs${search}`),
		} as never;
	}

	it('keeps an empty list a list that answered', async () => {
		const result = (await load(loadEvent([]).event)) as Loaded;
		expect(result.jobs).toEqual({ ok: true, value: [] });
	});

	it('reads a 503 as an outage', async () => {
		const result = (await load(failing(() => json({ error: 'database unavailable' }, 503)))) as Loaded;
		expect(result.jobs).toEqual({ ok: false, gate: { state: 'unavailable' } });
	});

	it('reads an engine that did not answer at all as the same outage', async () => {
		const result = (await load(
			failing(() => {
				throw new TypeError('fetch failed');
			}),
		)) as Loaded;
		expect(result.jobs).toEqual({ ok: false, gate: { state: 'unavailable' } });
	});

	it('reads a 403 as the role', async () => {
		const result = (await load(failing(() => json({ error: 'insufficient permissions' }, 403)))) as Loaded;
		expect(result.jobs).toEqual({ ok: false, gate: { state: 'forbidden' } });
	});

	it('reads a 404 as a build without the route', async () => {
		const result = (await load(failing(() => json({ error: 'not found' }, 404)))) as Loaded;
		expect(result.jobs).toEqual({ ok: false, gate: { state: 'absent' } });
	});

	it('says anything else failed, in words that are not a report of none, and keeps the engine\'s out', async () => {
		const result = (await load(failing(() => json({ error: 'pq: relation "sys_jobs" does not exist' }, 500)))) as Loaded;
		expect(result.jobs).toEqual({
			ok: false,
			gate: { state: 'error', message: 'Could not load jobs.' },
		});
		expect(JSON.stringify(result)).not.toContain('pq:');
	});

	it('opens no drawer over a list it could not read', async () => {
		const asked = (await load(failing(() => json({ error: 'down' }, 503), '?new=1'))) as Loaded;
		expect(asked.openNew).toBe(false);
		const event = failing(() => json({ error: 'down' }, 503), '?edit=j9');
		const editing = (await load(event)) as Loaded;
		expect(editing.openJob).toBeNull();
		expect((event as { asked: ReturnType<typeof vi.fn> }).asked).toHaveBeenCalledTimes(1);
	});

	it('keeps the window the request named', async () => {
		const result = (await load(failing(() => json({ error: 'down' }, 503), '?limit=10&offset=20'))) as Loaded;
		expect(result.limit).toBe(10);
		expect(result.offset).toBe(20);
		expect(result.hasMore).toBe(false);
	});
});

/*
 * The drawer is addressable, so a link can open it on a job. A job on the page
 * is taken from the page. One off it is read on its own, because the link
 * from the dashboard names a job without knowing which page it sits on.
 */
describe('admin/jobs/+page.server.ts load opens the drawer from the address', () => {
	function routed(search: string, byId: unknown) {
		const fetch = vi.fn(async (url: string) =>
			/\/api\/admin\/jobs\/[^?]+$/.test(String(url)) ? json(byId) : json(jobs(2))
		) as unknown as typeof globalThis.fetch;
		return {
			fetch: signedIn(fetch, { roles: ['super_admin'] }),
			// The page's own calls, without the session check.
			asked: fetch,
			cookies: mockCookies(),
			url: new URL(`http://localhost/admin/jobs${search}`),
		} as never;
	}

	it('opens nothing without a query', async () => {
		const result = (await load(routed('', null))) as Loaded;
		expect(result.openNew).toBe(false);
		expect(result.openJob).toBeNull();
	});

	it('asks for a new job', async () => {
		const result = (await load(routed('?new=1', null))) as Loaded;
		expect(result.openNew).toBe(true);
	});

	it('takes a job on the page from the page', async () => {
		const event = routed('?edit=j1', null);
		const result = (await load(event)) as Loaded;
		expect(result.openJob?.id).toBe('j1');
		expect((event as { asked: ReturnType<typeof vi.fn> }).asked).toHaveBeenCalledTimes(1);
	});

	it('reads a job off the page on its own', async () => {
		const result = (await load(routed('?edit=j9', jobs(1, 9)[0]))) as Loaded;
		expect(result.openJob?.id).toBe('j9');
	});

	it('opens nothing for a job that does not exist, and says so', async () => {
		const result = (await load(routed('?edit=nope', { error: 'not found' }))) as Loaded;
		expect(result.openJob).toBeNull();
		expect(result.openGate).toEqual({ state: 'absent' });
	});

	// A link that opened nothing said nothing, so a failed read of the job
	// looked like a link that does nothing.
	it('keeps a failed read of the linked job as its gate', async () => {
		const fetch = vi.fn(async (url: string) =>
			/\/api\/admin\/jobs\/[^?]+$/.test(String(url)) ? json({ error: 'down' }, 503) : json(jobs(2))
		) as unknown as typeof globalThis.fetch;
		const result = (await load({
			fetch: signedIn(fetch, { roles: ['super_admin'] }),
			cookies: mockCookies(),
			url: new URL('http://localhost/admin/jobs?edit=j9'),
		} as never)) as Loaded;
		expect(result.openJob).toBeNull();
		expect(result.openGate).toEqual({ state: 'unavailable' });
	});

	it('reports no failure for a job it opened', async () => {
		const result = (await load(routed('?edit=j9', jobs(1, 9)[0]))) as Loaded;
		expect(result.openGate).toBeNull();
	});
});
