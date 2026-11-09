import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@lyeve-labs/client';
import { forbiddenText } from '$lib/api/gate';

const engine = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('$lib/server/authz', async (importOriginal) => ({
	...((await importOriginal()) as object),
	authedClient: vi.fn(() => engine),
	requireRole: vi.fn(async () => ({ id: 'u1', roles: ['admin'] })),
}));
vi.mock('@lyeve-labs/client-rest', () => ({ getSchemas: vi.fn(async () => [{ name: 'article' }]) }));

import { actions, load } from './+page.server';
import type { DefinitionsPage } from './+page.server';

type Failure = { status: number; data: Record<string, unknown> };

function loadEvent() {
	return {
		url: new URL('http://localhost/admin/reviews/definitions'),
		parent: async () => ({
			user: { id: 'u1', roles: ['admin'] },
			plugins: { state: 'named', running: ['review'], withheld: [] },
		}),
	} as never;
}

function actionEvent(fields: Record<string, string>) {
	const data = new FormData();
	data.set('confirmed', 'yes');
	for (const [k, v] of Object.entries(fields)) data.set(k, v);
	return { request: { formData: async () => data, clone: () => ({ formData: async () => data }) } } as never;
}

beforeEach(() => {
	vi.clearAllMocks();
	engine.get.mockImplementation(async (url: string) => {
		if (url.startsWith('/api/admin/review/definitions?')) {
			return {
				data: [{ id: 'd1', name: 'Editorial', slug: 'editorial', content_schema: 'article' }],
				total_count: 1,
				licensed: false,
				limits: { workflows: { limit: 1, current: 1 } },
			};
		}
		if (url.startsWith('/api/admin/review/definitions/')) {
			return {
				definition: { id: 'd1', name: 'Editorial' },
				stages: [{ id: 's1', name: 'Legal', position: 1, quorum: 2, escalate_to_role: 'lead', condition: { field: 'category', op: 'in', values: ['legal', 4] } }],
			};
		}
		return { data: [], total_count: 0 };
	});
});

describe('the definitions load', () => {
	it('carries what the definitions read says the install allows', async () => {
		const out = (await load(loadEvent())) as DefinitionsPage;
		expect(out.limits).toEqual({ licensed: false, workflows: { limit: 1, current: 1 } });
	});

	it('reads each stage paid settings', async () => {
		const out = (await load(loadEvent())) as DefinitionsPage;
		if (!out.definitions.ok) throw new Error('the definitions read failed');
		expect(out.definitions.value[0].stages?.[0]).toMatchObject({
			quorum: 2,
			escalate_to_role: 'lead',
			condition: { field: 'category', op: 'in', values: ['legal', '4'] },
		});
	});

	it('reads the schemas a definition can review', async () => {
		const out = (await load(loadEvent())) as DefinitionsPage;
		expect(out.schemas).toEqual({ ok: true, value: ['article'] });
	});

	it('keeps a failed definitions read as its gate', async () => {
		engine.get.mockImplementation(async (url: string) => {
			if (url.startsWith('/api/admin/review/definitions?')) throw new ApiError(500, 'internal');
			return { data: [], total_count: 0 };
		});
		const out = (await load(loadEvent())) as DefinitionsPage;
		expect(out.definitions).toMatchObject({ ok: false, gate: { state: 'error' } });
	});

	// The definitions are an administrator's setup, so another role is
	// refused the page rather than shown an empty list.
	it('refuses a reviewer who is not an operator', async () => {
		const out = load({
			url: new URL('http://localhost/admin/reviews/definitions'),
			parent: async () => ({
				user: { id: 'u1', roles: ['editor'] },
				plugins: { state: 'named', running: ['review'], withheld: [] },
			}),
		} as never);
		await expect(out).rejects.toMatchObject({ status: 403, body: { message: forbiddenText('this page', ['admin', 'super_admin']) } });
		expect(engine.get).not.toHaveBeenCalled();
	});
});

describe('creating a definition', () => {
	const fields = {
		name: 'Legal',
		content_schema: 'article',
		stages: JSON.stringify([{ name: 'Legal', sla_duration_seconds: 3600, quorum: 2 }]),
	};

	it('sends the stage quorum', async () => {
		engine.post.mockResolvedValue({ id: 'd2' });
		await actions.create(actionEvent(fields));
		expect(engine.post.mock.calls[0][1]).toMatchObject({ stages: [{ name: 'Legal', quorum: 2 }] });
	});

	it('returns the workflow ceiling refusal with its numbers', async () => {
		engine.post.mockRejectedValue(
			new ApiError(402, 'cap_exceeded', { error: 'cap_exceeded', cap: 'review.workflows', limit: 1, current: 1 }),
		);
		const out = (await actions.create(actionEvent(fields))) as Failure;
		expect(out.status).toBe(402);
		expect(out.data.refused).toMatchObject({ kind: 'cap', limit: 1, current: 1 });
	});

	it('returns a paid stage setting refusal', async () => {
		engine.post.mockRejectedValue(
			new ApiError(402, 'payment_required', { error: 'payment_required', plugin: 'review', feature: 'feature:example_feature' }),
		);
		const out = (await actions.create(actionEvent(fields))) as Failure;
		expect(out.data.refused).toMatchObject({ kind: 'feature', feature: 'example-feature' });
	});
});

describe('the stages of a definition', () => {
	it('marks the stages of a definition whose read failed as unread, never as none', async () => {
		engine.get.mockImplementation(async (url: string) => {
			if (url.startsWith('/api/admin/review/definitions?')) return { data: [{ id: 'd1', name: 'Editorial' }], total_count: 1 };
			if (url.startsWith('/api/admin/review/definitions/')) throw new ApiError(503, 'down');
			return { data: [], total_count: 0 };
		});
		const out = (await load(loadEvent())) as DefinitionsPage;
		expect(out.definitions).toMatchObject({ ok: true, value: [{ definition: { id: 'd1' }, stages: null }] });
	});
});

describe('deleting a definition', () => {
	it('deletes the definition it names', async () => {
		engine.delete.mockResolvedValue(undefined);
		expect(await actions.delete(actionEvent({ id: 'd1' }))).toEqual({ deleted: true });
		expect(engine.delete).toHaveBeenCalledWith('/api/admin/review/definitions/d1');
	});

	// The New definition drawer shows create failures only, so a delete names
	// itself and never opens the next drawer as if the create had failed.
	it('names the delete on a refusal and relays its reason', async () => {
		engine.delete.mockRejectedValue(new ApiError(409, 'definition has active assignments', { error: 'definition has active assignments', code: 'conflict' }));
		const out = (await actions.delete(actionEvent({ id: 'd1' }))) as Failure;
		expect(out.data).toEqual({ action: 'delete', error: 'definition has active assignments' });
	});

	it('keeps outage detail out of the message', async () => {
		engine.delete.mockRejectedValue(new ApiError(503, 'pq: down'));
		expect(((await actions.delete(actionEvent({ id: 'd1' }))) as Failure).data).toEqual({
			action: 'delete',
			error: 'Could not delete the definition. Try again.',
		});
	});

	it('refuses an editor before it reaches the plugin', async () => {
		const { requireRole } = await import('$lib/server/authz');
		vi.mocked(requireRole).mockRejectedValueOnce(Object.assign(new Error('403'), { status: 403 }));
		await expect(actions.delete(actionEvent({ id: 'd1' }))).rejects.toMatchObject({ status: 403 });
		expect(engine.delete).not.toHaveBeenCalled();
	});

	it('names the create on a refused create', async () => {
		engine.post.mockRejectedValue(new ApiError(409, 'slug already in use', { error: 'slug already in use', code: 'conflict' }));
		const out = (await actions.create(actionEvent({ name: 'Editorial', stages: '[{"name":"Legal"}]' }))) as Failure;
		expect(out.data).toMatchObject({ action: 'create', error: 'slug already in use' });
	});
});
