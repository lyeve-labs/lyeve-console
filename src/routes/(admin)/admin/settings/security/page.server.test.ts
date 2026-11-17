import { describe, it, expect, vi, beforeEach } from 'vitest';

const engine = vi.hoisted(() => ({ get: vi.fn() }));
const session = vi.hoisted(() => ({ user: { id: 'u1', roles: ['super_admin'] } as { id: string; roles: string[] } }));

// The role check is the real one, so the load's own refusal is what is tested.
vi.mock('#lib/server/authz.ts', async (importOriginal) => ({
	...(await importOriginal<typeof import('#lib/server/authz.ts')>()),
	authedClient: vi.fn(() => engine),
	loadUser: vi.fn(async () => session.user),
}));
vi.mock('@lyeve-labs/client', () => ({
	createClient: vi.fn(() => engine),
	ApiError: class ApiError extends Error {
		status: number;
		constructor(status: number, message: string) {
			super(message);
			this.status = status;
		}
	},
}));

import { load } from './+page.server';
import { ApiError } from '@lyeve-labs/client';

/** The page's event, for a session whose account holds these roles. */
function event(roles: string[] = ['super_admin']) {
	session.user = { id: 'u1', roles };
	return {} as never;
}
const report = {
	checked_at: '2026-09-13T22:00:00Z',
	failures: 1,
	controls: [{ control: 'waf', status: 'FAIL', detail: 'not wired', remedy: 'Enable the waf plugin.' }],
};

beforeEach(() => {
	vi.clearAllMocks();
});

describe('security load', () => {
	it('asks the engine for the report as super_admin', async () => {
		engine.get.mockResolvedValue(report);
		const data = await load(event());
		expect(engine.get).toHaveBeenCalledWith('/api/admin/security/controls');
		expect(data).toEqual({ report: { ok: true, value: report } });
	});

	it('refuses a lower role before reading anything', async () => {
		await expect(load(event(['admin']))).rejects.toMatchObject({ status: 403 });
		expect(engine.get).not.toHaveBeenCalled();
	});

	it('tells an engine without the report apart from a dead one and a busy one', async () => {
		// A 404 is an engine without the endpoint, a 429 an engine that is up
		// and refusing for the rate, and a 503 one that did not answer.
		engine.get.mockRejectedValue(new ApiError(404, 'not found'));
		expect(await load(event())).toEqual({ report: { ok: false, gate: { state: 'absent' } } });
		engine.get.mockRejectedValue(new ApiError(429, 'slow down'));
		expect(await load(event())).toMatchObject({ report: { ok: false, gate: { state: 'busy' } } });
		engine.get.mockRejectedValue(new ApiError(503, 'db down'));
		expect(await load(event())).toMatchObject({ report: { ok: false, gate: { state: 'unavailable' } } });
	});
});
