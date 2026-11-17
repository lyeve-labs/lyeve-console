// @vitest-environment jsdom
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));

import PluginsPage from './+page.svelte';
import PluginDetailPage from './[name]/+page.svelte';
import IncomingPage from '../webhooks/incoming/+page.svelte';

afterEach(cleanup);

describe('plugin pages', () => {
	// Every row links to the plugin's own route rather than to a settings
	// query string.
	it('plugins index renders a row per plugin, linked to its detail route', () => {
		const { container } = render(PluginsPage, {
			props: {
				data: {
					plugins: [
						{
							name: 'content',
							compiled: true,
							active: true,
							phase: 'running',
							entitled: true,
							requested: true,
							reason: '',
							last_error: '',
							upgrade_url: ''
						}
					],
					gate: { state: 'ok' }
				}
			} as never
		});
		expect(container.querySelector('a[href="/admin/plugins/content"]')).toBeTruthy();
		expect(container.querySelector('[data-testid="page-title"]')?.textContent).toContain('Plugins');
	});

	// Every row comes from the status report, so losing it lists nothing and
	// says why, rather than reading as a build with no plugins.
	it('plugins index says it could not read the status, and lists nothing', () => {
		const { container } = render(PluginsPage, {
			props: { data: { plugins: [], gate: { state: 'unavailable' } } } as never
		});
		expect(container.textContent).toContain('the plugin status did not load');
		expect(container.querySelector('a[href^="/admin/plugins/"]')).toBeNull();
		expect(container.textContent).not.toContain('No plugins in this build');
	});

	it('plugins index names the plugins that failed to start', () => {
		const { container } = render(PluginsPage, {
			props: {
				data: {
					plugins: [
						{
							name: 'content',
							compiled: true,
							active: false,
							phase: 'failed',
							entitled: true,
							requested: true,
							reason: 'migration 093 already applied',
							last_error: '',
							upgrade_url: ''
						}
					],
					gate: { state: 'ok' }
				}
			} as never
		});
		expect(container.textContent).toContain('One plugin failed to start');
		expect(container.textContent).toContain('migration 093 already applied');
	});

	it('plugin detail renders the breadcrumb and holds no form', () => {
		const { container } = render(PluginDetailPage, {
			props: {
				data: {
					pluginName: 'content',
					plugin: null,
					traffic: null,
					trafficRead: false,
					userRoles: ['super_admin']
				}
			} as never
		});
		expect(container.querySelector('nav[aria-label="Breadcrumb"]')).toBeTruthy();
		expect(container.querySelector('form')).toBeNull();
	});

	it('incoming webhooks renders cards, and one heading when there are none', () => {
		const entitlements = {
			plan: 'example',
			state: 'active',
			features: [],
			tenant_quota: 1
		};
		const { container } = render(IncomingPage, {
			props: {
				data: {
					incomingWebhooks: {
						ok: true,
						value: [
							{
								id: 'i1',
								name: 'Stripe',
								schema_name: 'post',
								enabled: true,
								field_map: {},
								allowed_ips: ['10.0.0.0/8']
							}
						]
					},
					schemas: { ok: true, value: [{ name: 'post' }] },
					q: '',
					status: '',
					entitlements,
					user: { roles: ['super_admin'] }
				},
				form: null
			} as never
		});
		expect(container.textContent).toContain('Stripe');
		expect(container.querySelector('[aria-label="Edit Stripe"]')).toBeTruthy();
		cleanup();

		const empty = render(IncomingPage, {
			props: {
				data: {
					incomingWebhooks: { ok: true, value: [] },
					schemas: { ok: true, value: [] },
					entitlements: { plan: '', state: '', features: [], tenant_quota: 1 }
				},
				form: null
			} as never
		});
		expect(empty.container.querySelectorAll('h1')).toHaveLength(1);
	});
});
