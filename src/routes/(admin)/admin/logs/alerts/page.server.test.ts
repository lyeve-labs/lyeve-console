import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@lyeve-labs/client';

const engine = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('$lib/server/authz', async (importOriginal) => ({
	...((await importOriginal()) as object),
	authedClient: vi.fn(() => engine),
	requireRole: vi.fn(async () => ({ id: 'u1', roles: ['super_admin'] })),
}));

import { actions, load } from './+page.server';

type Loaded = Exclude<Awaited<ReturnType<typeof load>>, void>;
type Failure = { status: number; data: Record<string, unknown> };

const STORED = {
	thresholds: [
		{ id: 'r1', level: 'ERROR', max_count: 100, window: '5m', enabled: true, channels: { slack_url: 'https://hooks.slack.com/...1a2b' } },
		{ id: 'r2', level: '', max_count: 10000, window: '1h', enabled: false, channels: {} },
	],
	cooldown: '10m',
	licensed: false,
};

function loadEvent(roles = ['super_admin'], running = ['logging']) {
	return { parent: async () => ({ user: { id: 'u1', roles }, plugins: { state: 'named', running, withheld: [] } }) } as never;
}

function actionEvent(fields: Record<string, string>) {
	const data = new FormData();
	data.set('confirmed', 'yes');
	for (const [k, v] of Object.entries(fields)) data.set(k, v);
	return { request: { formData: async () => data, clone: () => ({ formData: async () => data }) } } as never;
}

const RULE = { level: 'WARN', max_count: '50', window: '15m', enabled: 'true' };

beforeEach(() => {
	vi.clearAllMocks();
	engine.get.mockResolvedValue(STORED);
	engine.put.mockImplementation(async (_url: string, body: unknown) => ({ ...(body as object), licensed: false }));
});

describe('the volume alerts load', () => {
	it('reads the rules and whether a paid channel would be taken', async () => {
		const out = (await load(loadEvent())) as Loaded;
		expect(engine.get).toHaveBeenCalledWith('/api/admin/logging/alerts');
		expect(out.config?.thresholds).toHaveLength(2);
		expect(out.config?.licensed).toBe(false);
		expect(out.superAdmin).toBe(true);
	});

	it('marks a tenant admin as a reader', async () => {
		const out = (await load(loadEvent(['admin']))) as Loaded;
		expect(out.superAdmin).toBe(false);
	});

	it('reads nothing while the plugin does not run', async () => {
		const out = (await load(loadEvent(['super_admin'], []))) as Loaded;
		expect(engine.get).not.toHaveBeenCalled();
		expect(out.gate.state).toBe('absent');
	});
});

describe('saving a rule', () => {
	beforeEach(() => {
		engine.post.mockImplementation(async (_url: string, body: unknown) => ({ ...(body as object), id: 'r9', licensed: false }));
		engine.put.mockImplementation(async (url: string, body: unknown) => ({
			...(body as object),
			id: url.split('/').pop(),
			licensed: false,
		}));
	});

	it('adds a new rule on its own, with no id and no other rule in the body', async () => {
		await actions.save(actionEvent({ ...RULE, channel_email: 'ops@example.com' }));
		expect(engine.get).not.toHaveBeenCalled();
		expect(engine.put).not.toHaveBeenCalled();
		expect(engine.post).toHaveBeenCalledWith('/api/admin/logging/alerts', {
			level: 'WARN',
			max_count: 50,
			window: '15m',
			enabled: true,
			channels: { email: ['ops@example.com'] },
		});
	});

	it('replaces the rule its key names at the address of that rule', async () => {
		await actions.save(actionEvent({ ...RULE, key: 'r2', level: 'ALL' }));
		expect(engine.put).toHaveBeenCalledTimes(1);
		const [url, body] = engine.put.mock.calls[0] as [string, Record<string, unknown>];
		expect(url).toBe('/api/admin/logging/alerts/r2');
		expect(body).toMatchObject({ id: 'r2', level: '', max_count: 50 });
		expect(body).not.toHaveProperty('thresholds');
	});

	it('refuses a window the plugin cannot parse, without a request', async () => {
		const out = (await actions.save(actionEvent({ ...RULE, window: 'soon' }))) as Failure;
		expect(out.status).toBe(400);
		expect(out.data.drawer).toBe(true);
		expect(engine.post).not.toHaveBeenCalled();
	});

	it('keeps a paid channel refusal in the drawer', async () => {
		engine.post.mockRejectedValue(
			new ApiError(402, 'payment_required', { error: 'payment_required', plugin: 'logging', feature: 'feature:example_feature' }),
		);
		const out = (await actions.save(actionEvent({ ...RULE, channel_discord_url: 'https://discord.com/api/webhooks/1/a' }))) as Failure;
		expect(out.status).toBe(402);
		expect(out.data).toMatchObject({ drawer: true, refused: { kind: 'feature', feature: 'example-feature' } });
	});

	it('says a rule removed meanwhile is gone rather than keeping the drawer open', async () => {
		engine.put.mockRejectedValue(
			new ApiError(404, 'alert rule not found', { error: 'alert rule not found', code: 'logging.rule_not_found' }),
		);
		const out = (await actions.save(actionEvent({ ...RULE, key: 'r2' }))) as Failure;
		expect(out.status).toBe(404);
		expect(out.data.error).toContain('no longer exists');
		expect(out.data.drawer).toBeUndefined();
	});

	it('shows the signing secret a new webhook URL got', async () => {
		engine.post.mockResolvedValue({ id: 'r3', level: 'WARN', webhook_signing_secret: 'w'.repeat(64), licensed: true });
		const out = await actions.save(actionEvent({ ...RULE, channel_webhook_url: 'https://ops.example.com/logs' }));
		expect(out).toEqual({ saved: true, signingSecret: 'w'.repeat(64) });
	});
});

describe('deleting a rule and the cooldown', () => {
	it('deletes the one rule its key names', async () => {
		engine.delete.mockResolvedValue(undefined);
		expect(await actions.delete(actionEvent({ key: 'r1' }))).toEqual({ deleted: 'r1' });
		expect(engine.delete).toHaveBeenCalledWith('/api/admin/logging/alerts/r1');
		expect(engine.put).not.toHaveBeenCalled();
	});

	it('says a rule already removed is gone', async () => {
		engine.delete.mockRejectedValue(
			new ApiError(404, 'alert rule not found', { error: 'alert rule not found', code: 'logging.rule_not_found' }),
		);
		const out = (await actions.delete(actionEvent({ key: 'r1' }))) as Failure;
		expect(out.status).toBe(404);
		expect(out.data.error).toContain('no longer exists');
	});

	it('writes the cooldown with the rules unchanged', async () => {
		await actions.cooldown(actionEvent({ cooldown: '30m' }));
		const body = engine.put.mock.calls[0][1] as { thresholds: unknown[]; cooldown: string };
		expect(body.cooldown).toBe('30m');
		expect(body.thresholds).toHaveLength(2);
	});
});
