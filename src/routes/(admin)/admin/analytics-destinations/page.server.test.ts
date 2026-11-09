import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@lyeve-labs/client';

const engine = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('$lib/server/authz', async (importOriginal) => ({
	...((await importOriginal()) as object),
	authedClient: vi.fn(() => engine),
	requireRole: vi.fn(async () => ({ id: 'u1', roles: ['admin'] })),
}));

import { assertRole, requireRole } from '$lib/server/authz';
import { actions, load } from './+page.server';

type Loaded = Exclude<Awaited<ReturnType<typeof load>>, void>;
type Failure = { status: number; data: Record<string, unknown> };

const PROVIDER = {
	id: 'p1',
	name: 'Product',
	type: 'ga4',
	enabled: true,
	config: { redacted: true },
	retry_policy: { max_attempts: 3, backoff_seconds: 30 },
};

const REFUSED = new ApiError(402, 'payment_required', {
	error: 'payment_required',
	plugin: 'analytics',
	feature: 'feature:example_feature',
});

function loadEvent(query = '', running = ['analytics']) {
	return {
		url: new URL(`http://localhost/admin/analytics-destinations${query}`),
		parent: async () => ({ plugins: { state: 'named', running, withheld: [] } }),
	} as never;
}

function actionEvent(fields: Record<string, string>) {
	const data = new FormData();
	data.set('confirmed', 'yes');
	for (const [k, v] of Object.entries(fields)) data.set(k, v);
	return { request: { formData: async () => data, clone: () => ({ formData: async () => data }) } } as never;
}

beforeEach(() => vi.clearAllMocks());

describe('the destinations load', () => {
	it('reads the new list shape and what the plugin says it would take', async () => {
		engine.get.mockImplementation(async (url: string) =>
			url.startsWith('/api/admin/analytics/providers')
				? { data: [PROVIDER], licensed: false }
				: { data: [{ id: 'd1', event_id: 'e1', provider_id: 'p1', status: 'failed', attempts: 3, last_error: 'timeout' }], licensed: false },
		);
		const out = (await load(loadEvent('?status=failed'))) as Loaded;
		expect(out.licensed).toBe(false);
		expect(out.providers[0]).toMatchObject({ id: 'p1', retry_policy: { max_attempts: 3, backoff_seconds: 30 } });
		expect(out.deliveries?.data[0]).toMatchObject({ id: 'd1', status: 'failed', last_error: 'timeout' });
		expect(engine.get).toHaveBeenCalledWith('/api/admin/analytics/deliveries?limit=51&status=failed');
	});

	it('still reads a plugin that answers the old bare array', async () => {
		engine.get.mockImplementation(async (url: string) => (url.startsWith('/api/admin/analytics/providers') ? [PROVIDER] : []));
		const out = (await load(loadEvent())) as Loaded;
		expect(out.providers).toHaveLength(1);
		expect(out.licensed).toBe(false);
	});

	it('says a failed delivery read failed rather than that nothing is owed', async () => {
		engine.get.mockImplementation(async (url: string) => {
			if (url.startsWith('/api/admin/analytics/providers')) return { data: [], licensed: true };
			throw new ApiError(503, 'down', {});
		});
		const out = (await load(loadEvent())) as Loaded;
		expect(out.deliveries).toBeNull();
		expect(out.deliveriesGate).toEqual({ state: 'unavailable' });
		expect(out.gate.state).toBe('ok');
	});

	// The plugin takes no offset and sends no count, so the list stopped at
	// fifty with nothing saying more were owed.
	it('says when more deliveries are owed than the list holds', async () => {
		const rows = Array.from({ length: 51 }, (_, i) => ({ id: `d${i}`, status: 'failed' }));
		engine.get.mockImplementation(async (url: string) =>
			url.startsWith('/api/admin/analytics/providers') ? { data: [], licensed: true } : { data: rows, licensed: true },
		);
		const out = (await load(loadEvent())) as Loaded;
		expect(out.deliveries?.data).toHaveLength(50);
		expect(out.moreDeliveries).toBe(true);
	});

	it('says nothing more when the list holds every delivery', async () => {
		engine.get.mockImplementation(async (url: string) =>
			url.startsWith('/api/admin/analytics/providers') ? { data: [], licensed: true } : { data: [{ id: 'd1' }], licensed: true },
		);
		const out = (await load(loadEvent())) as Loaded;
		expect(out.moreDeliveries).toBe(false);
	});

	it('reads nothing while the plugin does not run', async () => {
		const out = (await load(loadEvent('', []))) as Loaded;
		expect(engine.get).not.toHaveBeenCalled();
		expect(out.gate.state).toBe('absent');
	});
});

describe('saving a destination', () => {
	it('creates a PostHog destination with its settings and no policy when it does not retry', async () => {
		engine.post.mockResolvedValue({ id: 'p2', name: 'PostHog', type: 'posthog' });
		await actions.save(actionEvent({ name: 'PostHog', type: 'posthog', enabled: 'true', config_api_key: 'phc_x', max_attempts: '1' }));
		expect(engine.post).toHaveBeenCalledWith('/api/admin/analytics/providers', {
			name: 'PostHog',
			type: 'posthog',
			enabled: true,
			config: { api_key: 'phc_x' },
		});
	});

	it('sends a retry policy that retries', async () => {
		engine.post.mockResolvedValue({ id: 'p2', name: 'A' });
		await actions.save(
			actionEvent({ name: 'A', type: 'amplitude', enabled: 'true', config_api_key: 'k', max_attempts: '4', backoff_seconds: '60' }),
		);
		expect(engine.post.mock.calls[0][1]).toMatchObject({ retry_policy: { max_attempts: 4, backoff_seconds: 60 } });
	});

	it('refuses a missing required setting on a new destination, without a request', async () => {
		const out = (await actions.save(actionEvent({ name: 'W', type: 'webhook', max_attempts: '1' }))) as Failure;
		expect(out.status).toBe(400);
		expect(out.data.error).toBe('Enter the HTTPS URL.');
		expect(engine.post).not.toHaveBeenCalled();
	});

	it('keeps the stored settings on an edit that names none, and resends the policy as it stands', async () => {
		engine.put.mockResolvedValue({ ...PROVIDER });
		await actions.save(actionEvent({ id: 'p1', name: 'Renamed', type: 'ga4', enabled: 'false', max_attempts: '3', backoff_seconds: '30' }));
		expect(engine.put).toHaveBeenCalledWith('/api/admin/analytics/providers/p1', {
			name: 'Renamed',
			enabled: false,
			retry_policy: { max_attempts: 3, backoff_seconds: 30 },
		});
	});

	it('asks for a new webhook signing secret and shows it once', async () => {
		engine.put.mockResolvedValue({ id: 'p3', name: 'Hook', type: 'webhook', signing_secret: 'z'.repeat(64) });
		const out = await actions.save(actionEvent({ id: 'p3', name: 'Hook', type: 'webhook', max_attempts: '1', rotate_secret: 'true' }));
		expect(engine.put.mock.calls[0][1]).toMatchObject({ rotate_secret: true });
		expect(out).toEqual({ saved: 'Hook', signingSecret: 'z'.repeat(64) });
	});

	it('keeps a refused type in the drawer', async () => {
		engine.post.mockRejectedValue(REFUSED);
		const out = (await actions.save(actionEvent({ name: 'W', type: 'webhook', config_url: 'https://ops.example.com/a', max_attempts: '1' }))) as Failure;
		expect(out.status).toBe(402);
		expect(out.data).toMatchObject({ drawer: true, refused: { kind: 'feature', feature: 'example-feature' } });
	});
});

describe('replaying a delivery', () => {
	it('reports a delivery that landed', async () => {
		engine.post.mockResolvedValue({ delivered: true });
		const out = await actions.replay(actionEvent({ id: 'd1' }));
		expect(engine.post).toHaveBeenCalledWith('/api/admin/analytics/deliveries/d1/replay', {});
		expect(out).toEqual({ replayed: 'd1', delivered: true, lastError: '' });
	});

	it('reports the new error of one that failed again', async () => {
		engine.post.mockResolvedValue({ delivered: false, delivery: { id: 'd1', last_error: 'HTTP 500' } });
		expect(await actions.replay(actionEvent({ id: 'd1' }))).toEqual({ replayed: 'd1', delivered: false, lastError: 'HTTP 500' });
	});

	it('renders the refusal a replay came back with', async () => {
		engine.post.mockRejectedValue(REFUSED);
		const out = (await actions.replay(actionEvent({ id: 'd1' }))) as Failure;
		expect(out.status).toBe(402);
		expect(out.data.refused).toMatchObject({ kind: 'feature' });
	});
});

describe('deleting a destination', () => {
	it('deletes the named destination', async () => {
		engine.delete.mockResolvedValue(undefined);
		expect(await actions.delete(actionEvent({ id: 'p1' }))).toEqual({ deleted: 'p1' });
		expect(engine.delete).toHaveBeenCalledWith('/api/admin/analytics/providers/p1');
	});

	it('relays the reason the plugin refused with', async () => {
		engine.delete.mockRejectedValue(new ApiError(404, 'provider not found', { error: 'provider not found', code: 'not_found' }));
		expect(await actions.delete(actionEvent({ id: 'p1' }))).toMatchObject({ status: 400, data: { error: 'provider not found' } });
	});

	it('keeps driver text out of a delete that meets an outage', async () => {
		engine.delete.mockRejectedValue(new ApiError(503, 'pq: connection refused'));
		const out = (await actions.delete(actionEvent({ id: 'p1' }))) as Failure;
		expect(out.status).toBe(400);
		expect(String(out.data.error)).not.toContain('pq:');
	});

	it('refuses an editor before calling the plugin', async () => {
		vi.mocked(requireRole).mockImplementationOnce(async (_event, roles) => assertRole({ id: 'u2', roles: ['editor'] } as never, roles));
		await expect(actions.delete(actionEvent({ id: 'p1' }))).rejects.toMatchObject({ status: 403 });
		expect(engine.delete).not.toHaveBeenCalled();
	});
});
