// @vitest-environment jsdom
import { render, cleanup, screen, fireEvent, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';

/**
 * The pathname is what decides which row is current, so a case sets it.
 *
 * `navigating` is here because the shell reads it for the route progress bar.
 * A factory that returns one export makes every other one undefined, and the
 * layout then throws before any assertion runs.
 */
const state = vi.hoisted(() => ({
	page: { url: new URL('http://localhost/admin') },
	navigating: { to: null, from: null, type: null },
}));

vi.mock('$app/state', () => state);
const navigation = vi.hoisted(() => ({ after: [] as (() => void)[] }));
vi.mock('$app/navigation', () => ({
	onNavigate: () => {},
	afterNavigate: (fn: () => void) => navigation.after.push(fn),
}));
vi.mock('$app/paths', () => ({ asset: (path: string) => path }));
vi.mock('$lib/api/csrf', () => ({ csrfHeaders: () => ({}) }));
// Additive, not a replacement. A factory returning one export makes every other
// kit import in the layout undefined, and the shell then fails to render before
// any assertion runs. Toaster alone is stubbed: it mounts a document-level
// portal and starts a timer per toast, neither of which any case here needs.
vi.mock('@lyeve-labs/ui-kit', async (importOriginal) => ({
	...(await importOriginal<typeof import('@lyeve-labs/ui-kit')>()),
	Toaster: (() => {}) as unknown,
}));

import AdminLayout from './+layout.svelte';
import { licensingOf, NO_LICENSING } from '$lib/api/license';
import EmptyChildren from './layout-empty-children.test.svelte';
import UnderRoot from './layout-under-root.test.svelte';
import FocusChild from './layout-focus-child.test.svelte';

const EDITOR = ['editor'];
const ADMIN = ['admin'];
const SUPER = ['super_admin'];

const data = { user: { email: 'a@b.c', roles: SUPER } };

/** Drive matchMedia, which is what decides mobile from desktop. */
function setViewport(mobile: boolean) {
	const listeners = new Set<(e: MediaQueryListEvent) => void>();
	Object.defineProperty(window, 'matchMedia', {
		writable: true,
		value: () => ({
			matches: mobile,
			addEventListener: (_: string, fn: (e: MediaQueryListEvent) => void) => listeners.add(fn),
			removeEventListener: (_: string, fn: (e: MediaQueryListEvent) => void) => listeners.delete(fn),
		}),
	});
}

/** The viewport and the path have to be settled before the shell mounts. */
async function mount(roles: string[], path = '/admin', mobile = false) {
	setViewport(mobile);
	state.page.url = new URL(`http://localhost${path}`);
	render(AdminLayout, {
		props: { data: { user: { email: 'a@b.c', roles } }, children: EmptyChildren } as never,
	});
	await tick();
}

/** Every label the sidebar offers as a destination. */
function linkNames(): string[] {
	return [...document.querySelectorAll('nav a')].map((a) => a.textContent?.trim() ?? '');
}

function link(name: string): HTMLElement {
	return screen.getByRole('link', { name });
}

beforeEach(() => {
	vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ pending: 0 }) }));
});

afterEach(() => {
	cleanup();
	navigation.after.length = 0;
	vi.unstubAllGlobals();
	// The kit persists which sections a reader opened. Left behind, one case's
	// disclosure decides the next case's tree.
	localStorage.clear();
});

describe('admin shell navigation', () => {
	it('keeps the sidebar reachable and offers no hamburger on a desktop viewport', async () => {
		setViewport(false);
		render(AdminLayout, { props: { data, children: EmptyChildren } as never });
		await tick();

		const aside = document.querySelector('aside') as HTMLElement | null;
		expect(aside).not.toBeNull();
		// The property, not the attribute: inert is a reflected IDL attribute in
		// a browser, and jsdom sets the property without reflecting it.
		expect(aside!.inert, 'desktop sidebar must stay reachable').toBe(false);
		expect(screen.queryByRole('button', { name: /open navigation/i })).toBeNull();
	});

	it('hides the sidebar behind a hamburger on a narrow viewport, and opens it', async () => {
		setViewport(true);
		render(AdminLayout, { props: { data, children: EmptyChildren } as never });
		await tick();

		const aside = document.querySelector('aside') as HTMLElement;
		expect(aside.inert, 'a closed drawer is inert').toBe(true);
		expect(aside.getAttribute('aria-hidden')).toBe('true');

		const button = screen.getByRole('button', { name: /open navigation/i });
		await fireEvent.click(button);

		// Re-queried, not reused. The shell renders the closed sidebar and the
		// open drawer from separate branches, so opening it replaces the element:
		// a held reference reports the state of the one that just left the page.
		const open = document.querySelector('aside') as HTMLElement;
		expect(open.inert, 'an open drawer is reachable').toBe(false);
		expect(open.getAttribute('aria-hidden')).toBeNull();
		expect(document.querySelectorAll('aside'), 'still one aside').toHaveLength(1);
	});
});

describe('admin shell drawer after a navigation', () => {
	// On a phone a sidebar link opens its page under the drawer, which stayed
	// open over the new page until the scrim was tapped.
	it('closes the drawer once a navigation completes', async () => {
		setViewport(true);
		render(AdminLayout, { props: { data, children: EmptyChildren } as never });
		await tick();
		await fireEvent.click(screen.getByRole('button', { name: /open navigation/i }));
		expect((document.querySelector('aside') as HTMLElement).inert).toBe(false);

		for (const fn of navigation.after) fn();
		await tick();

		expect((document.querySelector('aside') as HTMLElement).inert, 'the drawer closed').toBe(true);
	});
});

describe('admin shell landmarks', () => {
	it('leaves one aside in the page, named, so the drawer has one landmark', async () => {
		await mount(SUPER);

		// The kit's SidebarNav renders a nav and no landmark of its own. A second
		// aside would give the drawer two landmarks, and the cases above locate
		// the drawer in strict mode.
		expect(document.querySelectorAll('aside')).toHaveLength(1);
		expect(document.querySelector('aside')?.getAttribute('aria-label')).toBe('Console sidebar');
	});

	it('opens the document with a skip link that reaches the main region', async () => {
		await mount(SUPER);

		const first = document.querySelector('a') as HTMLAnchorElement;
		expect(first.textContent?.trim()).toBe('Skip to content');
		expect(first.getAttribute('href')).toBe('#content');
		expect(document.querySelector('main')?.id).toBe('content');
	});
});

describe('admin shell role gate', () => {
	it('gives an editor the daily destinations the engine answers it and nothing privileged', async () => {
		await mount(EDITOR);

		const names = linkNames();
		expect(names).toContain('Schema builder');
		expect(names).toContain('Reviews');
		// Both open on admin routes, which the engine refuses an editor.
		expect(names).not.toContain('Content');
		expect(names).not.toContain('Media library');
		expect(names).not.toContain('Users');
		expect(names).not.toContain('Audit log');
		expect(names).not.toContain('Tenants');
	});

	it('gives an admin what already happened, but not who may act', async () => {
		await mount(ADMIN);

		const names = linkNames();
		expect(names).toContain('Audit log');
		expect(names).toContain('Plugins');
		expect(names).not.toContain('Users');
		expect(names).not.toContain('API Keys');
		expect(names).not.toContain('Configuration');
	});

	it('gives a super admin the sections the other two tiers do not see', async () => {
		await mount(SUPER);

		const names = linkNames();
		expect(names).toContain('Users');
		expect(names).toContain('Tenants');
		expect(names).toContain('Configuration');
		expect(names).toContain('Audit log');
	});
});

describe('admin shell active row', () => {
	it('marks the active leaf and its section, and not the section as the page', async () => {
		await mount(SUPER, '/admin/settings/permissions');

		const current = [...document.querySelectorAll('[aria-current="page"]')];
		expect(current, 'exactly one row is the page').toHaveLength(1);
		expect(current[0].textContent).toContain('Permissions');

		// The section says "you are somewhere in here" without claiming the page.
		expect(screen.getByRole('button', { name: 'Access' }).getAttribute('aria-current')).toBe('true');

		// A pathname.startsWith(href + '/') rule on every entry would light
		// Settings alongside its own sub-page.
		expect(link('Settings').getAttribute('aria-current')).toBeNull();
	});

	it('does not light a sibling whose href is a prefix of the active one', async () => {
		await mount(SUPER, '/admin/webhooks/incoming');

		expect(link('Incoming webhooks').getAttribute('aria-current')).toBe('page');
		expect(link('Webhooks').getAttribute('aria-current')).toBeNull();
	});

	it('lights Plugins from a plugin detail route', async () => {
		await mount(SUPER, '/admin/plugins/search');

		expect(link('Plugins').getAttribute('aria-current')).toBe('page');
	});

	it('keeps the dashboard off every page but its own', async () => {
		await mount(SUPER, '/admin/content');

		expect(link('Content').getAttribute('aria-current')).toBe('page');
		expect(link('Dashboard').getAttribute('aria-current')).toBeNull();
	});
});

describe('admin shell header', () => {
	it('names a page the sidebar does not list by its own title', async () => {
		await mount(SUPER, '/admin/settings/mfa');

		expect(screen.getByText('Settings / Two-factor authentication')).toBeTruthy();
	});
});

describe('admin shell mobile drawer', () => {
	it('puts Users on screen the moment the drawer opens', async () => {
		await mount(SUPER, '/admin', true);
		await fireEvent.click(screen.getByRole('button', { name: /open navigation/i }));

		const users = link('Users');
		expect(users.getAttribute('href')).toBe('/admin/users');

		// The kit renders a collapsed section and hides it with a display utility,
		// so the link is in the DOM either way. Users has to be visible with no
		// further interaction, which only holds while the section holding it
		// ships expanded.
		//
		// A section list is the one the disclosure names through aria-controls,
		// so it is the only list here carrying an id. Matching on that rather
		// than on a role keeps this about the shell's own contract.
		const group = users.closest('ul[id]');
		expect(group, 'Users sits inside a section').not.toBeNull();
		expect(group!.className).toContain('flex');
		expect(group!.className).not.toContain('hidden');
	});

	it('announces itself as a modal and closes on Escape', async () => {
		await mount(SUPER, '/admin', true);
		const aside = document.querySelector('aside') as HTMLElement;
		await fireEvent.click(screen.getByRole('button', { name: /open navigation/i }));

		expect(screen.getByRole('dialog', { name: 'Navigation' })).not.toBeNull();

		// A backdrop tap is the pointer's way out. A keyboard has none.
		await fireEvent.keyDown(window, { key: 'Escape' });
		expect(aside.inert, 'Escape closes the drawer').toBe(true);
	});
});

describe('admin shell focus mode', () => {
	it('narrows the sidebar to the rail and puts the header away when the page asks, and restores the sidebar choice after', async () => {
		setViewport(false);
		render(AdminLayout, { props: { data, children: FocusChild } as never });
		await tick();
		expect(document.querySelector('header')).not.toBeNull();
		expect(document.querySelector('aside')).not.toBeNull();
		expect(screen.queryByTestId('app-rail')).toBeNull();

		await fireEvent.click(screen.getByTestId('ask-focus'));
		expect(document.querySelector('header')).toBeNull();
		// The sidebar stays, as the icon rail: every section is still one hover
		// or one Tab away, and the labels stay in the accessible names.
		const rail = screen.getByTestId('app-rail');
		expect(rail.querySelector('aside')).not.toBeNull();
		expect(rail.querySelector('a[href="/admin/content"]')?.textContent).toContain('Content');
		// The reader's own preference was never touched.
		expect(localStorage.getItem('lyeve-admin-sidebar-collapsed')).not.toBe('1');

		await fireEvent.click(screen.getByTestId('ask-focus'));
		expect(document.querySelector('header')).not.toBeNull();
		expect(screen.queryByTestId('app-rail')).toBeNull();
		expect(document.querySelector('aside')).not.toBeNull();
	});

	it('names the home link on the rail, where the wordmark is gone', async () => {
		setViewport(false);
		render(AdminLayout, { props: { data, children: FocusChild } as never });
		await tick();
		expect(screen.getByRole('link', { name: 'LyEve home' }).getAttribute('href')).toBe('/');

		await fireEvent.click(screen.getByTestId('ask-focus'));
		const rail = screen.getByTestId('app-rail');
		expect(within(rail).getByRole('link', { name: 'LyEve home' }).getAttribute('href')).toBe('/');
	});

	it('keeps the header and its hamburger on a narrow viewport, since the drawer has no other way in', async () => {
		setViewport(true);
		render(AdminLayout, { props: { data, children: FocusChild } as never });
		await tick();
		await fireEvent.click(screen.getByTestId('ask-focus'));
		expect(document.querySelector('header')).not.toBeNull();
		expect(screen.getByRole('button', { name: /open navigation/i })).toBeTruthy();
	});
});

describe('admin shell support link', () => {
	function linkNamed(name: string): HTMLAnchorElement | undefined {
		return [...document.querySelectorAll('a')].find((a) => a.textContent?.trim() === name);
	}

	async function mountWith(extra: Record<string, unknown>) {
		setViewport(false);
		state.page.url = new URL('http://localhost/admin');
		render(AdminLayout, {
			props: { data: { user: { email: 'a@b.c', roles: SUPER }, ...extra }, children: EmptyChildren } as never,
		});
		await tick();
	}

	it('offers the support link the license module serves, in its words, in a tab of its own', async () => {
		await mountWith({
			licensing: licensingOf({ links: [{ rel: 'support', label: 'Help', url: 'https://example.test/help' }], renew: false }),
		});
		const link = linkNamed('Help');
		expect(link?.getAttribute('href')).toBe('https://example.test/help');
		expect(link?.getAttribute('target')).toBe('_blank');
	});

	it('offers no support link when no license module serves one', async () => {
		await mountWith({
			entitlements: { plan: '', state: '', features: [], tenant_quota: 0, license_module: false },
			licensing: NO_LICENSING,
		});
		expect(linkNamed('Support')).toBeUndefined();
		cleanup();
		await mount(SUPER);
		expect(linkNamed('Support')).toBeUndefined();
	});
});

describe('admin shell account menu', () => {
	function accountMenu(): HTMLDetailsElement | undefined {
		return [...document.querySelectorAll('details')].find((d) =>
			d.querySelector('summary')?.textContent?.includes('a@b.c'),
		);
	}

	it('names the roles under the email as people read them, not as the engine stores them', async () => {
		await mount(SUPER);
		expect(accountMenu()?.textContent).toContain('super admin');
		expect(accountMenu()?.textContent).not.toContain('super_admin');
		cleanup();
		await mount(['admin', 'editor']);
		expect(accountMenu()?.textContent).toContain('admin, editor');
	});
});

describe('admin shell plugin gate', () => {
	const kernel = { state: 'named', running: [], withheld: [] };

	async function mountWith(path: string, extra: Record<string, unknown>, roles = SUPER) {
		setViewport(false);
		state.page.url = new URL(`http://localhost${path}`);
		render(AdminLayout, {
			props: { data: { user: { email: 'a@b.c', roles }, ...extra }, children: EmptyChildren } as never,
		});
		await tick();
	}

	it('shows why in place of a page whose plugin does not run', async () => {
		await mountWith('/admin/search', { plugins: kernel }, EDITOR);
		expect(screen.queryByTestId('page')).toBeNull();
		expect(screen.getByTestId('not-running').dataset.state).toBe('unexplained');
		expect(screen.getByRole('heading', { name: 'Search', level: 1 })).toBeTruthy();
	});

	it('heads the reason one level under the page title', async () => {
		await mountWith('/admin/search', { plugins: kernel }, EDITOR);
		expect(screen.getByRole('heading', { name: 'Not running', level: 2 })).toBeTruthy();
	});

	// The tab names the plugin's page and the tenant, as any other page's does.
	it('titles the tab after the page whose plugin does not run', async () => {
		setViewport(false);
		state.page.url = new URL('http://localhost/admin/search');
		const brand = { name: 'Acme Studio', logo_url: '', accent: '', favicon_url: '' };
		(state.page as { data?: unknown }).data = { brand };
		try {
			render(UnderRoot, {
				props: { data: { user: { email: 'a@b.c', roles: EDITOR }, plugins: kernel, brand } } as never,
			});
			await tick();
			expect(screen.getByTestId('not-running')).toBeTruthy();
			expect(document.title).toBe('Search - Acme Studio');
		} finally {
			delete (state.page as { data?: unknown }).data;
		}
	});

	it('gives an operator the reason the status report carries', async () => {
		const pluginStatus = {
			compiled: ['search'],
			entitled: [],
			plugins: [{ name: 'search', compiled: true, entitled: false, requested: true, active: false, phase: 'registered' }],
		};
		await mountWith('/admin/search', { plugins: kernel, pluginStatus });
		expect(screen.getByTestId('not-running').dataset.state).toBe('not-enabled');
		expect(screen.getByTestId('not-enabled')).toBeTruthy();
	});

	it('gates a page below its entry and a page with no row of its own', async () => {
		await mountWith('/admin/flows/abc', { plugins: kernel });
		expect(screen.getByTestId('not-running').dataset.plugin).toBe('flow');
		cleanup();
		await mountWith('/admin/settings/mfa', { plugins: kernel });
		expect(screen.getByTestId('not-running').dataset.plugin).toBe('mfa');
	});

	it('says a page withheld from this tenant was withheld', async () => {
		await mountWith('/admin/media', { plugins: { state: 'named', running: [], withheld: ['media'] } }, EDITOR);
		expect(screen.getByTestId('not-running').dataset.state).toBe('withheld');
	});

	it('renders the page while its plugin runs, and every page the engine owns', async () => {
		await mountWith('/admin/search', { plugins: { state: 'named', running: ['search'], withheld: [] } });
		expect(screen.getByTestId('page')).toBeTruthy();
		cleanup();
		await mountWith('/admin/users', { plugins: kernel });
		expect(screen.getByTestId('page')).toBeTruthy();
		expect(screen.queryByTestId('not-running')).toBeNull();
	});

	it('renders the page when the list could not be read, and says why the menu is short', async () => {
		await mountWith('/admin/search', { plugins: { state: 'unread' } });
		expect(screen.getByTestId('page')).toBeTruthy();
		expect(document.body.textContent).toContain('Could not load the list of running plugins');
		expect(linkNames()).not.toContain('Search');
		expect(linkNames()).toContain('Users');
	});

	it('offers only the engine pages and no plugin row on an engine that runs no plugin', async () => {
		await mountWith('/admin', { plugins: kernel });
		const names = linkNames();
		for (const gone of ['Content', 'Schema builder', 'Flows', 'Media library', 'Search', 'Audit log', 'Permissions']) {
			expect(names, gone).not.toContain(gone);
		}
		for (const kept of ['Dashboard', 'Users', 'Plugins', 'Privacy requests', 'Settings']) {
			expect(names, kept).toContain(kept);
		}
		expect(document.querySelector('a[href="/admin/settings/mfa"]')).toBeNull();
		expect(document.querySelector('a[href="/admin/settings/devices"]')).toBeNull();
	});

	it('offers two-factor and trusted devices while their plugins run', async () => {
		await mountWith('/admin', { plugins: { state: 'named', running: ['mfa', 'device-fingerprint'], withheld: [] } });
		expect(document.querySelector('a[href="/admin/settings/mfa"]')).not.toBeNull();
		expect(document.querySelector('a[href="/admin/settings/devices"]')).not.toBeNull();
	});
});

describe('admin shell sign out', () => {
	it('posts a real form, so it still works on a page that never hydrated', async () => {
		await mount(SUPER);

		const form = document.querySelector('form[action="/logout"]') as HTMLFormElement | null;
		expect(form).not.toBeNull();
		expect(form!.method).toBe('post');

		const submit = form!.querySelector('button[type="submit"]');
		expect(submit, 'a submit button, not a scripted click').not.toBeNull();
		expect(submit!.textContent).toContain('Sign out');
	});
});

// SvelteKit takes each preload setting from the nearest element above a link.
// Without the sidebar's own, the first visit to a page waited for the page's
// code and then its data, while a later visit waited for the data alone. The
// page's links keep the hover preload the body sets.
describe('admin shell code preload', () => {
	it('gives every sidebar link the viewport code preload, and the page none', async () => {
		await mount(SUPER);

		const links = [...document.querySelectorAll('nav[aria-label="Console sections"] a')];
		expect(links.length).toBeGreaterThan(0);
		for (const a of links) {
			const setting = a.closest('[data-sveltekit-preload-code]')?.getAttribute('data-sveltekit-preload-code');
			expect(setting, a.textContent?.trim()).toBe('viewport');
		}
		expect(screen.getByTestId('page').closest('[data-sveltekit-preload-code]')).toBeNull();
	});
});
