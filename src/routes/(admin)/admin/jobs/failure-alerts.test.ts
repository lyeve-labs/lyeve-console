import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@lyeve-labs/client';

const engine = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('#lib/server/authz.ts', async (importOriginal) => ({
	...((await importOriginal()) as object),
	authedClient: vi.fn(() => engine),
	requireUser: vi.fn(async () => ({ id: 'u1', roles: ['super_admin'] })),
	requireRole: vi.fn(async () => ({ id: 'u1', roles: ['super_admin'] })),
}));

import { actions } from './+page.server';

function event(fields: Record<string, string | string[]>, params: Record<string, string> = {}) {
	const data = new FormData();
	for (const [k, v] of Object.entries(fields)) for (const one of Array.isArray(v) ? v : [v]) data.append(k, one);
	return { params, url: new URL('http://localhost/admin/jobs?/save'), request: { formData: async () => data } } as never;
}

type Failure = { status: number; data: Record<string, unknown> };

beforeEach(() => vi.clearAllMocks());

const job = { name: 'digest', schedule: '0 9 * * *', endpoint: 'https://x.example.com', enabled: 'on' };

describe('job failure alerts', () => {
	it('sends the channels and the threshold with the job', async () => {
		engine.post.mockResolvedValue({});
		await expect(
			actions.create(event({ ...job, alert_email: 'ops@example.com', alert_threshold: '3' })),
		).rejects.toMatchObject({ status: 303 });
		expect(engine.post.mock.calls[0][1]).toMatchObject({ alerts: { email: ['ops@example.com'], failure_threshold: 3 } });
	});

	it('leaves alerts out of a job that never had any', async () => {
		engine.post.mockResolvedValue({});
		await expect(actions.create(event(job))).rejects.toMatchObject({ status: 303 });
		expect(engine.post.mock.calls[0][1]).not.toHaveProperty('alerts');
	});

	it('renders the capability refusal the engine sent', async () => {
		engine.put.mockRejectedValue(
			new ApiError(402, 'payment_required', { error: 'payment_required', plugin: 'example', feature: 'feature:example_capability' }),
		);
		const out = (await actions.update(event({ ...job, id: 'j1', alert_slack_url: 'https://hooks.example.com/a' }))) as Failure;
		expect(out.status).toBe(402);
		expect(out.data.refused).toMatchObject({ feature: 'example-capability' });
	});

	it('shows the webhook signing secret the write answered instead of redirecting past it', async () => {
		engine.post.mockResolvedValue({ name: 'digest', alert_signing_secret: 'a'.repeat(64) });
		const out = await actions.create(event({ ...job, alert_webhook_url: 'https://hooks.example.com/cron' }));
		expect(out).toEqual({ signingFor: 'digest', signingSecret: 'a'.repeat(64) });
	});

	it('sends back the masked URL the job answered, which keeps the stored one', async () => {
		engine.put.mockResolvedValue({ name: 'digest' });
		await expect(
			actions.update(event({ ...job, id: 'j1', alerts_stored: 'true', alert_slack_url: 'https://hooks.slack.com/...1a2b' })),
		).rejects.toMatchObject({ status: 303 });
		expect(engine.put.mock.calls[0][1]).toMatchObject({ alerts: { slack_url: 'https://hooks.slack.com/...1a2b' } });
	});
});
