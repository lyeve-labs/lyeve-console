// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import SettingsPage from './+page.svelte';

/**
 * The settings page is a hub: it links to the pages that own each setting
 * and holds none of its own.
 */

afterEach(cleanup);

function mount(roles: string[], features: string[] = [], licenseModule = true) {
	render(SettingsPage, {
		props: {
			data: {
				user: { email: 'a@b.c', roles },
				entitlements: { plan: 'example', state: 'active', features, tenant_quota: 0, license_module: licenseModule },
			},
		} as never,
	});
}

describe('settings hub page', () => {
	it('groups every page by purpose for a super admin', () => {
		mount(['super_admin']);
		for (const name of ['Your account', 'Tenant', 'Sign-in and access', 'APIs and delivery', 'Data and compliance', 'Engine']) {
			expect(screen.getByRole('region', { name })).toBeTruthy();
		}
		const apis = screen.getByRole('region', { name: 'APIs and delivery' });
		expect(within(apis).getByRole('link', { name: /API access/ }).getAttribute('href')).toBe('/admin/api-access');
	});

	it('holds no content another page owns', () => {
		mount(['super_admin']);
		expect(screen.queryByLabelText('Password')).toBeNull();
		expect(screen.queryByRole('radiogroup')).toBeNull();
		expect(screen.queryByRole('table')).toBeNull();
	});

	it('lists the license page only on a build that links a license module', () => {
		mount(['super_admin']);
		expect(screen.getByRole('link', { name: /License/ }).getAttribute('href')).toBe('/admin/settings/license');
		cleanup();
		mount(['super_admin'], [], false);
		expect(screen.queryByRole('link', { name: /License/ })).toBeNull();
		const instance = screen.getByRole('region', { name: 'Engine' });
		expect(within(instance).getByRole('link', { name: /Configuration/ })).toBeTruthy();
	});

	it('shows an editor their own pages and the APIs they may read about', () => {
		mount(['editor']);
		expect(screen.getByRole('region', { name: 'Your account' })).toBeTruthy();
		expect(screen.getByRole('link', { name: /Account and appearance/ }).getAttribute('href')).toBe('/admin/settings/account');
		expect(screen.queryByRole('region', { name: 'Engine' })).toBeNull();
		expect(screen.queryByRole('link', { name: /License/ })).toBeNull();
	});
});
