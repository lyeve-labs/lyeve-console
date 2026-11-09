import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiError } from '@lyeve-labs/client';

const api = vi.hoisted(() => ({
	listCaptures: vi.fn(),
	listCaptureRules: vi.fn(),
	listReplaySets: vi.fn(),
	createCaptureRule: vi.fn(),
	updateCaptureRule: vi.fn(),
	deleteCaptureRule: vi.fn(),
	createReplaySet: vi.fn(),
	deleteReplaySet: vi.fn(),
	replaySet: vi.fn(),
}));

vi.mock('$lib/api/request-capture', async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	...api,
}));

const authz = vi.hoisted(() => ({ roles: ['admin'] as string[] }));

vi.mock('$lib/server/authz', () => ({
	authedClient: vi.fn(() => ({})),
	requireRole: vi.fn(async (_event: unknown, allowed: string[]) => {
		if (!allowed.some((r) => authz.roles.includes(r))) throw new Error('403');
		return { id: 'u1', roles: authz.roles };
	}),
}));

import { load, actions } from './+page.server';

type Loaded = Exclude<Awaited<ReturnType<typeof load>>, void>;

function loadEvent(plugins?: unknown) {
	return {
		url: new URL('http://admin/admin/observability/captures/sets'),
		fetch: vi.fn(),
		cookies: { get: () => undefined },
		parent: async () => ({ user: { roles: ['admin'] }, plugins }),
	} as never;
}

function formEvent(fields: Record<string, string | string[]>) {
	const body = new FormData();
	body.set('confirmed', 'yes');
	for (const [k, v] of Object.entries(fields)) {
		for (const one of Array.isArray(v) ? v : [v]) body.append(k, one);
	}
	return {
		request: new Request('http://admin/admin/observability/captures/sets', { method: 'POST', body }),
		cookies: {},
		fetch: vi.fn(),
	} as never;
}

beforeEach(() => {
	vi.clearAllMocks();
	authz.roles = ['admin'];
	api.listReplaySets.mockResolvedValue({ data: [], licensed: false });
});

describe('replay sets load', () => {
	it('reads the sets, and takes licensed from the plugin', async () => {
		const result = (await load(loadEvent())) as Loaded;
		expect(result.gate).toEqual({ state: 'ok' });
		expect(result.setsRead).toBe(true);
		expect(result.licensed).toBe(false);
	});

	// A role refusal, a lapsed license and an outage each read differently,
	// so a failed sets read keeps its gate.
	it('keeps the gate of a failed sets read', async () => {
		api.listReplaySets.mockRejectedValue(new ApiError(503, 'down', {}));
		const result = (await load(loadEvent())) as Loaded;
		expect(result.setsRead).toBe(false);
		expect(result.setsGate).toEqual({ state: 'unavailable' });
	});

	// The shell says why while the plugin does not run, so the page reads nothing.
	it('reads nothing while the plugin does not run', async () => {
		const plugins = { state: 'named', running: [], withheld: [] };
		const result = (await load(loadEvent(plugins))) as Loaded;
		expect(result.gate).toEqual({ state: 'absent' });
		expect(api.listReplaySets).not.toHaveBeenCalled();
	});
});

describe('replaying a set', () => {
	it('replays a set and returns each capture diff', async () => {
		const replay = {
			set_id: 's1',
			results: [{ capture_id: 'c1', replay_id: 'r1', diff: { status_match: true, status_code1: 200, status_code2: 200 } }],
		};
		api.replaySet.mockResolvedValue(replay);
		expect(await actions.replaySet(formEvent({ id: 's1' }))).toEqual({ replay });
		expect(api.replaySet).toHaveBeenCalledWith(expect.anything(), 's1', false);
	});

	// A set holding a write is refused before any of it runs, so the page asks
	// again with the writes confirmed rather than reporting a failure.
	it('asks to confirm the writes when the plugin refuses a set that holds one', async () => {
		api.replaySet.mockRejectedValue(
			new ApiError(428, 'reworded by the plugin', { error: 'reworded by the plugin', code: 'request_capture.confirm_writes' }),
		);
		const out = (await actions.replaySet(formEvent({ id: 's1' }))) as { status: number; data: { needsWrites: string } };
		expect(out.status).toBe(428);
		expect(out.data.needsWrites).toBe('s1');
	});

	it('relays the other confirmation rather than asking about writes', async () => {
		const message = 'replay requires confirm_replay: true, which acknowledges auth header substitution';
		api.replaySet.mockRejectedValue(new ApiError(428, message, { error: message, code: 'request_capture.confirm_replay' }));
		const out = (await actions.replaySet(formEvent({ id: 's1' }))) as {
			status: number;
			data: { needsWrites?: string; error: string };
		};
		expect(out.data.needsWrites).toBeUndefined();
		expect(out.data.error).toBe(message);
	});

	it('sends the writes confirmation when the operator gave it', async () => {
		api.replaySet.mockResolvedValue({ set_id: 's1', results: [] });
		await actions.replaySet(formEvent({ id: 's1', confirm_mutating: 'true' }));
		expect(api.replaySet).toHaveBeenCalledWith(expect.anything(), 's1', true);
	});

	// A click before the page hydrates posts the set's form with no question.
	it('replays nothing on a post that skipped the question, and keeps what it named for the second post', async () => {
		const body = new FormData();
		body.set('id', 's1');
		body.set('confirm_mutating', 'true');
		const url = new URL('http://admin/admin/observability/captures/sets?/replaySet');
		const out = await actions.replaySet({ url, request: new Request(url, { method: 'POST', body }), cookies: {}, fetch: vi.fn() } as never);
		expect(api.replaySet).not.toHaveBeenCalled();
		expect(out).toMatchObject({
			unconfirmed: {
				question: 'Replay this set?',
				label: 'Replay',
				action: '/admin/observability/captures/sets?/replaySet',
				fields: [
					['id', 's1'],
					['confirm_mutating', 'true'],
				],
			},
		});
	});
});

describe('deleting a replay set', () => {
	it('deletes the set it names', async () => {
		api.deleteReplaySet.mockResolvedValue(undefined);
		expect(await actions.deleteSet(formEvent({ id: 's1' }))).toEqual({ removedSet: 's1' });
		expect(api.deleteReplaySet).toHaveBeenCalledWith(expect.anything(), 's1');
	});

	it('refuses a delete that names no set', async () => {
		const out = (await actions.deleteSet(formEvent({}))) as { status: number };
		expect(out.status).toBe(400);
		expect(api.deleteReplaySet).not.toHaveBeenCalled();
	});

	it('refuses a role the plugin does not admit', async () => {
		authz.roles = ['editor'];
		await expect(actions.deleteSet(formEvent({ id: 's1' }))).rejects.toThrow('403');
		expect(api.deleteReplaySet).not.toHaveBeenCalled();
	});

	it("relays the plugin's refusal", async () => {
		api.deleteReplaySet.mockRejectedValue(new ApiError(404, 'replay set not found', { error: 'replay set not found', code: 'not_found' }));
		const out = (await actions.deleteSet(formEvent({ id: 's1' }))) as { status: number; data: { error: string } };
		expect(out.status).toBe(400);
		expect(out.data.error).toBe('replay set not found');
	});

	it('says an outage failed the delete', async () => {
		api.deleteReplaySet.mockRejectedValue(new TypeError('fetch failed'));
		const out = (await actions.deleteSet(formEvent({ id: 's1' }))) as { status: number; data: { error: string } };
		expect(out.status).toBe(400);
		expect(out.data.error).toBe('Could not delete the replay set. Try again.');
	});
});
