import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@lyeve-labs/client';

const engine = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('$lib/server/authz', () => ({
	authedClient: vi.fn(() => engine),
	requireRole: vi.fn(async () => ({ id: 'u1', roles: ['admin'] })),
}));

import { requireRole } from '$lib/server/authz';
import { actions, load } from './+page.server';

function event(form: Record<string, string> = {}) {
	const data = new FormData();
	data.set('confirmed', 'yes');
	for (const [k, v] of Object.entries(form)) data.set(k, v);
	return {
		parent: async () => ({ plugins: { state: 'named', running: ['audit'], withheld: [] } }),
		request: { formData: async () => data, clone: () => ({ formData: async () => data }) },
	} as never;
}

beforeEach(() => vi.clearAllMocks());

describe('audit sinks', () => {
	it('lists the destinations the engine holds', async () => {
		engine.get.mockResolvedValue({ data: [{ id: 's1', name: 'SIEM' }] });
		const out = (await load(event())) as Record<string, unknown>;
		expect(engine.get).toHaveBeenCalledWith('/api/admin/audit-log/sinks');
		expect(out.sinks).toHaveLength(1);
	});

	it('returns a generated signing secret once, with the create', async () => {
		engine.post.mockResolvedValue({ id: 's1', name: 'SIEM', secret: 'whsec_once' });
		const out = await actions.create(event({ kind: 'https', name: 'SIEM', url: 'https://siem.example.com', enabled: 'true' }));
		expect(out).toEqual({ created: 'SIEM', secret: 'whsec_once' });
		expect(engine.post.mock.calls[0][1]).not.toHaveProperty('secret');
	});

	it('asks for the Splunk token before it calls the engine', async () => {
		const out = (await actions.create(event({ kind: 'splunk', name: 'S', url: 'https://s.example.com' }))) as {
			data: { fields: Record<string, string> };
		};
		expect(out.data.fields.secret).toBe('Enter the HEC token.');
		expect(engine.post).not.toHaveBeenCalled();
	});

	it('renders the license refusal with the capability it names', async () => {
		engine.post.mockRejectedValue(
			new ApiError(402, 'payment_required', { error: 'payment_required', plugin: 'example', feature: 'feature:example_capability' }),
		);
		const out = (await actions.create(event({ kind: 'https', name: 'S', url: 'https://s.example.com' }))) as {
			status: number;
			data: Record<string, unknown>;
		};
		expect(out.status).toBe(402);
		expect(out.data.refused).toMatchObject({ kind: 'feature', feature: 'example-capability' });
	});

	it('reports a test that did not land', async () => {
		engine.post.mockResolvedValue({ delivered: false, error: 'receiver answered 500' });
		const out = await actions.test(event({ id: 's1' }));
		expect(out).toEqual({ tested: 's1', delivered: false, testError: 'receiver answered 500' });
	});
});

type Failure = { status: number; data: Record<string, unknown> };

const EDIT = { id: 's1', name: 'SIEM', url: 'https://siem.example.com', enabled: 'true' };

describe('editing a destination', () => {
	it('saves the fields and keeps the stored secret when none is typed', async () => {
		engine.put.mockResolvedValue({});
		const out = await actions.update(event(EDIT));
		expect(engine.put.mock.calls[0][0]).toBe('/api/admin/audit-log/sinks/s1');
		expect(engine.put.mock.calls[0][1]).not.toHaveProperty('secret');
		expect(out).toEqual({ saved: 'SIEM' });
	});

	it('relays a refusal under its own action', async () => {
		engine.put.mockRejectedValue(new ApiError(400, 'url must be https', { error: 'url must be https', code: 'bad_request' }));
		const out = (await actions.update(event(EDIT))) as Failure;
		expect(out.data).toMatchObject({ action: 'update' });
		expect(String(out.data.error)).toContain('url must be https');
	});

	it('gives its own sentence for an outage', async () => {
		engine.put.mockRejectedValue(new ApiError(503, 'connection refused', {}));
		const out = (await actions.update(event(EDIT))) as Failure;
		expect(String(out.data.error)).toContain('Could not save the destination. Try again.');
		expect(String(out.data.error)).not.toContain('connection refused');
	});

	it('is for an admin', async () => {
		vi.mocked(requireRole).mockRejectedValueOnce(new Error('forbidden'));
		await expect(actions.update(event(EDIT))).rejects.toThrow('forbidden');
		expect(vi.mocked(requireRole).mock.calls[0][1]).toEqual(['admin', 'super_admin']);
		expect(engine.put).not.toHaveBeenCalled();
	});
});

describe('deleting a destination', () => {
	it('deletes the one named', async () => {
		engine.delete.mockResolvedValue(undefined);
		const out = await actions.delete(event({ id: 's1' }));
		expect(engine.delete).toHaveBeenCalledWith('/api/admin/audit-log/sinks/s1');
		expect(out).toEqual({ deleted: true });
	});

	it('relays a refusal under its own action', async () => {
		engine.delete.mockRejectedValue(new ApiError(404, 'sink not found', { error: 'sink not found', code: 'not_found' }));
		const out = (await actions.delete(event({ id: 's1' }))) as Failure;
		expect(out.data).toMatchObject({ action: 'delete' });
		expect(String(out.data.error)).toContain('sink not found');
	});

	it('gives its own sentence for an outage', async () => {
		engine.delete.mockRejectedValue(new ApiError(503, 'connection refused', {}));
		const out = (await actions.delete(event({ id: 's1' }))) as Failure;
		expect(String(out.data.error)).toContain('Could not delete the destination. Try again.');
	});

	it('is for an admin', async () => {
		vi.mocked(requireRole).mockRejectedValueOnce(new Error('forbidden'));
		await expect(actions.delete(event({ id: 's1' }))).rejects.toThrow('forbidden');
		expect(vi.mocked(requireRole).mock.calls[0][1]).toEqual(['admin', 'super_admin']);
		expect(engine.delete).not.toHaveBeenCalled();
	});
});
