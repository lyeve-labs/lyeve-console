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
		url: new URL('http://admin/admin/observability/captures/rules'),
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
		request: new Request('http://admin/admin/observability/captures/rules', { method: 'POST', body }),
		cookies: {},
		fetch: vi.fn(),
	} as never;
}

beforeEach(() => {
	vi.clearAllMocks();
	authz.roles = ['admin'];
	api.listCaptureRules.mockResolvedValue({ data: [], licensed: false });
});

describe('capture rules load', () => {
	it('reads the rules, and takes licensed from the plugin', async () => {
		const result = (await load(loadEvent())) as Loaded;
		expect(result.gate).toEqual({ state: 'ok' });
		expect(result.rulesRead).toBe(true);
		expect(result.licensed).toBe(false);
	});

	it('says the rules were not read when the read fails', async () => {
		api.listCaptureRules.mockRejectedValue(new Error('down'));
		const result = (await load(loadEvent())) as Loaded;
		expect(result.rulesRead).toBe(false);
		expect(result.gate).toEqual({ state: 'ok' });
	});

	// A role refusal, a lapsed license and an outage each read differently,
	// so a failed rules read keeps its gate.
	it('keeps the gate of a failed rules read', async () => {
		api.listCaptureRules.mockRejectedValue(new ApiError(403, 'forbidden', {}));
		const result = (await load(loadEvent())) as Loaded;
		expect(result.rulesGate).toEqual({ state: 'forbidden' });
	});

	// The shell says why while the plugin does not run, so the page reads nothing.
	it('reads nothing while the plugin does not run', async () => {
		const plugins = { state: 'named', running: [], withheld: [] };
		const result = (await load(loadEvent(plugins))) as Loaded;
		expect(result.gate).toEqual({ state: 'absent' });
		expect(api.listCaptureRules).not.toHaveBeenCalled();
	});
});

describe('capture rule actions', () => {
	it('sends the sample as a fraction and the retention in seconds', async () => {
		api.createCaptureRule.mockResolvedValue({});
		await actions.createRule(
			formEvent({
				route_pattern: '/api/v1/orders/{id}',
				method: 'post',
				sample_percent: '25',
				retention_seconds: String(30 * 86400),
				enabled: 'true',
			}),
		);
		expect(api.createCaptureRule).toHaveBeenCalledWith(expect.anything(), {
			route_pattern: '/api/v1/orders/{id}',
			method: 'POST',
			sample_rate: 0.25,
			retention_seconds: 2592000,
			enabled: true,
		});
	});

	it('refuses a retention past 30 days before the round trip', async () => {
		const out = (await actions.createRule(
			formEvent({ route_pattern: '/api/v1/**', method: '*', sample_percent: '100', retention_seconds: String(31 * 86400) }),
		)) as { status: number };
		expect(out.status).toBe(400);
		expect(api.createCaptureRule).not.toHaveBeenCalled();
	});

	it('returns the license refusal so the page renders it', async () => {
		api.createCaptureRule.mockRejectedValue(
			new ApiError(402, 'payment_required', { error: 'payment_required', plugin: 'example', feature: 'feature:example_feature' }),
		);
		const out = (await actions.createRule(
			formEvent({ route_pattern: '/api/v1/**', method: '*', sample_percent: '100', retention_seconds: '3600' }),
		)) as { status: number; data: { refused: { kind: string } } };
		expect(out.status).toBe(402);
		expect(out.data.refused.kind).toBe('feature');
	});
});

describe('which surface a failure belongs to', () => {
	const fields = { route_pattern: '/api/v1/orders', method: '*', sample_percent: '100', retention_seconds: '3600', enabled: 'true' };

	it('tags a failed rule save for the rule drawer', async () => {
		api.createCaptureRule.mockRejectedValue(new ApiError(503, 'down', {}));
		const out = (await actions.createRule(formEvent(fields))) as { data: Record<string, unknown> };
		expect(out.data.drawer).toBe('rule');
	});

	it('leaves a failed switch-off from the row for the page', async () => {
		api.updateCaptureRule.mockRejectedValue(new ApiError(503, 'down', {}));
		const out = (await actions.updateRule(formEvent({ ...fields, id: 'r1', enabled: 'false', from: 'row' }))) as {
			data: Record<string, unknown>;
		};
		expect(out.data.drawer).toBeNull();
	});
});

describe('deleting a rule', () => {
	it('deletes the rule it names', async () => {
		api.deleteCaptureRule.mockResolvedValue(undefined);
		expect(await actions.deleteRule(formEvent({ id: 'r1' }))).toEqual({ removedRule: 'r1' });
		expect(api.deleteCaptureRule).toHaveBeenCalledWith(expect.anything(), 'r1');
	});

	it('refuses a delete that names no rule', async () => {
		const out = (await actions.deleteRule(formEvent({}))) as { status: number };
		expect(out.status).toBe(400);
		expect(api.deleteCaptureRule).not.toHaveBeenCalled();
	});

	it('refuses a role the plugin does not admit', async () => {
		authz.roles = ['editor'];
		await expect(actions.deleteRule(formEvent({ id: 'r1' }))).rejects.toThrow('403');
		expect(api.deleteCaptureRule).not.toHaveBeenCalled();
	});

	it("relays the plugin's refusal", async () => {
		api.deleteCaptureRule.mockRejectedValue(new ApiError(404, 'rule not found', { error: 'rule not found', code: 'not_found' }));
		const out = (await actions.deleteRule(formEvent({ id: 'r1' }))) as { status: number; data: { error: string } };
		expect(out.status).toBe(400);
		expect(out.data.error).toBe('rule not found');
	});

	it('says an outage failed the delete', async () => {
		api.deleteCaptureRule.mockRejectedValue(new ApiError(503, 'down', {}));
		const out = (await actions.deleteRule(formEvent({ id: 'r1' }))) as { status: number; data: { error: string } };
		expect(out.status).toBe(400);
		expect(out.data.error).toBe('Could not delete the rule. Try again.');
	});
});
