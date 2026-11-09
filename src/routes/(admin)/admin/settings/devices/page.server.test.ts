import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/authz', async () => {
	const { createClient } = await vi.importActual<typeof import('@lyeve-labs/client')>('@lyeve-labs/client');
	return { authedClient: (event: { fetch: typeof fetch }) => createClient(event.fetch) };
});

import { actions, load } from './+page.server';

function event(body: unknown, search: string) {
	return {
		fetch: vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })),
		url: new URL(`http://admin/admin/settings/devices${search}`),
		request: new Request('http://admin/admin/settings/devices'),
		parent: async () => ({ plugins: { state: 'named', running: ['device-fingerprint'], withheld: [] } }),
	} as never;
}

describe('devices load', () => {
	it('sends a page past the end back to the last page that holds devices', async () => {
		await expect(load(event({ data: [], total_count: 30 }, '?offset=100&limit=25'))).rejects.toMatchObject({
			status: 307,
			location: '/admin/settings/devices?offset=25&limit=25',
		});
	});

	it('stays on the first page when there is no device at all', async () => {
		const out = (await load(event({ data: [], total_count: 0 }, ''))) as { devices: unknown[] };
		expect(out.devices).toEqual([]);
	});
});

type Call = { method: string; path: string; body: unknown };
type Failure = { status: number; data: { error: string } };

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** An action event against a fake engine that records each request and answers it with `reply`. */
function write(fields: Record<string, string>, reply: Response = json({})) {
	const calls: Call[] = [];
	const fetch = vi.fn(async (url: string, init?: RequestInit) => {
		calls.push({ method: init?.method ?? 'GET', path: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
		return reply.clone();
	});
	const form = new FormData();
	form.set('confirmed', 'yes');
	for (const [k, v] of Object.entries(fields)) form.set(k, v);
	const url = new URL('http://admin/admin/settings/devices');
	return { calls, event: { fetch, url, request: new Request(url, { method: 'POST', body: form }) } as never };
}

const OUTAGE = json({ error: 'dial tcp 10.0.0.4:5432: connection refused' }, 503);

// Each reader trusts and forgets their own devices, so neither write checks a role.
describe('device writes', () => {
	it('trusts this device under the name the reader gave it', async () => {
		const { event, calls } = write({ label: ' Work laptop ' });
		expect(await actions.trust(event)).toEqual({ trusted: 'Work laptop' });
		expect(calls).toEqual([{ method: 'POST', path: '/api/admin/devices/trust', body: { label: 'Work laptop' } }]);
	});

	it('asks for a name before it trusts anything', async () => {
		const { event, calls } = write({ label: ' ' });
		expect(((await actions.trust(event)) as Failure).data.error).toBe('Enter a name for this device.');
		expect(calls).toEqual([]);
	});

	it('forgets the named device', async () => {
		const { event, calls } = write({ id: 'd1' });
		expect(await actions.untrust(event)).toEqual({ removed: 'd1' });
		expect(calls).toEqual([{ method: 'POST', path: '/api/admin/devices/d1/untrust', body: {} }]);
	});

	it('names nothing to forget without a request', async () => {
		const { event, calls } = write({});
		expect(((await actions.untrust(event)) as Failure).data.error).toBe('This form is missing its device. Reload the page and try again.');
		expect(calls).toEqual([]);
	});

	it.each(['trust', 'untrust'] as const)('relays the engine refusal on %s', async (name) => {
		const { event } = write({ label: 'Laptop', id: 'd1' }, json({ error: 'device limit reached', code: 'conflict' }, 409));
		const out = (await actions[name](event)) as Failure;
		expect(out.data.error).toBe('device limit reached');
	});

	it.each([
		['trust', 'Could not trust this device. Try again.'],
		['untrust', 'Could not forget this device. Try again.'],
	] as const)('keeps outage detail off the page on %s', async (name, sentence) => {
		const { event } = write({ label: 'Laptop', id: 'd1' }, OUTAGE);
		expect(((await actions[name](event)) as Failure).data.error).toBe(sentence);
	});
});
