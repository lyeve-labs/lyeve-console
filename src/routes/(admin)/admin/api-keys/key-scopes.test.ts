import { beforeEach, describe, expect, it, vi } from 'vitest';

const engine = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('$lib/server/authz', async (importOriginal) => ({
	...((await importOriginal()) as object),
	authedClient: vi.fn(() => engine),
	requireUser: vi.fn(async () => ({ id: 'u1', roles: ['super_admin'] })),
	requireRole: vi.fn(async () => ({ id: 'u1', roles: ['super_admin'] })),
}));

import { actions } from './+page.server';

function event(fields: Record<string, string | string[]>) {
	const data = new FormData();
	for (const [k, v] of Object.entries(fields)) for (const one of Array.isArray(v) ? v : [v]) data.append(k, one);
	return { params: {}, request: { formData: async () => data } } as never;
}

type Failure = { status: number; data: { fields?: Record<string, string> } };

beforeEach(() => {
	vi.clearAllMocks();
	engine.post.mockResolvedValue({ raw_key: 'k', name: 'svc' });
});

// A key made here carries the scopes the drawer chose, or the engine refuses
// every content route to a non-admin key.
describe('a new key carries the scopes the form chose', () => {
	it('sends the chosen scopes with the schemas', async () => {
		await actions.create(
			event({ name: 'svc', roles: 'viewer', scopes: ['content:read', 'schemas:read'], schemas: 'posts, pages' }),
		);
		expect(engine.post).toHaveBeenCalledWith(
			'/api/admin/api-keys',
			expect.objectContaining({ roles: ['viewer'], scopes: ['content:read', 'schemas:read'], schemas: ['posts', 'pages'] }),
		);
	});

	it('sends the scope that reads the API reference as the engine spells it', async () => {
		await actions.create(event({ name: 'agent', roles: 'viewer', scopes: ['mcp:create', 'openapi.json:read'] }));
		expect(engine.post.mock.calls[0][1]).toMatchObject({ scopes: ['mcp:create', 'openapi.json:read'] });
	});

	it('sends no scope the picker does not offer', async () => {
		await actions.create(event({ name: 'svc', roles: 'editor', scopes: ['*:*', 'content:write'] }));
		expect(engine.post.mock.calls[0][1]).toMatchObject({ scopes: ['content:write'] });
	});

	it('refuses a non-admin key with no scope before it calls the engine', async () => {
		const out = (await actions.create(event({ name: 'svc', roles: 'viewer' }))) as Failure;
		expect(out.status).toBe(400);
		expect(out.data.fields?.scopes).toContain('at least one scope');
		expect(engine.post).not.toHaveBeenCalled();
	});

	it('refuses a key whose only scopes are ones the picker does not offer', async () => {
		const out = (await actions.create(event({ name: 'svc', roles: 'viewer', scopes: '*:*' }))) as Failure;
		expect(out.status).toBe(400);
		expect(engine.post).not.toHaveBeenCalled();
	});

	it('sends the scopes and schemas a key is held to, each once', async () => {
		await actions.create(
			event({
				name: 'svc',
				roles: 'editor',
				scopes: ['content.posts:read', 'content.posts:create', 'Flows.Order-Sync:create', 'content.posts:read'],
				schemas: ['posts', 'posts'],
			}),
		);
		expect(engine.post.mock.calls[0][1]).toMatchObject({
			scopes: ['content.posts:read', 'content.posts:create', 'flows.order-sync:create'],
			schemas: ['posts'],
		});
	});

	it('lets an admin key through with no scope, because its role decides', async () => {
		const day = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
		await actions.create(event({ name: 'svc', roles: 'admin', expires_at: day }));
		expect(engine.post.mock.calls[0][1]).toMatchObject({ scopes: [] });
	});
});
