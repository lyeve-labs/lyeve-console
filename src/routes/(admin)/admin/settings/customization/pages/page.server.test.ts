import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiError } from '@lyeve-labs/client';

const api = vi.hoisted(() => ({
	getCustomization: vi.fn(),
	saveCustomPage: vi.fn(),
	deleteCustomPage: vi.fn(),
}));

const client = vi.hoisted(() => ({}));

vi.mock('$lib/server/authz', () => ({
	authedClient: vi.fn(() => client),
	requireRole: vi.fn(async () => ({ roles: ['admin'] })),
}));
vi.mock('$lib/api/customization', async (orig) => ({
	...(await orig<typeof import('$lib/api/customization')>()),
	...api,
}));

import { actions, load } from './+page.server';
import { requireRole } from '$lib/server/authz';

const settings = () => ({
	brand: { name: 'Old', logo_url: '', accent: '', welcome: '' },
	menu: { hidden: [], pinned: [], links: [] },
	home_page: 'welcome',
});
const welcome = { slug: 'welcome', title: 'Welcome', roles: [], position: 0 };

function event(form: Record<string, string | string[]>, { running = true, roles = ['admin'] } = {}) {
	const fd = new FormData();
	fd.set('confirmed', 'yes');
	for (const [k, v] of Object.entries(form)) for (const x of [v].flat()) fd.append(k, x);
	return {
		request: new Request('http://localhost', { method: 'POST', body: fd }),
		params: {},
		parent: async () => ({
			user: { roles },
			plugins: { state: 'named', running: running ? ['multitenant'] : [], withheld: [] },
		}),
	} as never;
}

beforeEach(() => {
	vi.clearAllMocks();
	api.getCustomization.mockResolvedValue({ entitled: true, settings: settings(), pages: [welcome] });
});

describe('the pages tab', () => {
	it('asks nothing while the multitenant plugin does not run', async () => {
		const data = (await load(event({}, { running: false }))) as { entitled: boolean; pages: unknown[] };
		expect(data.entitled).toBe(false);
		expect(data.pages).toEqual([]);
		expect(api.getCustomization).not.toHaveBeenCalled();
	});

	it('refuses a reader who is not an admin', async () => {
		await expect(load(event({}, { roles: ['viewer'] }))).rejects.toMatchObject({ status: 403, body: { message: 'Only an admin or a super admin can open this page.' } });
	});

	it('keeps a failed customization read as its gate, never as no pages', async () => {
		api.getCustomization.mockRejectedValue(new ApiError(503, 'unavailable'));
		const data = (await load(event({}))) as { gate: unknown; entitled: boolean };
		expect(data.gate).toEqual({ state: 'unavailable' });
		expect(data.entitled).toBe(false);
	});

	it('reads the pages and which one leads the dashboard', async () => {
		const data = (await load(event({}))) as { pages: unknown[]; settings: { home_page: string } };
		expect(data.pages).toEqual([welcome]);
		expect(data.settings.home_page).toBe('welcome');
	});

	it('creates a page from its title and opens its editor', async () => {
		api.getCustomization.mockResolvedValue({ entitled: true, settings: settings(), pages: [] });
		await expect(actions.createPage(event({ title: 'Launch checklist', slug: '' }))).rejects.toMatchObject({
			status: 303,
			location: '/admin/settings/customization/pages/launch-checklist',
		});
		expect(api.saveCustomPage.mock.calls[0][1]).toMatchObject({ slug: 'launch-checklist', title: 'Launch checklist', blocks: [] });
	});

	it('deletes the named page', async () => {
		api.deleteCustomPage.mockResolvedValue(undefined);
		expect(await actions.deletePage(event({ slug: 'welcome' }))).toEqual({ pageDeleted: true });
		expect(api.deleteCustomPage).toHaveBeenCalledWith(client, 'welcome');
	});

	it.each(['createPage', 'deletePage'] as const)('holds %s to an admin', async (name) => {
		vi.mocked(requireRole).mockRejectedValueOnce(Object.assign(new Error('403'), { status: 403 }));
		const e = event({ title: 'X', slug: 'x' });
		await expect(actions[name](e)).rejects.toMatchObject({ status: 403 });
		expect(requireRole).toHaveBeenCalledWith(e, ['admin', 'super_admin']);
		expect(api.saveCustomPage).not.toHaveBeenCalled();
		expect(api.deleteCustomPage).not.toHaveBeenCalled();
	});
});

describe('a failed page delete', () => {
	it('reports under its own key, which the Pages card draws', async () => {
		api.deleteCustomPage.mockRejectedValue(new ApiError(404, 'page not found', { error: 'page not found', code: 'not_found' }));
		expect(await actions.deletePage(event({ slug: 'gone' }))).toMatchObject({ status: 400, data: { pageDeleteError: 'page not found' } });
		api.deleteCustomPage.mockRejectedValue(new ApiError(503, 'dial tcp 10.0.0.4:5432: connection refused'));
		expect(await actions.deletePage(event({ slug: 'x' }))).toMatchObject({ data: { pageDeleteError: 'Could not delete the page. Try again.' } });
	});
});
