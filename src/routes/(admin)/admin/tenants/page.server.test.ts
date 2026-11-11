import { describe, it, expect, vi } from 'vitest';
import type { Cookies } from '@sveltejs/kit';

import { actions, load } from './+page.server';
import { signedIn } from '$lib/server/test-support/signed-in';

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

function tenants(count: number, from = 0) {
	return Array.from({ length: count }, (_, i) => ({
		id: `t${from + i}`,
		slug: `tenant-${from + i}`,
		name: `Tenant ${from + i}`,
		plan: 'example',
		enabled: true,
		archived: false,
		created_at: '2026-01-01T00:00:00Z',
		updated_at: '2026-01-01T00:00:00Z',
	}));
}

/** A load event whose fetch answers with `body` and records the URL asked for. */
function loadEvent(body: unknown, search = '') {
	const seen: string[] = [];
	const fetch = vi.fn(async (url: string) => {
		seen.push(String(url));
		return json(body);
	}) as unknown as typeof globalThis.fetch;

	return {
		seen,
		event: {
			fetch: signedIn(fetch, { roles: ['super_admin'] }),
			cookies: mockCookies(),
			url: new URL(`http://localhost/admin/tenants${search}`),
		} as never,
	};
}

/**
 * The load's declared return includes void, because the 403 path returns
 * through error(). Every case here is a success path, so the result is narrowed
 * once rather than at each assertion.
 */
type Loaded = Exclude<Awaited<ReturnType<typeof load>>, void>;
const run = async (event: never): Promise<Loaded> => (await load(event)) as Loaded;

describe('admin/tenants load', () => {
	// The envelope carries total_count, and without it the page would
	// describe one server page as the whole instance.
	it('surfaces the count the API already returned', async () => {
		const { event } = loadEvent({ data: tenants(50), total_count: 731 });

		const result = await run(event);

		expect(result.total).toBe(731);
		expect(result.tenants).toMatchObject({ ok: true });
		expect(result.tenants.ok && result.tenants.value).toHaveLength(50);
	});

	it('defaults to the engine page size and the first page', async () => {
		const { event, seen } = loadEvent({ data: tenants(50), total_count: 731 });

		const result = await run(event);

		expect(result.limit).toBe(50);
		expect(result.offset).toBe(0);
		expect(seen[0]).toContain('limit=50');
		expect(seen[0]).toContain('offset=0');
	});

	it('carries the requested page through to the engine', async () => {
		const { event, seen } = loadEvent({ data: tenants(50, 100), total_count: 731 }, '?limit=50&offset=100');

		const result = await run(event);

		expect(result.offset).toBe(100);
		expect(seen[0]).toContain('offset=100');
	});

	// Asking past the engine's ceiling comes back clamped with nothing saying
	// so, which is a short page the caller reads as the end of the collection.
	it('never asks for more rows than the engine will serve', async () => {
		const { event, seen } = loadEvent({ data: tenants(500), total_count: 731 }, '?limit=5000');

		const result = await run(event);

		expect(result.limit).toBe(500);
		expect(seen[0]).toContain('limit=500');
	});

	it('refuses a negative offset rather than passing it on', async () => {
		const { event } = loadEvent({ data: tenants(50), total_count: 731 }, '?offset=-10');

		const result = await run(event);

		expect(result.offset).toBe(0);
	});

	// A response that omits the count would otherwise report fewer tenants than
	// the reader has already paged past.
	it('keeps what has been read as the floor under a missing count', async () => {
		const { event } = loadEvent({ data: tenants(50, 700) }, '?limit=50&offset=700');

		const result = await run(event);

		expect(result.total).toBe(750);
	});

	// An empty list is the first-run state with an offer to create the first
	// tenant. A read that failed is a gate, never that state.
	it('keeps an unreachable engine as an outage, never as no tenants', async () => {
		const fetch = vi.fn(async () => {
			throw new TypeError('fetch failed');
		}) as unknown as typeof globalThis.fetch;

		const result = await run({
			fetch: signedIn(fetch, { roles: ['super_admin'] }),
			cookies: mockCookies(),
			url: new URL('http://localhost/admin/tenants'),
		} as never);

		expect(result.tenants).toEqual({ ok: false, gate: { state: 'unavailable' } });
		expect(result.canProvision).toBe(false);
	});

	it('keeps a refused or failed list read as its gate', async () => {
		const refuse = (status: number) => {
			const fetch = vi.fn(async (url: string) =>
				String(url).includes('/provisioning') ? json({ enabled: true }) : json({ error: 'no' }, status),
			) as unknown as typeof globalThis.fetch;
			return run({
				fetch: signedIn(fetch, { roles: ['super_admin'] }),
				cookies: mockCookies(),
				url: new URL('http://localhost/admin/tenants'),
			} as never);
		};
		expect((await refuse(403)).tenants).toEqual({ ok: false, gate: { state: 'forbidden' } });
		expect((await refuse(503)).tenants).toEqual({ ok: false, gate: { state: 'unavailable' } });
		expect((await refuse(500)).tenants).toMatchObject({ ok: false, gate: { state: 'error' } });
	});

	it('throws 403 for anyone but a super_admin', async () => {
		const { event } = loadEvent({ data: [], total_count: 0 });
		const page = vi.fn(async () => new Response('{}')) as unknown as typeof globalThis.fetch;

		await expect(
			load({
				...(event as object),
				fetch: signedIn(page, { roles: ['admin'] }),
			} as never)
		).rejects.toThrow();
	});
});

/*
 * Each refused rule marks the control it is about, so the operator never has
 * to work out which of two controls a single banner meant.
 */
describe('admin/tenants/+page.server.ts actions.create', () => {
	function createEvent(fields: Record<string, string>) {
		const form = new FormData();
		for (const [key, value] of Object.entries(fields)) form.append(key, value);
		// requireRole reads the session through getMe before the action runs, so
		// the event's own fetch has to answer that call for the validation below
		// to be what is under test.
		const fetch = vi.fn(async () =>
			json({ id: 'u1', email: 'admin@b.co', roles: ['super_admin'] })
		) as unknown as typeof globalThis.fetch;

		return {
			request: { formData: async () => form },
			fetch,
			cookies: mockCookies(),
			url: new URL('http://localhost/admin/tenants'),
		} as never;
	}

	it('names the control that was rejected', async () => {
		const result = await actions.create(createEvent({ name: 'ACME Corp' }));

		expect(result).toEqual({
			status: 400,
			data: {
				action: 'create',
				error: 'Check the highlighted fields.',
				fields: { slug: 'Enter a slug.' },
			},
		});
	});

	it('names both controls when both were rejected', async () => {
		const result = await actions.create(createEvent({}));

		expect(result).toEqual({
			status: 400,
			data: {
				action: 'create',
				error: 'Check the highlighted fields.',
				fields: { slug: 'Enter a slug.', name: 'Enter a display name.' },
			},
		});
	});

	it('treats whitespace as absent', async () => {
		const result = await actions.create(createEvent({ slug: '   ', name: 'ACME Corp' }));

		expect(result).toMatchObject({ data: { fields: { slug: 'Enter a slug.' } } });
	});

	/** The body the action posted to create the tenant. */
	function sentBody(event: unknown): Record<string, unknown> {
		const calls = (event as { fetch: { mock: { calls: [unknown, RequestInit | undefined][] } } }).fetch.mock.calls;
		const post = calls.find(([, init]) => init?.method === 'POST');
		return JSON.parse(String(post?.[1]?.body));
	}

	it('leaves the plan to the engine when none is typed', async () => {
		const event = createEvent({ slug: 'acme', name: 'ACME Corp', plan: '  ' });
		await actions.create(event);

		expect(sentBody(event)).not.toHaveProperty('plan');
	});

	/** A create event whose POST answers the refusal body with a 402. */
	function refusedEvent(body: unknown) {
		const form = new FormData();
		form.append('slug', 'acme');
		form.append('name', 'ACME Corp');
		const fetch = vi.fn(async (_url: string, init?: RequestInit) =>
			init?.method === 'POST' ? json(body, 402) : json({ id: 'u1', email: 'admin@b.co', roles: ['super_admin'] })
		) as unknown as typeof globalThis.fetch;
		return {
			request: { formData: async () => form },
			fetch,
			cookies: mockCookies(),
			url: new URL('http://localhost/admin/tenants'),
		} as never;
	}

	it('returns a missing capability as a refusal with the link the plugin sent', async () => {
		const link = 'https://shop.example.com/pricing?skus=example-pro&utm_campaign=example';
		const result = await actions.create(
			refusedEvent({ error: 'payment_required', plugin: 'example', feature: 'feature:example_feature', upgrade_url: link })
		);

		expect(result).toMatchObject({
			status: 402,
			data: { refused: { kind: 'feature', feature: 'example-feature', upgradeUrl: link } },
		});
		expect((result as { data: { error: string } }).data.error).toBe('This is not enabled on this engine. Nothing was changed.');
	});

	it('returns the tenant ceiling as a limit reached with the link the plugin sent', async () => {
		const link = 'https://shop.example.com/pricing?plan=larger&utm_campaign=tenants';
		const result = await actions.create(
			refusedEvent({ error: 'tenant quota reached (1); upgrade your plan to add more tenants', upgrade_url: link })
		);

		expect(result).toMatchObject({
			status: 402,
			data: { refused: { kind: 'cap', cap: 'tenants', limit: null, current: null, upgradeUrl: link } },
		});
		expect((result as { data: { error: string } }).data.error).toContain("You've reached the limit for tenants.");
	});

	it('sends the plan as typed', async () => {
		const event = createEvent({ slug: 'acme', name: 'ACME Corp', plan: 'standard' });
		await actions.create(event);

		expect(sentBody(event).plan).toBe('standard');
	});
});

describe('admin/tenants load provisioning', () => {
	function eventFor(provisioning: () => Response) {
		const fetch = vi.fn(async (url: string) =>
			String(url).includes('/tenants/provisioning') ? provisioning() : json({ data: tenants(1), total_count: 1 })
		) as unknown as typeof globalThis.fetch;
		return {
			fetch: signedIn(fetch, { roles: ['super_admin'] }),
			cookies: mockCookies(),
			url: new URL('http://localhost/admin/tenants'),
		} as never;
	}

	it('takes from the plugin whether a tenant may be created', async () => {
		expect((await run(eventFor(() => json({ enabled: true })))).canProvision).toBe(true);
		expect((await run(eventFor(() => json({ enabled: false })))).canProvision).toBe(false);
	});

	it('carries the link a read that says no names, and none when it says yes', async () => {
		const link = 'https://shop.example.com/pricing?skus=example-pro&utm_campaign=example';
		expect(await run(eventFor(() => json({ enabled: false, upgrade_url: link })))).toMatchObject({
			canProvision: false,
			provisioningUrl: link,
		});
		expect(await run(eventFor(() => json({ enabled: true, upgrade_url: link })))).toMatchObject({
			canProvision: true,
			provisioningUrl: '',
		});
		expect((await run(eventFor(() => json({ error: 'unavailable' }, 503)))).provisioningUrl).toBe('');
	});

	// The refusal carries the link that lifts it, as a read that says no does.
	it('carries the link a refused provisioning read names', async () => {
		const link = 'https://shop.example.com/pricing?skus=example-pro';
		expect(await run(eventFor(() => json({ error: 'payment_required', upgrade_url: link }, 402)))).toMatchObject({
			canProvision: false,
			provisionGate: null,
			provisioningUrl: link,
		});
	});

	it('reads a refusal as not enabled', async () => {
		expect(await run(eventFor(() => json({ error: 'payment_required' }, 402)))).toMatchObject({ canProvision: false, provisionGate: null });
	});

	// A route that is not served says nothing about the license, so the page
	// has to tell it apart from a refusal.
	it('keeps a plugin without the provisioning route as its own gate', async () => {
		expect(await run(eventFor(() => json({ error: 'not found' }, 404)))).toMatchObject({ canProvision: false, provisionGate: { state: 'absent' }, total: 1 });
	});

	// An outage says nothing about the license, so it is never drawn as
	// creating not being enabled.
	it('keeps a provisioning read that did not answer as its gate', async () => {
		const result = await run(eventFor(() => json({ error: 'unavailable' }, 503)));
		expect(result).toMatchObject({ canProvision: false, provisionGate: { state: 'unavailable' }, total: 1 });
		const busy = await run(eventFor(() => json({ error: 'slow down' }, 429)));
		expect(busy.provisionGate).toEqual({ state: 'busy' });
	});
});

/*
 * A page past the end draws the first-run state, which says the instance has
 * no tenants. A bookmark or a delete leaves such an offset behind.
 */
describe('admin/tenants load past the end', () => {
	it('sends a page past the end back to the last page that holds rows', async () => {
		const { event } = loadEvent({ data: [], total_count: 120 }, '?limit=50&offset=500');
		await expect(load(event)).rejects.toMatchObject({ status: 307, location: '/admin/tenants?limit=50&offset=100' });
	});

	it('renders an empty first page as it is', async () => {
		const { event } = loadEvent({ data: [], total_count: 0 });
		const result = await run(event);
		expect(result.tenants).toEqual({ ok: true, value: [] });
	});
});

/** An action event whose fetch answers the session read, then `answer` for the write. */
function writeEvent(
	fields: Record<string, string>,
	answer: (url: string, init?: RequestInit) => Response,
	roles = ['super_admin'],
) {
	const form = new FormData();
	form.set('confirmed', 'yes');
	for (const [key, value] of Object.entries(fields)) form.append(key, value);
	const fetch = vi.fn(async (url: string, init?: RequestInit) =>
		init?.method && init.method !== 'GET'
			? answer(String(url), init)
			: json({ id: 'u1', email: 'admin@b.co', roles })
	) as unknown as typeof globalThis.fetch;
	return {
		request: { formData: async () => form, clone: () => ({ formData: async () => form }) },
		fetch,
		cookies: mockCookies(),
		url: new URL('http://localhost/admin/tenants'),
	} as never;
}

/** The body of the one write the action sent. */
function writtenBody(event: unknown): Record<string, unknown> {
	const calls = (event as { fetch: { mock: { calls: [unknown, RequestInit | undefined][] } } }).fetch.mock.calls;
	const write = calls.find(([, init]) => init?.method && init.method !== 'GET');
	return JSON.parse(String(write?.[1]?.body));
}

describe('admin/tenants create refusals', () => {
	it('puts a slug the engine refuses on the Slug field', async () => {
		const message = 'invalid slug: must be lowercase alphanumeric + underscore, 1-63 chars, starting with a letter';
		const result = await actions.create(
			writeEvent({ slug: 'acme-corp', name: 'ACME' }, () => json({ error: message }, 400))
		);
		expect(result).toEqual({
			status: 400,
			data: {
				action: 'create',
				error: 'Check the highlighted fields.',
				fields: { slug: 'Use lowercase letters, digits and underscores, starting with a letter, in at most 63 characters.' },
			},
		});
	});

	it('renders a license refusal through the refusal notice, never as its code', async () => {
		const result = await actions.create(
			writeEvent({ slug: 'acme', name: 'ACME' }, () =>
				json({ error: 'payment_required', plugin: 'example', feature: 'feature:example_feature', upgrade_url: '' }, 402)
			)
		);
		expect(result).toMatchObject({
			status: 402,
			data: { action: 'create', refused: { kind: 'feature', feature: 'example-feature' } },
		});
		expect(JSON.stringify(result)).not.toContain('payment_required');
	});
});

describe('admin/tenants update, toggle and delete', () => {
	const tenant = { id: 't1', slug: 'acme', name: 'ACME', plan: 'free', enabled: true };

	it('sends the plan a create with none gets when the field is emptied', async () => {
		const event = writeEvent({ id: 't1', name: 'ACME', plan: '  ' }, () => json(tenant));
		await actions.update(event);
		expect(writtenBody(event)).toEqual({ name: 'ACME', plan: 'free' });
	});

	it('sends the plan as typed on an edit', async () => {
		const event = writeEvent({ id: 't1', name: 'ACME', plan: 'gold' }, () => json(tenant));
		await actions.update(event);
		expect(writtenBody(event)).toEqual({ name: 'ACME', plan: 'gold' });
	});

	it('flips the enabled state it was handed', async () => {
		const event = writeEvent({ id: 't1', enabled: 'true' }, () => json(tenant));
		await actions.toggle(event);
		expect(writtenBody(event)).toEqual({ enabled: false });
	});

	it('names the action that failed, for each write', async () => {
		const refuse = () => json({ error: 'tenant not found', code: 'not_found' }, 404);
		expect(await actions.update(writeEvent({ id: 't1', name: 'ACME' }, refuse))).toEqual({
			status: 400,
			data: { action: 'update', error: 'tenant not found' },
		});
		expect(await actions.toggle(writeEvent({ id: 't1', enabled: 'true' }, refuse))).toMatchObject({
			data: { action: 'toggle', error: 'tenant not found' },
		});
		expect(await actions.delete(writeEvent({ id: 't1' }, refuse))).toMatchObject({
			data: { action: 'delete', error: 'tenant not found' },
		});
	});

	it('keeps driver text out of an outage on delete', async () => {
		const result = await actions.delete(writeEvent({ id: 't1' }, () => json({ error: 'pq: connection refused' }, 503)));
		expect(result).toEqual({ status: 400, data: { action: 'delete', error: 'Could not delete the tenant. Try again.' } });
	});

	it('names the direction of a toggle that failed', async () => {
		const outage = () => json({ error: 'pq: connection refused' }, 503);
		expect(await actions.toggle(writeEvent({ id: 't1', enabled: 'true' }, outage))).toEqual({
			status: 400,
			data: { action: 'toggle', error: 'Could not disable the tenant. Try again.' },
		});
		expect(await actions.toggle(writeEvent({ id: 't1', enabled: 'false' }, outage))).toEqual({
			status: 400,
			data: { action: 'toggle', error: 'Could not enable the tenant. Try again.' },
		});
	});

	it('deletes a tenant the engine accepts', async () => {
		const event = writeEvent({ id: 't1' }, () => new Response(null, { status: 204 }));
		expect(await actions.delete(event)).toBeUndefined();
	});

	it.each(['create', 'update', 'toggle', 'delete'] as const)('refuses %s to an admin', async (name) => {
		const answer = vi.fn(() => json({}));
		const event = writeEvent({ id: 't1', slug: 'acme', name: 'ACME', enabled: 'true' }, answer, ['admin']);
		await expect(actions[name](event)).rejects.toMatchObject({ status: 403 });
		expect(answer).not.toHaveBeenCalled();
	});
});
