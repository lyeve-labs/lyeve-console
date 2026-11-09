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

function hooks(count: number, from = 0) {
	return Array.from({ length: count }, (_, i) => ({
		id: `w${from + i}`,
		name: `hook-${from + i}`,
		url: 'https://example.test/hook',
		events: ['content.created'],
		schemas: [],
		enabled: true,
		created_at: '2026-01-01T00:00:00Z',
		updated_at: '2026-01-01T00:00:00Z',
	}));
}

/**
 * The load reads the webhooks and the schemas in parallel. The schema request
 * is answered with an empty array so each case is about the list under test.
 */
function loadEvent(body: unknown, search = '') {
	const seen: string[] = [];
	const fetch = vi.fn(async (url: string) => {
		const asked = String(url);
		seen.push(asked);
		if (asked.includes('/schemas')) return json([]);
		return json(body);
	}) as unknown as typeof globalThis.fetch;

	return {
		seen,
		event: {
			fetch,
			cookies: mockCookies(),
			url: new URL(`http://localhost/admin/webhooks${search}`),
			parent: async () => ({ user: { roles: ['super_admin'] } }),
		} as never,
	};
}

type Loaded = Exclude<Awaited<ReturnType<typeof load>>, void>;

const webhookCall = (seen: string[]) => seen.find((u) => u.includes('/webhooks')) ?? '';

/*
 * The request always carries a limit and an offset. The read goes straight to
 * the client rather than through listWebhooks, which unwraps the rows and
 * drops the envelope the row count sits in.
 */
describe('admin/webhooks/+page.server.ts load', () => {
	it('asks the endpoint for a bounded window', async () => {
		const { seen, event } = loadEvent(hooks(5));

		await load(event);

		expect(webhookCall(seen)).toContain('limit=');
		expect(webhookCall(seen)).toContain('offset=0');
	});

	it('carries the window the request named', async () => {
		const { seen, event } = loadEvent(hooks(5), '?limit=10&offset=30');

		const result = (await load(event)) as Loaded;

		expect(webhookCall(seen)).toContain('offset=30');
		expect(result.limit).toBe(10);
		expect(result.offset).toBe(30);
	});

	it('keeps the probe row out of the table', async () => {
		const { event } = loadEvent(hooks(51), '?limit=50');

		const result = (await load(event)) as Loaded;

		expect(result.webhooks.ok && result.webhooks.value).toHaveLength(50);
		expect(result.hasMore).toBe(true);
	});

	it('states the count the envelope carried rather than probing', async () => {
		const { event } = loadEvent({ data: hooks(50), total_count: 812 }, '?limit=50');

		const result = (await load(event)) as Loaded;

		expect(result.total).toBe(812);
		expect(result.hasMore).toBe(true);
	});

	it('states no total when the endpoint sent a bare array', async () => {
		const { event } = loadEvent(hooks(5));

		const result = (await load(event)) as Loaded;

		expect(result.total).toBeNull();
	});

	it('bounds a response that ignored the window', async () => {
		const { event } = loadEvent(hooks(10_000), '?limit=50');

		const result = (await load(event)) as Loaded;

		expect(result.webhooks.ok && result.webhooks.value).toHaveLength(50);
	});

	function failing(status: number, schemas = 200, search = '?offset=50') {
		const fetch = vi.fn(async (url: string) =>
			String(url).includes('/schemas')
				? schemas === 200
					? json([])
					: json({ error: 'nope' }, schemas)
				: json({ error: 'nope' }, status)
		) as unknown as typeof globalThis.fetch;
		return {
			fetch,
			cookies: mockCookies(),
			url: new URL(`http://localhost/admin/webhooks${search}`),
			parent: async () => ({ user: { roles: ['super_admin'] } }),
		} as never;
	}

	// An empty list is the first-run state with an offer to create the first
	// webhook. A read that failed is a gate, never that state, and it is not
	// sent back to page one as if the list had ended.
	it('keeps a failed list read as its gate, never as no webhooks', async () => {
		const failed = (await load(failing(500))) as Loaded;
		expect(failed.webhooks).toMatchObject({ ok: false, gate: { state: 'error' } });
		expect(failed.hasMore).toBe(false);
		expect(((await load(failing(503))) as Loaded).webhooks).toEqual({ ok: false, gate: { state: 'unavailable' } });
		expect(((await load(failing(403))) as Loaded).webhooks).toEqual({ ok: false, gate: { state: 'forbidden' } });
	});

	it('keeps a failed schema read apart from a list of none', async () => {
		const result = (await load(failing(200, 503, ''))) as Loaded;
		expect(result.schemas).toEqual({ ok: false, gate: { state: 'unavailable' } });
	});
});

/*
 * The address opens the delivery history and the dead letter queue, so the
 * load reads each one only when its parameter is there. The engine answers the
 * dead letter list with its standard envelope, data and total_count. The load
 * reads the envelope as it is sent, because a reader expecting items and total
 * sees an empty queue while deliveries wait in it.
 */
describe('admin/webhooks/+page.server.ts drawer reads', () => {
	function drawerEvent(search: string, answer: (url: string) => Response) {
		const seen: string[] = [];
		const fetch = vi.fn(async (url: string) => {
			const asked = String(url);
			seen.push(asked);
			if (asked.includes('/schemas')) return json([]);
			if (asked.includes('/api/admin/webhooks?')) return json(hooks(1));
			return answer(asked);
		}) as unknown as typeof globalThis.fetch;
		return {
			seen,
			event: { fetch, cookies: mockCookies(), url: new URL(`http://localhost/admin/webhooks${search}`) } as never,
		};
	}

	it('reads neither drawer while the address names none', async () => {
		const { seen, event } = drawerEvent('', () => json([]));
		const out = (await load(event)) as Loaded;
		expect(out.deliveries).toBeNull();
		expect(out.deadLetters).toBeNull();
		expect(seen.some((u) => u.includes('/deliveries') || u.includes('/webhook-dead-letters'))).toBe(false);
	});

	it('reads the history of the webhook the address names', async () => {
		const { seen, event } = drawerEvent('?deliveries=w0', () => json([{ id: 'd1' }]));
		const out = (await load(event)) as Loaded;
		expect(out.deliveries).toMatchObject({ id: 'w0', limit: 50, read: { ok: true, value: [{ id: 'd1' }] } });
		expect(seen.find((u) => u.includes('/deliveries'))).toContain('/w0/');
	});

	it('keeps a failed history read as its gate, never as no deliveries', async () => {
		const { event } = drawerEvent('?deliveries=w0', () => json({ error: 'pq: timeout' }, 500));
		const out = (await load(event)) as Loaded;
		expect(out.deliveries?.read).toEqual({ ok: false, gate: { state: 'error', message: 'Could not load deliveries.' } });
	});

	it('reads the rows out of the data envelope and states the total', async () => {
		const { seen, event } = drawerEvent('?dead=1', () =>
			json({ data: [{ id: 'd1', webhook_name: 'inventory' }, { id: 'd2', webhook_name: 'inventory' }], total_count: 188, limit: 50, offset: 0 }),
		);
		const out = (await load(event)) as Loaded;
		const read = out.deadLetters?.read;
		expect(read?.ok && read.value.rows.map((d: { id: string }) => d.id)).toEqual(['d1', 'd2']);
		expect(read?.ok && read.value.total).toBe(188);
		expect(seen.find((u) => u.includes('/webhook-dead-letters'))).toContain('limit=50');
	});

	it('asks for the page of the queue the address names', async () => {
		const { seen, event } = drawerEvent('?dead=1&dead_offset=100', () => json({ data: [], total_count: 120 }));
		expect(await load(event)).toMatchObject({ deadLetters: { offset: 100, limit: 50 } });
		expect(seen.find((u) => u.includes('/webhook-dead-letters'))).toContain('offset=100');
	});

	it('keeps a failed queue read as its gate, never as an empty queue', async () => {
		const { event } = drawerEvent('?dead=1', () => json({ error: 'pq: timeout' }, 500));
		const out = (await load(event)) as Loaded;
		expect(out.deadLetters?.read).toEqual({ ok: false, gate: { state: 'error', message: 'Could not load dead letters.' } });
	});
});

/*
 * The plugin serves create, update, delete and rotate to a super admin only, so
 * an admin's direct POST stops here before it reaches the engine.
 */
describe('admin/webhooks/+page.server.ts writes by role', () => {
	function writeEvent(roles: string[]) {
		const seen: string[] = [];
		const fetch = vi.fn(async (url: string) => {
			seen.push(String(url));
			if (String(url).includes('/auth/me')) return json({ id: 'u1', roles, disabled: false });
			return json({});
		}) as unknown as typeof globalThis.fetch;
		const form = new FormData();
		form.set('confirmed', 'yes');
		form.set('id', 'w1');
		return {
			seen,
			event: {
				fetch,
				cookies: mockCookies(),
				request: { formData: async () => form, clone: () => ({ formData: async () => form }) },
				url: new URL('http://localhost/admin/webhooks'),
			} as never,
		};
	}

	it.each(['create', 'update', 'delete', 'rotate-secret'] as const)('refuses %s to an admin', async (name) => {
		const { event, seen } = writeEvent(['admin']);
		await expect(actions[name](event)).rejects.toMatchObject({ status: 403 });
		expect(seen.filter((u) => !u.includes('/auth/me'))).toEqual([]);
	});

	it('lets a super admin delete', async () => {
		const { event, seen } = writeEvent(['super_admin']);
		await actions.delete(event);
		expect(seen.some((u) => u.includes('/api/admin/webhooks/w1'))).toBe(true);
	});

	// A click before the page hydrates posts the form with no question asked.
	it('deletes nothing on a post that skipped the question, and asks it on the page', async () => {
		const fetch = vi.fn();
		const body = new FormData();
		body.set('id', 'w1');
		const url = new URL('http://localhost/admin/webhooks?/delete');
		const out = await actions.delete({ fetch, cookies: mockCookies(), url, request: new Request(url, { method: 'POST', body }) } as never);
		expect(fetch).not.toHaveBeenCalled();
		expect(out).toEqual({
			unconfirmed: {
				question: 'Delete this webhook?',
				detail: 'This cannot be undone.',
				label: 'Delete',
				action: '/admin/webhooks?/delete',
				fields: [['id', 'w1']],
			},
		});
	});
});

/** An action event whose session reads as `roles` and whose writes answer `answer`. */
function postEvent(fields: Record<string, string>, answer: (url: string) => Response, roles = ['admin']) {
	const seen: string[] = [];
	const fetch = vi.fn(async (url: string) => {
		const asked = String(url);
		if (asked.includes('/auth/me')) return json({ id: 'u1', roles, disabled: false });
		seen.push(asked);
		return answer(asked);
	}) as unknown as typeof globalThis.fetch;
	const form = new FormData();
	form.set('confirmed', 'yes');
	for (const [key, value] of Object.entries(fields)) form.set(key, value);
	const url = new URL('http://localhost/admin/webhooks');
	return {
		seen,
		event: {
			fetch,
			cookies: mockCookies(),
			request: new Request(url, { method: 'POST', body: form }),
			url,
		} as never,
	};
}

describe('rotating a webhook signing secret', () => {
	// The plugin answers the webhook and the secret it generated, and shows
	// the secret this once.
	it('hands the page the new secret and the webhook it signs for', async () => {
		const { event } = postEvent(
			{ id: 'w1' },
			() => json({ webhook: { id: 'w1', name: 'Ship it', secret: '[redacted]' }, new_secret: 'c0ffee-secret' }),
			['super_admin'],
		);
		expect(await actions['rotate-secret'](event)).toEqual({ rotated: { id: 'w1', name: 'Ship it', secret: 'c0ffee-secret' } });
	});

	it('names its action on a refusal and keeps driver text out of an outage', async () => {
		const refused = postEvent({ id: 'w1' }, () => json({ error: 'failed to rotate webhook secret', code: 'not_found' }, 404), ['super_admin']);
		expect(await actions['rotate-secret'](refused.event)).toEqual({
			status: 400,
			data: { action: 'rotate-secret', error: 'failed to rotate webhook secret' },
		});
		const down = postEvent({ id: 'w1' }, () => json({ error: 'pq: timeout' }, 503), ['super_admin']);
		expect(await actions['rotate-secret'](down.event)).toEqual({
			status: 400,
			data: { action: 'rotate-secret', error: 'Could not rotate the signing secret. Try again.' },
		});
	});
});

/*
 * Every one of these actions is the plugin's GroupAdmin route, so any signed
 * in admin may call it. Each answers a write the plugin accepts, a refusal
 * under its own action name, and an outage without driver text.
 */
describe('the delivery and dead-letter actions each report their own outcome', () => {
	const cases = {
		test: { fields: { id: 'w1' }, ok: { success: true, status_code: 200, message: 'OK' }, fallback: 'Could not test the webhook. Try again.' },
		'retry-delivery': {
			fields: { id: 'w1', delivery_id: 'd1' },
			ok: { delivery_id: 'd1', success: true, message: 'Delivered' },
			fallback: 'Could not retry the delivery. Try again.',
		},
		'dead-letter-replay': { fields: { id: 'dl1' }, ok: { id: 'dl1', status: 'replayed', http_status: 200 }, fallback: 'Could not replay the dead letter. Try again.' },
		'dead-letter-dismiss': { fields: { id: 'dl1' }, ok: { id: 'dl1', status: 'dismissed' }, fallback: 'Could not dismiss the dead letter. Try again.' },
		'dead-letter-delete': { fields: { id: 'dl1' }, ok: null, fallback: 'Could not delete the dead letter. Try again.' },
	} as const;
	const names = Object.keys(cases) as (keyof typeof cases)[];

	it.each(names)('%s succeeds for an admin', async (name) => {
		const { event, seen } = postEvent(cases[name].fields, () =>
			cases[name].ok === null ? new Response(null, { status: 204 }) : json(cases[name].ok),
		);
		const result = await actions[name](event);
		expect(seen).toHaveLength(1);
		// A failure comes back as fail(), which carries a status. A success does not.
		expect((result as { status?: number } | undefined)?.status).toBeUndefined();
	});

	it.each(names)('%s names its action on a refusal', async (name) => {
		const { event } = postEvent(cases[name].fields, () => json({ error: 'dead letter entry is not pending', code: 'conflict' }, 409));
		expect(await actions[name](event)).toMatchObject({ status: 400, data: { action: name, error: 'dead letter entry is not pending' } });
	});

	it.each(names)('%s keeps driver text out of an outage', async (name) => {
		const { event } = postEvent(cases[name].fields, () => json({ error: 'pq: connection refused' }, 503));
		expect(await actions[name](event)).toMatchObject({ data: { action: name, error: cases[name].fallback } });
	});

	it('passes the replay result through, the receiver code included', async () => {
		const { event } = postEvent({ id: 'dl1' }, () => json({ id: 'dl1', status: 'replayed', http_status: 502 }));
		expect(await actions['dead-letter-replay'](event)).toEqual({
			deadLetterReplay: { id: 'dl1', status: 'replayed', http_status: 502 },
		});
	});

	it('renders a license refusal of a replay through the refusal notice', async () => {
		const { event } = postEvent({ id: 'dl1' }, () =>
			json({ error: 'payment_required', plugin: 'example', feature: 'feature:example_feature' }, 402),
		);
		expect(await actions['dead-letter-replay'](event)).toMatchObject({
			status: 402,
			data: { action: 'dead-letter-replay', id: 'dl1', refused: { kind: 'feature' } },
		});
	});

	it.each(names)('%s is refused to a session the engine does not sign in', async (name) => {
		const fetch = vi.fn(async () => json({ error: 'unauthorized' }, 401)) as unknown as typeof globalThis.fetch;
		const event = {
			fetch,
			cookies: mockCookies(),
			request: { formData: async () => new FormData() },
			url: new URL('http://localhost/admin/webhooks'),
		} as never;
		await expect(actions[name](event)).rejects.toBeDefined();
	});
});
