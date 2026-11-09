// @vitest-environment jsdom
import { STOCK_BRAND } from '$lib/brand';
import { render, cleanup } from '@testing-library/svelte';
import { NO_CUSTOMIZATION } from '$lib/api/customization';
import { licensingOf, NO_LICENSING, type Licensing } from '$lib/api/license';
import { UNNAMED } from '$lib/plugins';
import { afterEach, describe, expect, it } from 'vitest';
import LicensePage from './+page.svelte';
import type { User } from '@lyeve-labs/client';
import type { LicenseEntitlements } from '$lib/entitlements';

afterEach(cleanup);

function entitlements(overrides: Partial<LicenseEntitlements> = {}): LicenseEntitlements {
	return {
		plan: 'example',
		plan_label: 'Example',
		state: 'active',
		features: [],
		tenant_quota: 0,
		license_module: true,
		...overrides,
	};
}

function user(roles = ['super_admin']): User {
	return {
		id: 'test-user-1',
		email: 'admin@example.com',
		roles,
		tenant_id: 'default',
		disabled: false,
		created_at: '2026-01-01T00:00:00Z',
	};
}

const served = licensingOf({
	links: [
		{ rel: 'upgrade', label: 'Turn it on', url: '/admin/settings/license' },
		{ rel: 'purchase', label: 'Get a license', url: 'https://example.test/get' },
		{ rel: 'portal', label: 'Your account', url: 'https://example.test/account' },
		{ rel: 'support', label: 'Help', url: 'https://example.test/help' },
		{ rel: 'docs', label: 'How it is checked', url: 'https://example.test/docs' },
	],
	renew: true,
});

interface Mount {
	ent?: LicenseEntitlements | null;
	licensing?: Licensing;
	roles?: string[];
	form?: Record<string, unknown> | null;
}

function mount({ ent = entitlements(), licensing = served, roles, form = null }: Mount = {}) {
	return render(LicensePage, {
		props: {
			data: {
				user: user(roles),
				migrations: null,
				customization: NO_CUSTOMIZATION,
				brand: STOCK_BRAND,
				plugins: UNNAMED,
				pluginStatus: null,
				licensing,
				entitlements: ent,
			},
			form: form as never,
		},
	});
}

function said(container: HTMLElement): string {
	return (container.textContent ?? '').replace(/\s+/g, ' ').trim();
}

describe('License page status', () => {
	it('shows the plan in the module\'s words with its state', () => {
		const { getByRole, getByText } = mount();
		expect(getByRole('heading', { name: 'License' })).toBeTruthy();
		expect(getByText('Example, active')).toBeTruthy();
	});

	it('shows the plan as the license names it when the module sends no words for it', () => {
		const { getByText } = mount({ ent: entitlements({ plan_label: undefined }) });
		expect(getByText('example, active')).toBeTruthy();
	});

	it('says there is no license, and what the engine runs with instead', () => {
		const { getByText, container } = mount({ ent: entitlements({ plan: 'free', plan_label: 'Free', state: 'free' }) });
		expect(getByText('No license')).toBeTruthy();
		expect(getByText('Everything that needs no license is running.')).toBeTruthy();
		expect(said(container)).not.toContain('No expiry on record');
	});

	it('says by when to renew during a grace period', () => {
		const { getByText } = mount({
			ent: entitlements({ state: 'grace', expires_at: '2026-10-01T00:00:00Z', grace_ends_at: '2026-10-08T00:00:00Z' }),
		});
		expect(getByText('Example, grace period')).toBeTruthy();
		expect(getByText('Renew before 2026-10-08.')).toBeTruthy();
		expect(getByText('2026-10-01')).toBeTruthy();
	});

	it('says what an expired license leaves off', () => {
		const { getByText } = mount({ ent: entitlements({ state: 'expired' }) });
		expect(getByText('Example, expired')).toBeTruthy();
		expect(getByText('Features from the license are off until you renew it.')).toBeTruthy();
	});

	it('shows a state it has no words for as it arrived', () => {
		const { getByText } = mount({ ent: entitlements({ state: 'suspended' }) });
		expect(getByText('Example, suspended')).toBeTruthy();
	});

	it('shows the expiry and the source the module sends, as sent', () => {
		const { getByText } = mount({ ent: entitlements({ expires_at: '2026-10-24T08:00:00Z', license_source: 'example-source' }) });
		expect(getByText('2026-10-24')).toBeTruthy();
		expect(getByText('example-source')).toBeTruthy();
	});

	it('leaves out the source when the module names none', () => {
		const { queryByText } = mount();
		expect(queryByText('Source')).toBeNull();
		expect(queryByText('No expiry on record')).toBeTruthy();
	});

	it('shows the module\'s account of a license problem as it was sent', () => {
		const { getByText } = mount({ ent: entitlements({ state: 'free', license_error: 'the key was refused' }) });
		expect(getByText('License problem')).toBeTruthy();
		expect(getByText('the key was refused')).toBeTruthy();
	});

	it('says the license could not be read rather than claiming there is none', () => {
		const { getByText, queryByText } = mount({ ent: null });
		expect(getByText(/Could not load the license/)).toBeTruthy();
		expect(queryByText('No license')).toBeNull();
	});

	it('offers the key in neutral words when the license was not read', () => {
		const { container } = mount({ ent: null });
		const text = said(container);
		expect(text).not.toContain('Add a license key');
		expect(text).not.toContain('Activate license');
		expect(text).not.toContain('Only needed for what a license grants');
		expect(text).toContain('Apply license');
	});

	it('lists no feature the license carries and counts none', () => {
		const { container } = mount({ ent: entitlements({ features: ['feature-a', 'feature-b'] }) });
		expect(said(container)).not.toMatch(/feature-a|feature-b|features? enabled/);
	});

	it('says the state and the plan in the module\'s words and nothing else, in every state', () => {
		const head = "Settings License See this engine's license and activate a new key. Status";
		const key = 'License token or key Paste the license token or key you were issued.';
		const renew = `Renew license ${key} Renew license`;
		const activate =
			'Add a license key License token or key Only needed for what a license grants. Paste the token or key you were issued. Activate license';
		const expected: Record<string, string> = {
			active: `Example, active Plan ExampleExpires No expiry on record ${renew}`,
			grace: `Example, grace period Renew the license to keep what it grants. Plan ExampleExpires No expiry on record ${renew}`,
			expired: `Example, expired Features from the license are off until you renew it. Plan ExampleExpires No expiry on record ${renew}`,
			free: `No license Everything that needs no license is running. Plan Example ${activate}`,
			'': `No license Everything that needs no license is running. Plan Example ${activate}`,
		};
		for (const [state, text] of Object.entries(expected)) {
			const { container } = mount({ ent: entitlements({ state }), licensing: { links: [], renew: true } });
			expect(said(container), state).toBe(`${head} ${text}`);
			cleanup();
		}
	});
});

describe('License page links', () => {
	it('shows the module\'s purchase, portal and docs links in its words, each in a tab of its own', () => {
		const { getByRole } = mount();
		for (const [name, href] of [
			['Get a license', 'https://example.test/get'],
			['Your account', 'https://example.test/account'],
			['How it is checked', 'https://example.test/docs'],
		]) {
			const link = getByRole('link', { name });
			expect(link.getAttribute('href'), name).toBe(href);
			expect(link.getAttribute('target'), name).toBe('_blank');
			expect(link.getAttribute('rel'), name).toBe('noopener noreferrer');
		}
	});

	// Each link's hit area is 44px under a finger, and its negative margin lays
	// each item out 24px tall, so the gap has to be 20px to put the links 44px
	// apart.
	it('spaces the stacked links so each keeps its whole touch hit area', () => {
		const { getByRole } = mount();
		const link = getByRole('link', { name: 'Get a license' });
		expect(link.className).toContain('hit-area');
		expect((link.closest('ul') as HTMLElement).className).toContain('coarse:gap-5');
	});

	it('leaves the enable and support links to the rest of the console', () => {
		const { queryByRole } = mount();
		expect(queryByRole('link', { name: 'Turn it on' })).toBeNull();
		expect(queryByRole('link', { name: 'Help' })).toBeNull();
	});

	it('shows no link at all when the module serves none', () => {
		const { container } = mount({ licensing: NO_LICENSING });
		expect(container.querySelectorAll('a[href^="https:"]')).toHaveLength(0);
	});
});

describe('License page renewal', () => {
	it('offers a super admin the form, in one neutral sentence', () => {
		const { getByRole, getByLabelText, getByText } = mount();
		expect(getByLabelText('License token or key')).toBeTruthy();
		expect(getByText('Paste the license token or key you were issued.')).toBeTruthy();
		expect(getByRole('button', { name: /Renew license/ })).toBeTruthy();
	});

	it('offers a first key as optional when there is no license', () => {
		const { getByRole, getByText } = mount({ ent: entitlements({ plan: 'free', plan_label: 'Free', state: 'free' }) });
		expect(getByText('Add a license key')).toBeTruthy();
		expect(getByText('Only needed for what a license grants. Paste the token or key you were issued.')).toBeTruthy();
		expect(getByRole('button', { name: /Activate license/ })).toBeTruthy();
	});

	it('offers no form when the module does not renew from this console', () => {
		const { queryByLabelText, queryByRole } = mount({ licensing: { links: [], renew: false } });
		expect(queryByLabelText('License token or key')).toBeNull();
		expect(queryByRole('button', { name: /Renew license|Activate license/ })).toBeNull();
	});

	// The engine refuses a renewal from anyone but a super admin.
	it('tells an admin who may change the license instead of offering the form', () => {
		const { queryByRole, getByText } = mount({ roles: ['admin'] });
		expect(queryByRole('button', { name: /Renew license/ })).toBeNull();
		expect(getByText(/Only a super admin can change the license/)).toBeTruthy();
	});

	it('shows the engine\'s refusal as it was sent', () => {
		const { getByText } = mount({ form: { error: 'the key was refused' } });
		expect(getByText('the key was refused')).toBeTruthy();
	});

	it('confirms a license that applied', async () => {
		const { findByText } = mount({ form: { success: true, plan: 'example', state: 'active', features: [] } });
		expect(await findByText(/License applied/)).toBeTruthy();
	});
});
