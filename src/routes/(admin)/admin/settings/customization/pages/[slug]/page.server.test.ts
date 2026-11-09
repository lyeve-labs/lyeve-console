import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@lyeve-labs/client';

const api = vi.hoisted(() => ({ getCustomPage: vi.fn(), saveCustomPage: vi.fn(), deleteCustomPage: vi.fn() }));
const schemas = vi.hoisted(() => vi.fn(async () => ['posts']));

vi.mock('$lib/server/authz', () => ({
	authedClient: vi.fn(() => ({})),
	requireRole: vi.fn(async () => ({ roles: ['admin'] })),
}));
vi.mock('$lib/api/search-settings', () => ({ listSchemaNames: schemas }));
vi.mock('$lib/api/customization', async (orig) => ({
	...(await orig<typeof import('$lib/api/customization')>()),
	...api,
}));

import { requireRole } from '$lib/server/authz';
import { actions, load } from './+page.server';

function event(roles = ['admin']) {
	return {
		params: { slug: 'launch' },
		parent: async () => ({ user: { roles }, customization: { entitled: true, settings: {}, pages: [] } }),
	} as never;
}

const page = { slug: 'launch', title: 'Launch', description: '', roles: [], blocks: [], position: 0 };

beforeEach(() => {
	vi.clearAllMocks();
	api.getCustomPage.mockResolvedValue(page);
});

describe('custom page editor load', () => {
	it('reads the page and the schemas', async () => {
		const data = (await load(event())) as { customPage: unknown; schemas: string[]; schemasGate: unknown };
		expect(data.customPage).toEqual(page);
		expect(data.schemas).toEqual(['posts']);
		expect(data.schemasGate).toEqual({ state: 'ok' });
	});

	it('refuses an editor in the words the customization tabs use', async () => {
		await expect(load(event(['editor']))).rejects.toMatchObject({
			status: 403,
			body: { message: 'Only an admin or a super admin can open this page.' },
		});
		expect(api.getCustomPage).not.toHaveBeenCalled();
	});

	// A page that exists is never reported missing because the engine or its
	// database did not answer.
	it('answers 404 only for the engine 404', async () => {
		api.getCustomPage.mockRejectedValueOnce(new ApiError(404, 'not found'));
		await expect(load(event())).rejects.toMatchObject({ status: 404, body: { message: 'This page does not exist.' } });
		api.getCustomPage.mockRejectedValueOnce(new ApiError(503, 'unavailable'));
		await expect(load(event())).rejects.toMatchObject({ status: 503 });
		api.getCustomPage.mockRejectedValueOnce(new ApiError(403, 'forbidden'));
		await expect(load(event())).rejects.toMatchObject({ status: 403 });
	});

	it('says the schemas were not read rather than that there are none', async () => {
		schemas.mockRejectedValueOnce(new ApiError(503, 'unavailable'));
		const data = (await load(event())) as { schemas: string[]; schemasGate: unknown };
		expect(data.schemas).toEqual([]);
		expect(data.schemasGate).toEqual({ state: 'unavailable' });
	});

	it('names a role refusal on the schema list as one', async () => {
		schemas.mockRejectedValueOnce(new ApiError(403, 'forbidden'));
		const data = (await load(event())) as { schemasGate: unknown };
		expect(data.schemasGate).toEqual({ state: 'forbidden' });
	});
});

type Failure = { status: number; data: { error: string } };

function actionEvent(fields: Record<string, string> = {}) {
	const body = new FormData();
	body.set('confirmed', 'yes');
	for (const [k, v] of Object.entries(fields)) body.set(k, v);
	return {
		params: { slug: 'launch' },
		request: new Request('http://admin/admin/settings/customization/pages/launch', { method: 'POST', body }),
	} as never;
}

describe('custom page editor writes', () => {
	it.each(['save', 'delete'] as const)('holds %s to an admin', async (name) => {
		vi.mocked(requireRole).mockRejectedValueOnce(Object.assign(new Error('403'), { status: 403 }));
		const event = actionEvent({ page: JSON.stringify(page) });
		await expect(actions[name](event)).rejects.toMatchObject({ status: 403 });
		expect(requireRole).toHaveBeenCalledWith(event, ['admin', 'super_admin']);
		expect(api.saveCustomPage).not.toHaveBeenCalled();
		expect(api.deleteCustomPage).not.toHaveBeenCalled();
	});

	it('saves the page under the address it was opened at, whatever the form claims', async () => {
		api.saveCustomPage.mockResolvedValue(undefined);
		const out = await actions.save(actionEvent({ page: JSON.stringify({ ...page, slug: 'elsewhere', title: 'Launch day' }) }));
		expect(out).toEqual({ saved: true });
		expect(api.saveCustomPage).toHaveBeenCalledWith(expect.anything(), { ...page, slug: 'launch', title: 'Launch day' });
	});

	it('refuses a page the form did not carry as JSON', async () => {
		const out = (await actions.save(actionEvent({ page: '{title:' }))) as Failure;
		expect(out.data.error).toBe('This form is missing its page. Reload the page and try again.');
		expect(api.saveCustomPage).not.toHaveBeenCalled();
	});

	it('shows the first block problem the engine names', async () => {
		api.saveCustomPage.mockRejectedValue(new ApiError(422, 'block 2: chart needs a schema', { error: 'block 2: chart needs a schema', code: 'http_422' }));
		const out = (await actions.save(actionEvent({ page: JSON.stringify(page) }))) as Failure;
		expect(out.data.error).toBe('block 2: chart needs a schema');
	});

	it('deletes the page and returns to the pages tab', async () => {
		api.deleteCustomPage.mockResolvedValue(undefined);
		await expect(actions.delete(actionEvent())).rejects.toMatchObject({ status: 303, location: '/admin/settings/customization/pages' });
		expect(api.deleteCustomPage).toHaveBeenCalledWith(expect.anything(), 'launch');
	});

	it('stays on the page when the engine refuses the delete', async () => {
		api.deleteCustomPage.mockRejectedValue(new ApiError(404, 'page not found', { error: 'page not found', code: 'not_found' }));
		const out = (await actions.delete(actionEvent())) as Failure;
		expect(out.data.error).toBe('page not found');
	});

	it.each([
		['save', 'saveCustomPage', 'Could not save the page. Try again.'],
		['delete', 'deleteCustomPage', 'Could not delete the page. Try again.'],
	] as const)('keeps outage detail off the page on %s', async (name, fn, sentence) => {
		api[fn].mockRejectedValue(new ApiError(503, 'dial tcp 10.0.0.4:5432: connection refused'));
		const out = (await actions[name](actionEvent({ page: JSON.stringify(page) }))) as Failure;
		expect(out.data.error).toBe(sentence);
	});
});
