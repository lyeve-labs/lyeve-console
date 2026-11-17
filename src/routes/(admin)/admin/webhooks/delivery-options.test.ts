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
	return { params, request: { formData: async () => data } } as never;
}

type Failure = { status: number; data: Record<string, unknown> };

beforeEach(() => vi.clearAllMocks());

describe('webhook writes the engine refuses', () => {
	it('says the count against the ceiling the engine sent', async () => {
		engine.post.mockRejectedValue(
			new ApiError(402, 'cap_exceeded', { error: 'cap_exceeded', cap: 'example.items', limit: 7, current: 7, upgrade_url: '' }),
		);
		const out = (await actions.create(event({ name: 'n', url: 'https://x.example.com' }))) as Failure;
		expect(out.status).toBe(402);
		expect(out.data.error).toContain("You're using 7 of 7 items");
		expect(out.data.refused).toMatchObject({ kind: 'cap', cap: 'example.items', limit: 7, current: 7 });
	});

	it('renders a capability refusal from the engine', async () => {
		engine.put.mockRejectedValue(
			new ApiError(402, 'payment_required', { error: 'payment_required', plugin: 'example', feature: 'feature:example_capability' }),
		);
		const out = (await actions.update(event({ id: 'w1', name: 'n', url: 'u', payload_template: '{}' }))) as Failure;
		expect(out.data.refused).toMatchObject({ kind: 'feature', feature: 'example-capability' });
	});

	it('sends back the options an edit does not show, so an update never clears them', async () => {
		engine.put.mockResolvedValue({});
		await actions.update(
			event({
				id: 'w1',
				name: 'n',
				url: 'u',
				max_retries: '4',
				kept: JSON.stringify({ headers: { 'X-Team': 'ops' }, include_fields: ['title'] }),
			}),
		);
		expect(engine.put.mock.calls[0][0]).toBe('/api/admin/webhooks/w1');
		expect(engine.put.mock.calls[0][1]).toMatchObject({ max_retries: 4, headers: { 'X-Team': 'ops' }, include_fields: ['title'] });
	});

	it('sends no secret when the box is blank, so an edit keeps the stored signing secret', async () => {
		engine.put.mockResolvedValue({});
		await actions.update(event({ id: 'w1', name: 'n', url: 'u', secret: '' }));
		expect(engine.put.mock.calls[0][1]).not.toHaveProperty('secret');
	});

	it('sends a secret the edit names', async () => {
		engine.put.mockResolvedValue({});
		await actions.update(event({ id: 'w1', name: 'n', url: 'u', secret: 'a-new-secret-of-16-chars' }));
		expect(engine.put.mock.calls[0][1]).toMatchObject({ secret: 'a-new-secret-of-16-chars' });
	});
});
