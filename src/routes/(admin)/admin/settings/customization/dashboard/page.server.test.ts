import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@lyeve-labs/client';
import { listSchemaNames } from '$lib/api/search-settings';

const api = vi.hoisted(() => ({
	getDashboardLayout: vi.fn(),
	saveDashboardLayout: vi.fn(),
	resetDashboardLayout: vi.fn(),
}));
const custom = vi.hoisted(() => ({
	getCustomization: vi.fn(),
	saveCustomization: vi.fn(),
}));
const resolve = vi.hoisted(() => vi.fn(async (_c: unknown, widgets: { id: string }[]) => widgets.map((w) => ({ ...w, heading: w.id }))));

// The preview asks the engine which plugins run, as an action has no layout.
vi.mock('$lib/server/authz', () => ({
	authedClient: vi.fn(() => ({ get: vi.fn(async () => ({ plugins: ['content'], withheld: [] })) })),
	requireRole: vi.fn(async () => ({ roles: ['admin'] })),
}));
vi.mock('$lib/api/search-settings', () => ({ listSchemaNames: vi.fn(async () => ['posts']) }));
vi.mock('$lib/server/dashboard-widgets', () => ({ resolveWidgets: resolve }));
vi.mock('$lib/api/custom-dashboard', async (orig) => ({
	...(await orig<typeof import('$lib/api/custom-dashboard')>()),
	...api,
}));
vi.mock('$lib/api/customization', async (orig) => ({
	...(await orig<typeof import('$lib/api/customization')>()),
	...custom,
}));

import { actions, load } from './+page.server';
import { requireRole } from '$lib/server/authz';

const settings = () => ({
	brand: { name: 'Old', logo_url: '', accent: '', welcome: '' },
	menu: { hidden: [], pinned: [], links: [] },
	home_page: 'welcome',
});
const welcome = { slug: 'welcome', title: 'Welcome', roles: [], position: 0 };

function event(form: Record<string, string> = {}, { roles = ['admin'], running = true } = {}) {
	const fd = new FormData();
	fd.set('confirmed', 'yes');
	for (const [k, v] of Object.entries(form)) fd.append(k, v);
	return {
		request: new Request('http://localhost', { method: 'POST', body: fd }),
		params: {},
		parent: async () => ({
			user: { roles },
			plugins: { state: 'named', running: running ? ['multitenant'] : [], withheld: [] },
		}),
	} as never;
}

const layout = JSON.stringify([
	{ id: 'a', type: 'status_breakdown', width: 'third', schema: 'posts', body: 'stale' },
	{ id: 'b', type: 'text', body: 'For editors', roles: ['editor'] },
]);

beforeEach(() => {
	vi.clearAllMocks();
	api.getDashboardLayout.mockResolvedValue({ entitled: true, custom: false, widgets: [], updated_at: null });
	api.saveDashboardLayout.mockResolvedValue({});
	api.resetDashboardLayout.mockResolvedValue(undefined);
	custom.getCustomization.mockResolvedValue({ entitled: true, settings: settings(), pages: [welcome] });
	custom.saveCustomization.mockImplementation(async (_c: unknown, s: unknown) => s);
});

describe('dashboard editor', () => {
	it('keeps an outage on the layout read apart from a missing route', async () => {
		api.getDashboardLayout.mockRejectedValueOnce(new ApiError(503, 'unavailable'));
		await expect(load(event())).rejects.toMatchObject({ status: 503 });
		api.getDashboardLayout.mockRejectedValueOnce(new ApiError(403, 'forbidden'));
		await expect(load(event())).rejects.toMatchObject({ status: 403 });
		api.getDashboardLayout.mockRejectedValueOnce(new ApiError(404, 'not found'));
		await expect(load(event())).rejects.toMatchObject({ status: 404 });
	});

	it('says the schemas were not read rather than that there are none', async () => {
		vi.mocked(listSchemaNames).mockRejectedValueOnce(new ApiError(503, 'unavailable'));
		const data = (await load(event())) as { schemas: string[]; schemasGate: unknown };
		expect(data.schemas).toEqual([]);
		expect(data.schemasGate).toEqual({ state: 'unavailable' });
	});

	it('names a role refusal on the schema list as one', async () => {
		vi.mocked(listSchemaNames).mockRejectedValueOnce(new ApiError(403, 'forbidden'));
		const data = (await load(event())) as { schemasGate: unknown };
		expect(data.schemasGate).toEqual({ state: 'forbidden' });
	});

	// The tab says why it is closed, as every customization tab does, rather
	// than sending the reader to another tab.
	it('shows the not-enabled state to a tenant without the capability', async () => {
		custom.getCustomization.mockResolvedValue({ entitled: false, settings: settings(), pages: [] });
		const data = (await load(event())) as { entitled: boolean };
		expect(data.entitled).toBe(false);
		expect(api.getDashboardLayout).not.toHaveBeenCalled();
	});

	it('asks nothing while the multitenant plugin does not run', async () => {
		const data = (await load(event({}, { running: false }))) as { entitled: boolean };
		expect(data.entitled).toBe(false);
		expect(custom.getCustomization).not.toHaveBeenCalled();
	});

	it('keeps a failed customization read as its gate', async () => {
		custom.getCustomization.mockRejectedValue(new ApiError(503, 'unavailable'));
		expect(((await load(event())) as { gate: unknown }).gate).toEqual({ state: 'unavailable' });
	});

	it('refuses a reader who is not an admin', async () => {
		await expect(load(event({}, { roles: ['editor'] }))).rejects.toMatchObject({ status: 403 });
	});

	it('reads the layout, the schemas and the pages one can lead the dashboard', async () => {
		const data = (await load(event())) as { schemas: string[]; layout: { custom: boolean }; pages: unknown[]; homePage: string };
		expect(data.schemas).toEqual(['posts']);
		expect(data.layout.custom).toBe(false);
		expect(data.pages).toEqual([welcome]);
		expect(data.homePage).toBe('welcome');
	});

	it('saves the layout the form carries', async () => {
		expect(await actions.save(event({ widgets: layout }))).toEqual({ saved: true });
		expect(api.saveDashboardLayout.mock.calls[0][1]).toHaveLength(2);
	});

	it('refuses an empty layout and points at the reset', async () => {
		const res = (await actions.save(event({ widgets: '[]' }))) as { status: number; data: { error: string } };
		expect(res.status).toBe(400);
		expect(res.data.error).toMatch(/reset/);
		expect(api.saveDashboardLayout).not.toHaveBeenCalled();
	});

	it('refuses a form that carries no layout', async () => {
		expect(((await actions.save(event({ widgets: '{oops' }))) as { status: number }).status).toBe(400);
	});

	it("shows the engine's refusal", async () => {
		api.saveDashboardLayout.mockRejectedValue(Object.assign(new Error('widget 2: "html" is not a widget type'), { status: 422 }));
		const res = (await actions.save(event({ widgets: layout }))) as { status: number };
		expect(res.status).toBe(400);
	});

	it('previews the unsaved layout as the chosen role, sending only what each type reads', async () => {
		const res = (await actions.preview(event({ widgets: layout, as: 'viewer' }))) as { previewAs: string };
		expect(res.previewAs).toBe('viewer');
		const [, widgets, roles, plugins] = resolve.mock.calls[0] as unknown as [unknown, { body?: string }[], string[], unknown];
		expect(roles).toEqual(['viewer']);
		expect(plugins).toEqual({ state: 'named', running: ['content'], withheld: [] });
		expect(widgets[0].body).toBeUndefined();
		expect(api.saveDashboardLayout).not.toHaveBeenCalled();
	});

	it('previews as an admin for a role it does not know', async () => {
		const res = (await actions.preview(event({ widgets: layout, as: 'owner' }))) as { previewAs: string };
		expect(res.previewAs).toBe('admin');
	});

	it('resets to the stock dashboard', async () => {
		expect(await actions.reset(event())).toEqual({ reset: true });
		expect(api.resetDashboardLayout).toHaveBeenCalledOnce();
	});
});

describe('the page above the dashboard', () => {
	const refusal = new ApiError(422, 'home_page names no page', { error: 'home_page names no page', code: 'http_422' });
	const outage = new ApiError(503, 'dial tcp 10.0.0.4:5432: connection refused');

	it('sets the page the dashboard leads with', async () => {
		expect(await actions.home(event({ home_page: 'welcome' }))).toEqual({ homeSaved: true });
		expect((custom.saveCustomization.mock.calls[0][1] as { home_page: string }).home_page).toBe('welcome');
	});

	it('relays a refusal under the key of the form it was made in', async () => {
		custom.saveCustomization.mockRejectedValue(refusal);
		expect(await actions.home(event({ home_page: 'x' }))).toMatchObject({ status: 400, data: { pagesError: 'home_page names no page' } });
	});

	it('keeps an outage body off the page', async () => {
		custom.getCustomization.mockRejectedValue(outage);
		expect(await actions.home(event({ home_page: 'x' }))).toMatchObject({ data: { pagesError: 'Could not save the dashboard page. Try again.' } });
	});

	it('holds home to an admin', async () => {
		vi.mocked(requireRole).mockRejectedValueOnce(Object.assign(new Error('403'), { status: 403 }));
		const e = event({ home_page: 'x' });
		await expect(actions.home(e)).rejects.toMatchObject({ status: 403 });
		expect(requireRole).toHaveBeenCalledWith(e, ['admin', 'super_admin']);
		expect(custom.saveCustomization).not.toHaveBeenCalled();
	});
});
