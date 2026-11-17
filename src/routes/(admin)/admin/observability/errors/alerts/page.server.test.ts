import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@lyeve-labs/client';

const engine = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('#lib/server/authz.ts', async (importOriginal) => ({
	...((await importOriginal()) as object),
	authedClient: vi.fn(() => engine),
	requireRole: vi.fn(async () => ({ id: 'u1', roles: ['admin'] })),
}));

import { actions, load } from './+page.server';

type Loaded = Exclude<Awaited<ReturnType<typeof load>>, void>;
type Failure = { status: number; data: Record<string, unknown> };

const SETTINGS = {
	channels: { email: ['ops@example.com'], slack_url: 'https://hooks.slack.com/...1a2b' },
	spike_min_count: null,
	spike_z_score: null,
	defaults: { spike_min_count: 10, spike_z_score: 2.5 },
	licensed: false,
};

function loadEvent(running = ['error-tracking']) {
	return { parent: async () => ({ plugins: { state: 'named', running, withheld: [] } }) } as never;
}

function actionEvent(fields: Record<string, string>) {
	const data = new FormData();
	for (const [k, v] of Object.entries(fields)) data.set(k, v);
	return { request: { formData: async () => data } } as never;
}

beforeEach(() => vi.clearAllMocks());

describe('the spike alerts load', () => {
	it('reads the setting and what the plugin says it would take', async () => {
		engine.get.mockResolvedValue(SETTINGS);
		const out = (await load(loadEvent())) as Loaded;
		expect(engine.get).toHaveBeenCalledWith('/api/admin/error-tracking/alert-settings');
		expect(out.settings).toMatchObject({ licensed: false, spike_min_count: null, defaults: { spike_min_count: 10 } });
		expect(out.settings?.channels.slack_url).toBe('https://hooks.slack.com/...1a2b');
	});

	it('reads the event window from the event list', async () => {
		engine.get.mockImplementation(async (url: string) =>
			url.startsWith('/api/admin/error-tracking/events') ? { data: [], total_count: 0, hidden_older: 0, window_days: 30 } : SETTINGS,
		);
		const out = (await load(loadEvent())) as Loaded;
		expect(out.windowDays).toBe(30);
		expect(out.settings?.licensed).toBe(false);
	});

	it('keeps the setting when the event list cannot be read', async () => {
		engine.get.mockImplementation(async (url: string) => {
			if (url.startsWith('/api/admin/error-tracking/events')) throw new Error('down');
			return SETTINGS;
		});
		const out = (await load(loadEvent())) as Loaded;
		expect(out.windowDays).toBeNull();
		expect(out.settings).not.toBeNull();
	});

	it('reads nothing while the plugin does not run', async () => {
		const out = (await load(loadEvent([]))) as Loaded;
		expect(engine.get).not.toHaveBeenCalled();
		expect(out.gate.state).toBe('absent');
	});
});

describe('saving spike alerts', () => {
	it('sends every member, the masked value as it was read and the default threshold as null', async () => {
		engine.put.mockResolvedValue(SETTINGS);
		await actions.save(
			actionEvent({
				channel_email: 'ops@example.com',
				channel_slack_url: 'https://hooks.slack.com/...1a2b',
				threshold_mode: 'default',
				spike_min_count: '50',
			}),
		);
		expect(engine.put).toHaveBeenCalledWith('/api/admin/error-tracking/alert-settings', {
			channels: { email: ['ops@example.com'], slack_url: 'https://hooks.slack.com/...1a2b' },
			spike_min_count: null,
			spike_z_score: null,
		});
	});

	it('sends a custom threshold when the form asks for one', async () => {
		engine.put.mockResolvedValue(SETTINGS);
		await actions.save(actionEvent({ threshold_mode: 'custom', spike_min_count: '25', spike_z_score: '3.5' }));
		expect(engine.put.mock.calls[0][1]).toMatchObject({ channels: {}, spike_min_count: 25, spike_z_score: 3.5 });
	});

	it('refuses a minimum count that is not a whole number, without a request', async () => {
		const out = (await actions.save(actionEvent({ threshold_mode: 'custom', spike_min_count: '2.5' }))) as Failure;
		expect(out.status).toBe(400);
		expect(engine.put).not.toHaveBeenCalled();
	});

	it('renders the refusal the plugin sent for a paid channel', async () => {
		engine.put.mockRejectedValue(
			new ApiError(402, 'payment_required', { error: 'payment_required', plugin: 'error-tracking', feature: 'feature:example_feature' }),
		);
		const out = (await actions.save(actionEvent({ channel_pagerduty_routing_key: 'R0123456789abcdef0123456789abcde' }))) as Failure;
		expect(out.status).toBe(402);
		expect(out.data.refused).toMatchObject({ kind: 'feature', feature: 'example-feature' });
	});

	it('shows the webhook signing secret the write answered, once', async () => {
		engine.put.mockResolvedValue({ ...SETTINGS, webhook_signing_secret: 's'.repeat(64) });
		const out = await actions.save(actionEvent({ channel_webhook_url: 'https://ops.example.com/spikes' }));
		expect(out).toEqual({ saved: true, signingSecret: 's'.repeat(64) });
	});
});
