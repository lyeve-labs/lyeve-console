import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiError } from '@lyeve-labs/client';

const api = vi.hoisted(() => ({
	listJobs: vi.fn(),
	getJob: vi.fn(),
	listRows: vi.fn(),
	listTemplates: vi.fn(),
	rollbackJob: vi.fn(),
	cancelJob: vi.fn(),
	createTemplate: vi.fn(),
	updateTemplate: vi.fn(),
	deleteTemplate: vi.fn(),
}));

vi.mock('$lib/api/bulk-import', async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	...api,
}));

vi.mock('@lyeve-labs/client-rest', () => ({ getSchemas: vi.fn(async () => []) }));

vi.mock('$lib/server/authz', () => ({
	authedClient: vi.fn(() => ({})),
	requireRole: vi.fn(async () => ({ id: 'u1', roles: ['admin'] })),
}));

import { load, actions } from './+page.server';
import { requireRole } from '$lib/server/authz';

type Loaded = Exclude<Awaited<ReturnType<typeof load>>, void>;

function loadEvent(query = '') {
	return {
		url: new URL(`http://admin/admin/imports${query}`),
		fetch: vi.fn(),
		cookies: {},
		depends: vi.fn(),
		parent: async () => ({ user: { roles: ['admin'] } }),
	} as never;
}

function formEvent(fields: Record<string, string>) {
	const body = new FormData();
	body.set('confirmed', 'yes');
	for (const [k, v] of Object.entries(fields)) body.set(k, v);
	return {
		request: new Request('http://admin/admin/imports', { method: 'POST', body }),
		cookies: {},
		fetch: vi.fn(),
	} as never;
}

const template = {
	id: 't1',
	name: 'Orders',
	content_type: 'orders',
	mode: 'upsert',
	upsert_key: 'entry.slug',
	field_mappings: [{ source_field: 'Placed', target_field: 'placed_at', transform: 'date', transform_options: { layout: '02/01/2006' } }],
	created_at: '2026-10-01T00:00:00Z',
	updated_at: '2026-10-01T00:00:00Z',
};

const mapping = JSON.stringify([{ source_field: 'Name', target_field: 'title', data_type: 'string' }]);

beforeEach(() => {
	vi.clearAllMocks();
	api.listJobs.mockResolvedValue({ data: [], total_count: 0 });
	api.listTemplates.mockResolvedValue({ licensed: false, templates: [template] });
});

describe('imports load', () => {
	// The wizard offers the saved mappings, so the history reads them too.
	it('hands the wizard the templates and whether this install may name a paid transform', async () => {
		const result = (await load(loadEvent())) as Loaded;
		expect(result.templates).toEqual([template]);
		expect(result.templatesFailed).toBe(false);
		expect(result.licensed).toBe(false);
	});

	it('offers the wizard no template when the read failed', async () => {
		api.listTemplates.mockRejectedValue(new Error('down'));
		const result = (await load(loadEvent())) as Loaded;
		expect(result.templates).toEqual([]);
		expect(result.templatesFailed).toBe(true);
		expect(result.licensed).toBeNull();
	});

	it('reports no failure when the plugin serves no templates', async () => {
		api.listTemplates.mockRejectedValue(new ApiError(404, 'not found'));
		const result = (await load(loadEvent())) as Loaded;
		expect(result.templates).toEqual([]);
		expect(result.templatesFailed).toBe(false);
	});
});

describe('imports load keeps failed reads apart from empty ones', () => {
	it('keeps an unread content type list as a failure', async () => {
		const rest = await import('@lyeve-labs/client-rest');
		vi.mocked(rest.getSchemas).mockRejectedValueOnce(new Error('down'));
		const result = (await load(loadEvent())) as Loaded;
		expect(result.schemas.ok).toBe(false);
	});

	it('hands over the content types a read answered with', async () => {
		const result = (await load(loadEvent())) as Loaded;
		expect(result.schemas).toEqual({ ok: true, value: [] });
	});

	it('opens the rows panel with the failure when the job cannot be read', async () => {
		api.getJob.mockRejectedValue(new ApiError(404, 'not found'));
		api.listRows.mockResolvedValue({ rows: [], total: 0 });
		const result = (await load(loadEvent('?job=j9'))) as Loaded;
		expect(result.detail).toEqual({ ok: false, gate: { state: 'absent' } });
	});

	it('reads no rows panel when none was asked for', async () => {
		const result = (await load(loadEvent())) as Loaded;
		expect(result.detail).toBeNull();
	});

	it('sends a page past the end back to the last page', async () => {
		api.listJobs.mockResolvedValue({ data: [], total_count: 30 });
		await expect(load(loadEvent('?offset=100'))).rejects.toMatchObject({
			status: 307,
			location: '/admin/imports?offset=25',
		});
	});
});

describe('rollback', () => {
	// The engine admits any admin to the rollback route, so the console asks
	// for no more than that.
	it('takes a rollback from an admin', async () => {
		api.rollbackJob.mockResolvedValue(undefined);
		expect(await actions.rollback(formEvent({ id: 'j1' }))).toEqual({ rolledBack: 'j1' });
		expect(requireRole).toHaveBeenCalledWith(expect.anything(), ['admin', 'super_admin']);
	});
});

describe('canceling an import', () => {
	type Failure = { status: number; data: Record<string, unknown> };

	it('cancels the import it names', async () => {
		api.cancelJob.mockResolvedValue(undefined);
		expect(await actions.cancel(formEvent({ id: 'j1' }))).toEqual({ canceled: 'j1' });
		expect(api.cancelJob).toHaveBeenCalledWith(expect.anything(), 'j1');
	});

	it('names the cancel on a refusal and relays its reason', async () => {
		api.cancelJob.mockRejectedValue(new ApiError(409, 'job is not running', { error: 'job is not running', code: 'conflict' }));
		expect(((await actions.cancel(formEvent({ id: 'j1' }))) as Failure).data).toEqual({ action: 'cancel', error: 'job is not running' });
	});

	it('keeps outage detail out of the message', async () => {
		api.cancelJob.mockRejectedValue(new ApiError(503, 'pq: down'));
		expect(((await actions.cancel(formEvent({ id: 'j1' }))) as Failure).data).toEqual({
			action: 'cancel',
			error: 'Could not cancel the import. Try again.',
		});
	});

	it('refuses an editor before it reaches the plugin', async () => {
		vi.mocked(requireRole).mockRejectedValueOnce(Object.assign(new Error('403'), { status: 403 }));
		await expect(actions.cancel(formEvent({ id: 'j1' }))).rejects.toMatchObject({ status: 403 });
		expect(api.cancelJob).not.toHaveBeenCalled();
	});
});
