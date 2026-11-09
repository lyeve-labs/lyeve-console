import { describe, expect, it } from 'vitest';
import type { NavTree } from '@lyeve-labs/ui-kit';
import { adminNav } from './nav';
import { settingsHub } from './settings-hub';

const SUPER = ['super_admin'];

/** Every page under /admin/settings, plus every entry filed in the Settings section. */
function settingsLeaves(tree: NavTree): string[] {
	const out = new Set<string>();
	const walk = (nodes: NavTree, inSettings: boolean) => {
		for (const n of nodes) {
			if (n.href && n.id !== 'settings' && (inSettings || n.href.startsWith('/admin/settings/'))) out.add(n.id);
			if (n.children) walk(n.children, inSettings || n.id === 'settings');
		}
	};
	walk(tree, false);
	return [...out];
}

describe('settings hub', () => {
	// A settings page with no place on the hub is reachable only from the
	// sidebar, and the two lists drift apart.
	it('places every settings page the sidebar offers a super admin', () => {
		const tree = adminNav(SUPER);
		const leaves = settingsLeaves(tree);
		expect(leaves.length).toBeGreaterThan(15);
		const everyPage = { twoFactor: true, trustedDevices: true, connectedEditors: true };
		const placed = settingsHub(tree, everyPage).flatMap((g) => g.entries.map((e) => e.id));
		for (const id of leaves) expect(placed, `${id} has no group on the hub`).toContain(id);
	});

	it('shows each page once, with what it holds', () => {
		const groups = settingsHub(adminNav(SUPER), { twoFactor: true, trustedDevices: true, connectedEditors: false });
		const ids = groups.flatMap((g) => g.entries.map((e) => e.id));
		expect(new Set(ids).size).toBe(ids.length);
		for (const e of groups.flatMap((g) => g.entries)) expect(e.description, e.id).not.toBe('');
	});

	it('leads with the reader\'s own pages, whatever the role', () => {
		const groups = settingsHub(adminNav(['viewer']), { twoFactor: true, trustedDevices: false, connectedEditors: false });
		expect(groups[0].id).toBe('account');
		expect(groups[0].entries.map((e) => e.href)).toEqual(['/admin/settings/account', '/admin/settings/mfa']);
	});

	it('lists connected editors only while its plugin runs', () => {
		const hrefs = (connectedEditors: boolean) =>
			settingsHub(adminNav(['editor']), { twoFactor: false, trustedDevices: false, connectedEditors })[0].entries.map((e) => e.href);
		expect(hrefs(true)).toContain('/admin/settings/connected-editors');
		expect(hrefs(false)).not.toContain('/admin/settings/connected-editors');
	});

	it('offers a reader only the engine pages their sidebar offers', () => {
		const editor = settingsHub(adminNav(['editor']), { twoFactor: true, trustedDevices: false, connectedEditors: false });
		expect(editor.map((g) => g.id)).toEqual(['account', 'apis']);
		expect(editor[1].entries.map((e) => e.id)).toEqual(['api-access']);
		const admin = settingsHub(adminNav(['admin']), { twoFactor: true, trustedDevices: false, connectedEditors: false });
		expect(admin.find((g) => g.id === 'workspace')?.entries.map((e) => e.id)).toEqual(['customization']);
		expect(admin.find((g) => g.id === 'instance')).toBeUndefined();
	});

	it('drops a page whose plugin does not run', () => {
		const plugins = { state: 'named' as const, running: ['multitenant', 'email'], withheld: [] };
		const hub = settingsHub(adminNav(SUPER, { plugins }), { twoFactor: true, trustedDevices: false, connectedEditors: false });
		const workspace = hub.find((g) => g.id === 'workspace');
		expect(workspace?.entries.map((e) => e.id)).toEqual(['customization', 'email']);
	});

	// A beta mark belongs on the page's own header and nowhere a reader passes
	// through to get there. A mark on some entries and not on equally beta
	// ones reads as a claim about maturity the hub is not making.
	it('marks nothing as beta', () => {
		const hub = settingsHub(adminNav(SUPER), { twoFactor: true, trustedDevices: false, connectedEditors: false });
		for (const group of hub) {
			for (const entry of group.entries) {
				expect(entry, entry.id).not.toHaveProperty('badge');
			}
		}
	});

	it('lists trusted devices only where the engine remembers them', () => {
		expect(settingsHub(adminNav(SUPER), { twoFactor: true, trustedDevices: true, connectedEditors: false })[0].entries.map((e) => e.id)).toContain('devices');
		expect(settingsHub(adminNav(SUPER), { twoFactor: true, trustedDevices: false, connectedEditors: false })[0].entries.map((e) => e.id)).not.toContain('devices');
	});

	// Trusting a device lowers the sign-in risk score. It never decides whether
	// a second step is asked, so the entry promises no skip.
	it('describes trusted devices by what trusting one does', () => {
		const entry = settingsHub(adminNav(SUPER), { twoFactor: true, trustedDevices: true, connectedEditors: false })[0].entries.find((e) => e.id === 'devices');
		expect(entry?.description).toBe('Trust the devices you sign in from to lower their sign-in risk score, and forget any you no longer use.');
		expect(entry?.description).not.toMatch(/browser|skip|second step/i);
	});

	it('lists two-factor only while the plugin behind it runs', () => {
		const own = settingsHub(adminNav(SUPER), { twoFactor: false, trustedDevices: false, connectedEditors: false })[0];
		expect(own.entries.map((e) => e.id)).toEqual(['account']);
	});
});
