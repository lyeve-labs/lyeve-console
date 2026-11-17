import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@lyeve-labs/client';

const engine = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
const authz = vi.hoisted(() => ({ roles: ['super_admin'] as string[] }));
vi.mock('#lib/server/authz.ts', async (importOriginal) => ({
	...((await importOriginal()) as object),
	authedClient: vi.fn(() => engine),
	requireRole: vi.fn(async (_event: unknown, allowed: string[]) => {
		if (!allowed.some((r) => authz.roles.includes(r))) throw new Error('403');
		return { id: 'u1', roles: authz.roles };
	}),
}));

import { actions } from './+page.server';

function event(fields: Record<string, string>, address = 'http://localhost/admin/jobs?/save') {
	const data = new FormData();
	data.set('confirmed', 'yes');
	for (const [k, v] of Object.entries(fields)) data.set(k, v);
	return {
		url: new URL(address),
		request: { formData: async () => data, clone: () => ({ formData: async () => data }) },
	} as never;
}

type Failure = { status: number; data: Record<string, unknown> };

const job = { name: 'digest', schedule: '0 9 * * *', endpoint: 'https://x.example.com', enabled: 'on' };

beforeEach(() => {
	vi.clearAllMocks();
	authz.roles = ['super_admin'];
});

describe('the jobs role check', () => {
	// The cron plugin serves the job writes to a super admin only.
	it.each(['create', 'update', 'delete'] as const)('refuses %s to an admin', async (name) => {
		authz.roles = ['admin'];
		await expect(actions[name](event({ ...job, id: 'j1' }))).rejects.toThrow('403');
		expect(engine.post).not.toHaveBeenCalled();
		expect(engine.put).not.toHaveBeenCalled();
		expect(engine.delete).not.toHaveBeenCalled();
	});
});

describe('returning to the list', () => {
	// The drawer and each row post with the page the reader had open, less the
	// key that opened the drawer, so a write lands back on that page.
	it.each(['create', 'update', 'delete'] as const)('%s returns to the page the reader had open', async (name) => {
		engine.post.mockResolvedValue({});
		engine.put.mockResolvedValue({});
		engine.delete.mockResolvedValue(undefined);
		const at = `http://localhost/admin/jobs?offset=50&edit=j1&/${name}`;
		await expect(actions[name](event({ ...job, id: 'j1' }, at))).rejects.toMatchObject({
			status: 303,
			location: '/admin/jobs?offset=50',
		});
	});
});

describe('clearing a payload', () => {
	// The plugin reads a null payload as "leave it", so a cleared field
	// travels as an empty object.
	it('sends an empty object when a job that had a payload is saved without one', async () => {
		engine.put.mockResolvedValue({});
		await expect(actions.update(event({ ...job, id: 'j1', payload: '', had_payload: 'true' }))).rejects.toMatchObject({
			status: 303,
		});
		expect(engine.put.mock.calls[0][1].payload).toEqual({});
	});

	it('sends no payload for a job that never had one', async () => {
		engine.put.mockResolvedValue({});
		await expect(actions.update(event({ ...job, id: 'j1', payload: '' }))).rejects.toMatchObject({ status: 303 });
		expect(engine.put.mock.calls[0][1].payload).toBeNull();
	});
});

describe('which form a failure belongs to', () => {
	it('tags a failed update for the drawer', async () => {
		engine.put.mockRejectedValue(new ApiError(422, 'schedule fires more than once a minute', { error: 'schedule fires more than once a minute', code: 'http_422' }));
		const out = (await actions.update(event({ ...job, id: 'j1' }))) as Failure;
		expect(out.data).toMatchObject({ action: 'update', error: 'schedule fires more than once a minute' });
	});

	it('tags a failed create for the drawer', async () => {
		const out = (await actions.create(event({ ...job, payload: '{' }))) as Failure;
		expect(out.data.action).toBe('create');
	});
});

describe('deleting a job', () => {
	it('deletes the job it names and returns to the list', async () => {
		engine.delete.mockResolvedValue(undefined);
		await expect(actions.delete(event({ id: 'j1' }))).rejects.toMatchObject({ status: 303 });
		expect(engine.delete).toHaveBeenCalledWith('/api/admin/jobs/j1');
	});

	it("relays the plugin's refusal, tagged for the page", async () => {
		engine.delete.mockRejectedValue(new ApiError(404, 'job not found', { error: 'job not found', code: 'not_found' }));
		const out = (await actions.delete(event({ id: 'j1' }))) as Failure;
		expect(out.data).toEqual({ error: 'job not found', action: 'delete' });
	});

	it('says an outage failed the delete', async () => {
		engine.delete.mockRejectedValue(new ApiError(503, 'down', {}));
		const out = (await actions.delete(event({ id: 'j1' }))) as Failure;
		expect(out.data).toEqual({ error: 'Could not delete the job. Try again.', action: 'delete' });
	});
});
