import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@lyeve-labs/client';

const engine = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('$lib/server/authz', async (importOriginal) => ({
	...((await importOriginal()) as object),
	authedClient: vi.fn(() => engine),
	requireRole: vi.fn(async () => ({ id: 'u1', roles: ['admin'] })),
}));

import { requireRole } from '$lib/server/authz';
import { actions, load } from './+page.server';

type Loaded = Exclude<Awaited<ReturnType<typeof load>>, void>;

function loadEvent(query = '') {
	return {
		url: new URL(`http://localhost/admin/events${query}`),
		parent: async () => ({ plugins: { state: 'named', running: ['events'], withheld: [] } }),
	} as never;
}

function route(map: Record<string, unknown>) {
	engine.get.mockImplementation(async (url: string) => {
		for (const [needle, body] of Object.entries(map)) {
			if (url.includes(needle)) {
				if (body instanceof Error) throw body;
				return body;
			}
		}
		throw new ApiError(404, 'not found', {});
	});
}

beforeEach(() => vi.clearAllMocks());

describe('the events load', () => {
	it('keeps a failed run list as a gate rather than no runs', async () => {
		route({ '/events/replay': new ApiError(503, 'down', {}), '/events?': { data: [], total_count: 0 } });
		const out = (await load(loadEvent())) as Loaded;
		expect(out.runs).toEqual({ ok: false, gate: { state: 'unavailable' } });
	});

	it('counts every run, not the rows it asked for', async () => {
		route({ '/events/replay': { data: [{ run_id: 'r1' }], total_count: 37 }, '/events?': { data: [], total_count: 0 } });
		const out = (await load(loadEvent())) as Loaded;
		expect(out.runs).toEqual({ ok: true, value: { rows: [{ run_id: 'r1' }], total: 37 } });
	});

	it('sends an offset past the end back to the last page', async () => {
		route({ '/events/replay': { data: [], total_count: 0 }, '/events?': { data: [], total_count: 60 } });
		await expect(load(loadEvent('?limit=50&offset=500'))).rejects.toMatchObject({
			status: 307,
			location: expect.stringContaining('offset=50'),
		});
	});
});

type Failure = { status: number; data: { error: string } };

function replayEvent(fields: Record<string, string>) {
	const body = new FormData();
	body.set('confirmed', 'yes');
	for (const [k, v] of Object.entries(fields)) body.set(k, v);
	return { request: new Request('http://localhost/admin/events', { method: 'POST', body }), url: new URL('http://localhost/admin/events') } as never;
}

// The replay re-delivers published events to their handlers, so a missing
// or malformed field must never fire a real run.
describe('replaying events', () => {
	it('holds a replay to an admin', async () => {
		vi.mocked(requireRole).mockRejectedValueOnce(Object.assign(new Error('403'), { status: 403 }));
		const event = replayEvent({ since: '2026-10-01T09:30', since_offset: '0' });
		await expect(actions.replay(event)).rejects.toMatchObject({ status: 403 });
		expect(requireRole).toHaveBeenCalledWith(event, ['admin', 'super_admin']);
		expect(engine.post).not.toHaveBeenCalled();
	});

	it('posts the instant the browser meant and runs dry unless told otherwise', async () => {
		engine.post.mockResolvedValue({ run_id: 'run-1' });
		const out = await actions.replay(replayEvent({ since: '2026-10-01T09:30', since_offset: '120', handler: ' search-index ' }));
		expect(engine.post).toHaveBeenCalledWith('/api/admin/events/replay', {
			since: '2026-10-01T11:30:00.000Z',
			handler: 'search-index',
			dry_run: true,
		});
		expect(out).toEqual({ started: 'run-1', dryRun: true });
	});

	it('sends a real replay only when the form says so, for every handler when none is named', async () => {
		engine.post.mockResolvedValue({ run_id: 'run-2' });
		const out = await actions.replay(replayEvent({ since: '2026-10-01T09:30', since_offset: '0', dry_run: 'false' }));
		expect(engine.post).toHaveBeenCalledWith('/api/admin/events/replay', { since: '2026-10-01T09:30:00.000Z', handler: undefined, dry_run: false });
		expect(out).toEqual({ started: 'run-2', dryRun: false });
	});

	it.each([
		[{ since: '' }, 'Choose the point to replay from.'],
		[{ since: 'yesterday' }, 'Choose a date and time to replay from.'],
		[{ since: '2999-01-01T00:00', since_offset: '0' }, 'Choose a time in the past.'],
	])('refuses %o without starting a run', async (fields, sentence) => {
		const out = (await actions.replay(replayEvent(fields))) as Failure;
		expect(out.status).toBe(400);
		expect(out.data.error).toBe(sentence);
		expect(engine.post).not.toHaveBeenCalled();
	});

	it('relays the engine refusal', async () => {
		engine.post.mockRejectedValue(new ApiError(409, 'a replay is already in progress', { error: 'a replay is already in progress', code: 'conflict' }));
		const out = (await actions.replay(replayEvent({ since: '2026-10-01T09:30', since_offset: '0' }))) as Failure;
		expect(out.data.error).toBe('a replay is already in progress');
	});

	it('keeps outage detail off the page', async () => {
		engine.post.mockRejectedValue(new ApiError(503, 'dial tcp 10.0.0.4:5432: connection refused'));
		const out = (await actions.replay(replayEvent({ since: '2026-10-01T09:30', since_offset: '0' }))) as Failure;
		expect(out.data.error).toBe('Could not start the replay. Try again.');
	});
});
