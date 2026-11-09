import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiError } from '@lyeve-labs/client';

const api = vi.hoisted(() => ({
	getCustomization: vi.fn(),
	saveCustomization: vi.fn(),
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
	menu: { hidden: ['search'], pinned: [], links: [{ label: 'Wiki', url: 'https://wiki.example.com' }] },
	home_page: '',
});

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
	api.getCustomization.mockResolvedValue({ entitled: true, settings: settings(), pages: [] });
	api.saveCustomization.mockImplementation(async (_c: unknown, s: unknown) => s);
});

describe('the menu tab', () => {
	it('asks nothing while the multitenant plugin does not run', async () => {
		const data = (await load(event({}, { running: false }))) as { entitled: boolean };
		expect(data.entitled).toBe(false);
		expect(api.getCustomization).not.toHaveBeenCalled();
	});

	it('refuses a reader who is not an admin', async () => {
		await expect(load(event({}, { roles: ['editor'] }))).rejects.toMatchObject({ status: 403, body: { message: 'Only an admin or a super admin can open this page.' } });
	});

	it('shows the not-enabled state when the plugin says this tenant may not shape its admin', async () => {
		api.getCustomization.mockResolvedValue({ entitled: false, settings: settings(), pages: [] });
		const data = (await load(event({}))) as { entitled: boolean; navChoices: unknown[] };
		expect(data.entitled).toBe(false);
		expect(data.navChoices).toEqual([]);
	});

	it('keeps a failed customization read as its gate', async () => {
		api.getCustomization.mockRejectedValue(new ApiError(503, 'unavailable'));
		expect(((await load(event({}))) as { gate: unknown }).gate).toEqual({ state: 'unavailable' });
	});

	it('offers the menu entries of the plugins that run', async () => {
		const data = (await load(event({}))) as { entitled: boolean; navChoices: { id: string }[] };
		expect(data.entitled).toBe(true);
		const ids = data.navChoices.map((c) => c.id);
		expect(ids).toContain('tenant-costs');
		expect(ids).not.toContain('search');
	});

	it('never pins what it hides', async () => {
		await actions.menu(event({ hidden: ['media'], pinned: ['media', 'flows'] }));
		const saved = api.saveCustomization.mock.calls[0][1];
		expect(saved.menu).toMatchObject({ hidden: ['media'], pinned: ['flows'] });
	});

	it('refuses a link that is neither https nor an admin path', async () => {
		const res = (await actions.addLink(event({ label: 'X', url: 'javascript:alert(1)' }))) as { status: number };
		expect(res.status).toBe(400);
	});
});

describe('menu link', () => {
	const refusal = new ApiError(422, 'home_page names no page', { error: 'home_page names no page', code: 'http_422' });
	const outage = new ApiError(503, 'dial tcp 10.0.0.4:5432: connection refused');

	it('removes the named link and keeps the rest of the menu', async () => {
		expect(await actions.removeLink(event({ index: '0' }))).toEqual({ linkRemoved: true });
		const saved = api.saveCustomization.mock.calls[0][1] as ReturnType<typeof settings>;
		expect(saved.menu.links).toEqual([]);
		expect(saved.menu.hidden).toEqual(['search']);
	});

	it('relays a refusal under the key of the card it was made in', async () => {
		api.saveCustomization.mockRejectedValue(refusal);
		expect(await actions.removeLink(event({ index: '0' }))).toMatchObject({ status: 400, data: { menuError: 'home_page names no page' } });
	});

	it('keeps an outage body off the page', async () => {
		api.getCustomization.mockRejectedValue(outage);
		expect(await actions.removeLink(event({ index: '0' }))).toMatchObject({ data: { menuError: 'Could not remove the link. Try again.' } });
	});

	it.each(['menu', 'addLink', 'removeLink'] as const)('holds %s to an admin', async (name) => {
		vi.mocked(requireRole).mockRejectedValueOnce(Object.assign(new Error('403'), { status: 403 }));
		const e = event({ index: '0', label: 'X', url: 'https://x.example.com' });
		await expect(actions[name](e)).rejects.toMatchObject({ status: 403 });
		expect(requireRole).toHaveBeenCalledWith(e, ['admin', 'super_admin']);
		expect(api.saveCustomization).not.toHaveBeenCalled();
	});
});
