// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import NotEnabled from './NotEnabled.svelte';
import Host from './not-enabled-host.test.svelte';
import { licensingOf, NO_LICENSING } from '$lib/api/license';

afterEach(cleanup);

const licensing = licensingOf({
	links: [{ rel: 'upgrade', label: 'Turn it on', url: '/admin/settings/license' }],
	renew: true,
});

describe('NotEnabled', () => {
	it('names the feature in a heading and says it is not enabled on this engine', () => {
		const { getByRole, getByTestId, getByText } = render(NotEnabled, { props: { title: 'Audit log' } });
		expect(getByRole('heading', { name: 'Audit log' })).toBeTruthy();
		expect(getByText('Not enabled on this engine.')).toBeTruthy();
		expect(getByTestId('not-enabled')).toBeTruthy();
	});

	it('heads at level 3 unless the caller sits under the page title and asks for 2', () => {
		const inSection = render(NotEnabled, { props: { title: 'Audit log' } });
		expect(inSection.getByRole('heading', { name: 'Audit log', level: 3 })).toBeTruthy();
		cleanup();
		const underTitle = render(NotEnabled, { props: { title: 'Audit log', level: 2 } });
		expect(underTitle.getByRole('heading', { name: 'Audit log', level: 2 })).toBeTruthy();
	});

	it('shows what the feature does when told, and no empty paragraph when not', () => {
		const told = render(NotEnabled, {
			props: { title: 'Audit log', description: 'A hash-chained record of every change.' },
		});
		expect(told.getByText('A hash-chained record of every change.')).toBeTruthy();
		cleanup();
		const { getByTestId } = render(NotEnabled, { props: { title: 'Audit log' } });
		expect(getByTestId('not-enabled').querySelectorAll('p')).toHaveLength(1);
	});

	it('shows no link when nothing says where the feature is turned on', () => {
		const { queryByRole } = render(NotEnabled, { props: { title: 'Audit log' } });
		expect(queryByRole('link')).toBeNull();
	});

	it('links where the engine said, in its own words when nothing names the link', () => {
		const { getByRole } = render(NotEnabled, { props: { title: 'Audit log', url: '/admin/settings/license?plugin=audit' } });
		expect(getByRole('link', { name: 'How to enable it' }).getAttribute('href')).toBe('/admin/settings/license?plugin=audit');
	});

	it('opens a link to another origin in a tab of its own', () => {
		const { getByRole } = render(NotEnabled, { props: { title: 'Audit log', url: 'https://example.test/enable' } });
		const link = getByRole('link', { name: 'How to enable it' });
		expect(link.getAttribute('target')).toBe('_blank');
		expect(link.getAttribute('rel')).toBe('noopener noreferrer');
	});

	it('follows the license module: its upgrade link and its words', () => {
		const { getByRole } = render(Host, { props: { licensing } });
		expect(getByRole('link', { name: 'Turn it on' }).getAttribute('href')).toBe('/admin/settings/license');
	});

	// The module's words name its own page, and the engine's link may open another.
	it('keeps the module\'s words off a link the engine sent', () => {
		const { getByRole } = render(Host, { props: { licensing, url: '/admin/settings/license?plugin=audit' } });
		const link = getByRole('link', { name: 'How to enable it' });
		expect(link.getAttribute('href')).toBe('/admin/settings/license?plugin=audit');
		expect(link.getAttribute('target')).toBeNull();
	});

	it('names a link to a plan or an add-on by what it opens', () => {
		const plan = render(NotEnabled, {
			props: { title: 'Tenants', url: 'https://shop.example.com/pricing?plan=example&utm_campaign=tenants' },
		});
		expect(plan.getByRole('link', { name: 'View the plan' })).toBeTruthy();
		cleanup();
		const addOn = render(NotEnabled, {
			props: { title: 'Tenants', url: 'https://shop.example.com/pricing?skus=example-pro' },
		});
		expect(addOn.getByRole('link', { name: 'View the add-on' })).toBeTruthy();
	});

	it('prefers what the link opens to the module\'s words', () => {
		const { getByRole, queryByRole } = render(Host, {
			props: { licensing, url: 'https://shop.example.com/pricing?plan=example' },
		});
		expect(getByRole('link', { name: 'View the plan' })).toBeTruthy();
		expect(queryByRole('link', { name: 'Turn it on' })).toBeNull();
	});

	it('follows the engine: no link on an engine that serves no license module', () => {
		const { queryByRole, getByTestId } = render(Host, { props: { licensing: NO_LICENSING } });
		expect(getByTestId('not-enabled')).toBeTruthy();
		expect(queryByRole('link')).toBeNull();
	});

	it('draws the compact form as a marker that links where the feature is turned on', () => {
		const { getByRole, getByTestId } = render(NotEnabled, {
			props: {
				title: 'Datasources',
				description: 'Creating a datasource is not enabled.',
				url: '/admin/settings/license',
				compact: true,
			},
		});
		const marker = getByTestId('not-enabled');
		expect(marker.textContent?.trim()).toBe('Not enabled on this engine');
		expect(marker.getAttribute('title')).toBe('Creating a datasource is not enabled.');
		expect(getByRole('link').getAttribute('href')).toBe('/admin/settings/license');
	});

	// The marker is 22px tall, under the 44px a finger needs.
	it('gives the compact link a touch hit area', () => {
		const { getByRole } = render(NotEnabled, {
			props: { title: 'Datasources', url: '/admin/settings/license', compact: true },
		});
		const link = getByRole('link');
		expect(link.className).toContain('relative');
		expect(link.className).toContain('hit-area');
	});

	it('draws the compact form as plain text when no link is known', () => {
		const { getByTestId, queryByRole } = render(Host, { props: { licensing: NO_LICENSING, compact: true } });
		expect(getByTestId('not-enabled').textContent?.trim()).toBe('Not enabled on this engine');
		expect(queryByRole('link')).toBeNull();
	});

	it('says only the name, the state, what the feature does and where to enable it', () => {
		const { container } = render(NotEnabled, {
			props: { title: 'Audit log', description: 'Every change.', url: '/admin/settings/license' },
		});
		expect(container.textContent?.replace(/\s+/g, ' ').trim()).toBe(
			'Audit log Not enabled on this engine. Every change. How to enable it',
		);
	});
});
