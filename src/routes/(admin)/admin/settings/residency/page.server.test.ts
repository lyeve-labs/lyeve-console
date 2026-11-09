import { describe, expect, it, vi } from 'vitest';
import type { Cookies } from '@sveltejs/kit';

import { actions, load } from './+page.server';

type Call = { method: string; path: string; body: unknown };
type Failure = { status: number; data: { action?: string; error: string } };

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function cookies(): Cookies {
	return { get: vi.fn(() => 'tok'), set: vi.fn(), delete: vi.fn(), getAll: vi.fn(() => []), serialize: vi.fn(() => '') } as unknown as Cookies;
}

/**
 * An action event against a fake engine. The session check answers with the
 * given roles, and every other request is recorded and answered with `reply`.
 */
function engine(
	fields: Record<string, string>,
	opts: { roles?: string[]; reply?: Response; respond?: (call: Call) => Response } = {},
) {
	const calls: Call[] = [];
	const fetch = vi.fn(async (url: string, init?: RequestInit) => {
		const path = String(url);
		if (path.includes('/auth/me')) return json({ id: 'u1', roles: opts.roles ?? ['super_admin'], disabled: false });
		const call = { method: init?.method ?? 'GET', path, body: init?.body ? JSON.parse(String(init.body)) : undefined };
		calls.push(call);
		if (opts.respond) return opts.respond(call);
		return opts.reply?.clone() ?? json({});
	});
	const form = new FormData();
	form.set('confirmed', 'yes');
	for (const [k, v] of Object.entries(fields)) form.set(k, v);
	const url = new URL('http://localhost/admin/settings/residency');
	return {
		calls,
		event: { fetch, cookies: cookies(), url, request: new Request(url, { method: 'POST', body: form }) } as never,
	};
}

const REGION = { slug: 'eu-west', display_name: ' EU West ', provider: 'aws', lat: '53.3', long: '-6.2', enabled: 'true' };
const OUTAGE = json({ error: 'dial tcp 10.0.0.4:5432: connection refused' }, 503);

describe('region writes', () => {
	it.each([
		['create', REGION],
		['update', { id: 'r1', ...REGION }],
		['delete', { id: 'r1' }],
	] as const)('refuses %s to an admin before it reaches the engine', async (name, fields) => {
		const { event, calls } = engine(fields, { roles: ['admin'] });
		await expect(actions[name](event)).rejects.toMatchObject({ status: 403 });
		expect(calls).toEqual([]);
	});

	it('creates a region with its coordinates', async () => {
		const { event, calls } = engine(REGION);
		expect(await actions.create(event)).toEqual({ saved: 'eu-west' });
		expect(calls).toEqual([
			{
				method: 'POST',
				path: '/api/admin/regions',
				body: {
					slug: 'eu-west',
					display_name: 'EU West',
					provider: 'aws',
					coordinates: { lat: 53.3, long: -6.2 },
					is_default: false,
				},
			},
		]);
	});

	// The plugin's create refuses a body naming enabled and opens every new
	// region, so a closed one is created and then closed.
	it('creates a region asked for closed, then closes it', async () => {
		const { event, calls } = engine({ ...REGION, enabled: 'false' }, { respond: () => json({ id: 'r9' }) });
		expect(await actions.create(event)).toEqual({ saved: 'eu-west' });
		expect(calls[0].body).not.toHaveProperty('enabled');
		expect(calls[1]).toEqual({ method: 'PUT', path: '/api/admin/regions/r9', body: { enabled: false } });
	});

	it('says a created region is still open when closing it fails', async () => {
		const { event } = engine(
			{ ...REGION, enabled: 'false' },
			{ respond: (call) => (call.method === 'POST' ? json({ id: 'r9' }) : OUTAGE.clone()) },
		);
		const out = (await actions.create(event)) as Failure;
		expect(out.data.action).toBe('close');
		expect(out.data.error).toContain('was created, but it is still accepting new tenants');
		expect(out.data.error).toContain('Clients can see it and are routed to it as their nearest region');
		expect(out.data.error.endsWith('Edit it and turn off Accepting new tenants.')).toBe(true);
	});

	it('leaves out coordinates that were never filled in', async () => {
		const { event, calls } = engine({ ...REGION, lat: '0', long: '0' });
		await actions.create(event);
		expect(calls[0].body).not.toHaveProperty('coordinates');
	});

	it.each([
		[{ slug: 'EU West' }, 'Enter a slug of lowercase letters'],
		[{ display_name: ' ' }, 'Enter a name for the region.'],
		[{ provider: '' }, 'Enter where it runs'],
	])('refuses %o before it creates anything', async (over, sentence) => {
		const { event, calls } = engine({ ...REGION, ...over });
		const out = (await actions.create(event)) as Failure;
		expect(out.data.action).toBe('create');
		expect(out.data.error).toContain(sentence);
		expect(calls).toEqual([]);
	});

	it('saves a region without sending its slug', async () => {
		const { event, calls } = engine({ id: 'r1', ...REGION, slug: 'renamed' });
		expect(await actions.update(event)).toEqual({ saved: 'EU West' });
		expect(calls).toHaveLength(1);
		expect(calls[0]).toMatchObject({ method: 'PUT', path: '/api/admin/regions/r1' });
		expect(calls[0].body).not.toHaveProperty('slug');
	});

	it('deletes the named region', async () => {
		const { event, calls } = engine({ id: 'r1' });
		expect(await actions.delete(event)).toEqual({ removed: 'r1' });
		expect(calls).toEqual([{ method: 'DELETE', path: '/api/admin/regions/r1', body: undefined }]);
	});

	it.each(['update', 'delete'] as const)('names nothing to %s without a request', async (name) => {
		const { event, calls } = engine({ display_name: 'EU West' });
		expect(((await actions[name](event)) as Failure).data).toEqual({ action: name, error: 'This form is missing its region. Reload the page and try again.' });
		expect(calls).toEqual([]);
	});

	it.each(['create', 'update', 'delete'] as const)('relays the engine refusal on %s under its action', async (name) => {
		const { event } = engine({ id: 'r1', ...REGION }, { reply: json({ error: 'region has tenants assigned', code: 'conflict' }, 409) });
		const out = (await actions[name](event)) as Failure;
		expect(out.data).toEqual({ action: name, error: 'region has tenants assigned' });
	});

	it.each([
		['create', 'Could not create the region. Try again.'],
		['update', 'Could not save the region. Try again.'],
		['delete', 'Could not delete the region. Try again.'],
	] as const)('keeps outage detail off the page on %s', async (name, sentence) => {
		const { event } = engine({ id: 'r1', ...REGION }, { reply: OUTAGE });
		expect(((await actions[name](event)) as Failure).data).toEqual({ action: name, error: sentence });
	});
});

describe('the report read', () => {
	function loadEvent(report: Response) {
		const { event } = engine({}, { respond: (call) => (call.path.includes('/residency/report') ? report.clone() : json({ data: [] })) });
		return {
			...(event as object),
			parent: async () => ({
				plugins: { state: 'named', running: ['data-residency'], withheld: [] },
				user: { id: 'u1', roles: ['super_admin'] },
			}),
		} as never;
	}

	it('names a role refusal as one, not as an unread report', async () => {
		const out = (await load(loadEvent(json({ error: 'forbidden' }, 403)))) as Record<string, unknown>;
		expect(out.report).toBeNull();
		expect(out.reportGate).toEqual({ state: 'forbidden' });
	});

	it('names an outage as one', async () => {
		const out = (await load(loadEvent(OUTAGE))) as Record<string, unknown>;
		expect(out.reportGate).toEqual({ state: 'unavailable' });
	});

	it('reads one region past the cap to say the list was cut', async () => {
		const { event, calls } = engine(
			{},
			{
				respond: (call) =>
					call.path.includes('/regions')
						? json({ data: Array.from({ length: 101 }, (_, i) => ({ id: `r${i}`, slug: `r${i}` })) })
						: json({ summary: null, tenant_regions: [] }),
			},
		);
		const out = (await load({
			...(event as object),
			parent: async () => ({
				plugins: { state: 'named', running: ['data-residency'], withheld: [] },
				user: { id: 'u1', roles: ['super_admin'] },
			}),
		} as never)) as { regions: unknown[]; more: boolean };
		expect(calls.find((c) => c.path.includes('/regions'))?.path).toContain('limit=101');
		expect(out.regions).toHaveLength(100);
		expect(out.more).toBe(true);
	});

	it('hands over the report it read', async () => {
		const out = (await load(loadEvent(json({ summary: null, tenant_regions: [] })))) as Record<string, unknown>;
		expect(out.reportGate).toEqual({ state: 'ok' });
		expect(out.report).toEqual({ summary: null, tenant_regions: [] });
	});
});
