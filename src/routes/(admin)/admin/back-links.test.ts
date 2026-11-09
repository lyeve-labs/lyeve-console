// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Entitlements } from '$lib/entitlements';
import { fixtureCatalog, fixtureFlow, fixtureRun, fixtureTemplates } from '$lib/flow/fixtures';

import ContentCollection from './content/[schema]/+page.svelte';
import ContentEntry from './content/[schema]/[id]/+page.svelte';
import ContentNew from './content/[schema]/new/+page.svelte';
import FlowEditor from './flows/[id]/+page.svelte';
import FlowDatasources from './flows/datasources/+page.svelte';
import FlowVariables from './flows/variables/+page.svelte';
import PluginDetail from './plugins/[name]/+page.svelte';
import AiProviderDetail from './ai/providers/[id]/+page.svelte';
import { fixtureProvider, fixtureSettings } from '$lib/components/ai/test-support/fixtures';
import SettingsConfiguration from './settings/configuration/+page.svelte';
import SettingsEmail from './settings/email/+page.svelte';
import SettingsLicense from './settings/license/+page.svelte';
import SettingsMfa from './settings/mfa/+page.svelte';
import SettingsOauth from './settings/oauth/+page.svelte';
import SettingsPermissions from './settings/permissions/+page.svelte';
import SettingsSecurity from './settings/security/+page.svelte';
import SettingsPii from './settings/pii/+page.svelte';
import Gdpr from './gdpr/+page.svelte';
import SlowQueries from './observability/queries/+page.svelte';
import AiPrompt from './ai/prompts/[use_case]/+page.svelte';
import AiTranscript from './ai/transcripts/[id]/+page.svelte';
import WebhooksIncoming from './webhooks/incoming/+page.svelte';

/** A page component as render takes it. The props are typed per route, which one table cannot name. */
type Page = Parameters<typeof render>[0];

/**
 * The current URL, settable per case. A detail page under a filtered list
 * reads it to hand the filter back. Every other page ignores it.
 */
const state = vi.hoisted(() => ({ page: { url: new URL('http://localhost/admin') } }));
vi.mock('$app/state', () => state);
vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));
vi.mock('$app/navigation', () => ({
	beforeNavigate: vi.fn(),
	goto: vi.fn(async () => {}),
	invalidateAll: vi.fn(async () => {}),
}));

afterEach(cleanup);
beforeEach(() => {
	state.page.url = new URL('http://localhost/admin');
	// The flow editor validates on mount. The answer is recorded, never sent.
	vi.stubGlobal(
		'fetch',
		vi.fn(
			async () =>
				new Response(JSON.stringify({ ok: true, errors: [] }), {
					status: 200,
					headers: { 'content-type': 'application/json' },
				}),
		),
	);
});

const licensed: Entitlements = {
	plan: 'example',
	state: 'active',
	features: ['flow', 'webhook'],
	tenant_quota: 1,
};
const user = {
	id: 'u1',
	email: 'admin@example.com',
	roles: ['super_admin'],
	tenant_id: 'default',
	disabled: false,
	created_at: '2026-01-01T00:00:00Z',
};
const posts = { name: 'posts', display_name: 'Posts', fields: [] };

type Case = {
	route: string;
	component: Page;
	data?: Record<string, unknown>;
	url?: string;
	href: string;
	label: string;
};

/**
 * Every page that sits below a list or a section, with the list or section
 * it hands PageShell as `back`. The label is what the sidebar calls the
 * parent, so the way back is named the same way the way in was.
 */
const cases: Case[] = [
	{
		route: 'content/[schema]',
		component: ContentCollection,
		data: { schemas: { ok: true, value: [] }, schemaDef: posts, items: { ok: true, value: [] }, activeSchema: 'posts', status: null, limit: 100, offset: 0, total: 0 },
		href: '/admin/content',
		label: 'Content',
	},
	{
		route: 'content/[schema]/[id]',
		component: ContentEntry,
		data: {
			schemaDef: posts,
			item: { id: 'e1', data: {}, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
			relations: {},
			revisions: [],
		},
		href: '/admin/content/posts',
		label: 'Posts',
	},
	{
		route: 'content/[schema]/[id] opened from page 3',
		component: ContentEntry,
		data: {
			schemaDef: posts,
			item: { id: 'e1', data: {}, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
			relations: {},
			revisions: [],
		},
		url: 'http://localhost/admin/content/posts/e1?limit=100&offset=200',
		href: '/admin/content/posts?limit=100&offset=200',
		label: 'Posts',
	},
	{
		route: 'content/[schema]/new',
		component: ContentNew,
		data: { schemaDef: posts, locales: null, relations: {} },
		href: '/admin/content/posts',
		label: 'Posts',
	},
	{
		route: 'flows/[id]',
		component: FlowEditor,
		data: {
			locked: false,
			flow: fixtureFlow,
			catalog: fixtureCatalog,
			datasources: [],
			variables: [],
			schemas: [],
			catalogGate: { state: 'ok' },
			runs: { ok: true, value: { rows: [fixtureRun], limit: 20, offset: 0, total: 1, hasMore: false } },
			versions: [],
			templates: fixtureTemplates,
			entitlements: licensed,
			user: { roles: ['admin'] },
		},
		href: '/admin/flows',
		label: 'Flows',
	},
	{
		route: 'flows/[id] opened from a filtered list',
		component: FlowEditor,
		data: {
			locked: false,
			flow: fixtureFlow,
			catalog: fixtureCatalog,
			datasources: [],
			variables: [],
			schemas: [],
			catalogGate: { state: 'ok' },
			runs: { ok: true, value: { rows: [], limit: 20, offset: 0, total: 0, hasMore: false } },
			versions: [],
			templates: fixtureTemplates,
			entitlements: licensed,
			user: { roles: ['admin'] },
		},
		url: 'http://localhost/admin/flows/f1?status=active&q=sync',
		href: '/admin/flows?status=active&q=sync',
		label: 'Flows',
	},
	{
		route: 'flows/datasources',
		component: FlowDatasources,
		data: { datasources: [], locked: false, gate: { state: 'ok' }, user: { roles: ['admin'] }, entitlements: licensed },
		href: '/admin/flows',
		label: 'Flows',
	},
	{
		route: 'flows/variables',
		component: FlowVariables,
		data: { variables: [], total: 0, q: '', limit: 50, offset: 0, locked: false, gate: { state: 'ok' }, user: { roles: ['admin'] }, entitlements: licensed },
		href: '/admin/flows',
		label: 'Flows',
	},
	{
		route: 'plugins/[name]',
		component: PluginDetail,
		data: { pluginName: 'cache', plugin: null, traffic: null, trafficRead: false, userRoles: ['super_admin'] },
		href: '/admin/plugins',
		label: 'Plugins',
	},

	{
		route: 'ai/providers/[id]',
		component: AiProviderDetail,
		data: {
			gate: { state: 'ok' },
			aiLayoutGate: { state: 'ok' },
			provider: fixtureProvider,
			aiSettings: fixtureSettings,
			isSuperAdmin: true,
		},
		href: '/admin/ai/providers',
		label: 'Providers',
	},
	{
		route: 'ai/prompts/[use_case]',
		component: AiPrompt,
		data: { gate: { state: 'absent' }, aiLayoutGate: { state: 'ok' }, prompt: null },
		href: '/admin/ai/prompts',
		label: 'Prompts',
	},
	{
		route: 'ai/transcripts/[id]',
		component: AiTranscript,
		data: { gate: { state: 'absent' }, aiLayoutGate: { state: 'ok' }, transcript: null },
		href: '/admin/ai/transcripts',
		label: 'Transcripts',
	},
	{
		route: 'observability/queries',
		component: SlowQueries,
		data: { gate: { state: 'absent' }, entries: [], analyzed: [] },
		href: '/admin/observability',
		label: 'Observability',
	},
	{
		route: 'gdpr',
		component: Gdpr,
		href: '/admin/settings',
		label: 'Settings',
	},
	{
		route: 'settings/configuration',
		component: SettingsConfiguration,
		data: { provenance: { ok: false, gate: { state: 'forbidden' } } },
		href: '/admin/settings',
		label: 'Settings',
	},
	{
		route: 'settings/email',
		component: SettingsEmail,
		data: { providers: { ok: true, value: [] }, mail: null },
		href: '/admin/settings',
		label: 'Settings',
	},
	{
		route: 'settings/license',
		component: SettingsLicense,
		data: { user, migrations: null, entitlements: licensed },
		href: '/admin/settings',
		label: 'Settings',
	},
	{
		route: 'settings/mfa',
		component: SettingsMfa,
		data: { mfa: { ok: true, value: false }, entitlements: licensed },
		href: '/admin/settings',
		label: 'Settings',
	},
	{
		route: 'settings/pii',
		component: SettingsPii,
		data: { gate: { state: 'absent' }, entries: [], rules: null },
		href: '/admin/settings',
		label: 'Settings',
	},
	{
		route: 'settings/security',
		component: SettingsSecurity,
		data: { report: { ok: false, gate: { state: 'unavailable' } } },
		href: '/admin/settings',
		label: 'Settings',
	},
];

describe('every nested page names the way back', () => {
	it.each(cases)('$route goes back to $href as $label', ({ component, data, url, href, label }) => {
		if (url) state.page.url = new URL(url);
		const { container } = render(component, {
			props: { data: data ?? {}, form: null } as never,
		});
		const back = container.querySelector('[data-testid="page-back"]');
		expect(back, 'PageShell rendered no back link').not.toBeNull();
		expect(back?.getAttribute('href')).toBe(href);
		expect(back?.textContent?.trim()).toBe(label);
	});

	it('puts the back link ahead of a breadcrumb on the same row', () => {
		const { container } = render(ContentNew, {
			props: { data: { schemaDef: posts, locales: null, relations: {} }, form: null } as never,
		});
		const back = container.querySelector('[data-testid="page-back"]');
		const crumb = container.querySelector('nav[aria-label]');
		expect(back && crumb).toBeTruthy();
		expect(back?.parentElement).toBe(crumb?.parentElement);
		expect(back!.compareDocumentPosition(crumb as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
	});

	/*
	 * The back link and the breadcrumb share a row, so a page handing both
	 * would name its parent twice. Whatever the back link already is, the
	 * trail starts after it.
	 */
	it('never names the back target again in the breadcrumb on the same row', () => {
		for (const { component, data, url } of cases) {
			state.page.url = new URL(url ?? 'http://localhost/admin');
			const { container, unmount } = render(component, { props: { data: data ?? {}, form: null } as never });
			const back = container.querySelector('[data-testid="page-back"]') as HTMLAnchorElement;
			const crumb = container.querySelector('nav[aria-label] a, nav[aria-label] li');
			if (crumb) {
				const first = crumb.textContent?.trim();
				expect(first, `${back.textContent?.trim()} repeated as the first crumb`).not.toBe(back.textContent?.trim());
			}
			unmount();
		}
	});

	it('renders no second arrow of its own below the form', () => {
		for (const component of [ContentNew, ContentEntry] as Page[]) {
			const { container, unmount } = render(component, {
				props: {
					data: {
						schemaDef: posts,
						locales: null,
						relations: {},
						revisions: [],
						item: { id: 'e1', data: {}, created_at: '', updated_at: '' },
					},
					form: null,
				} as never,
			});
			const links = [...container.querySelectorAll('a')].filter((a) => a.textContent?.trim() === 'Back');
			expect(links, 'a hand-built Back link survived').toHaveLength(0);
			unmount();
		}
	});
});

/**
 * Pages the sidebar lists as destinations of their own, under a heading that
 * is not a page. The way in is the sidebar, so a back link could only point
 * at a page the reader never came from: OAuth's URL is mounted under
 * Settings, while the sidebar files it under Access. The header names the
 * section instead.
 */
const destinations: { route: string; component: Page; data: Record<string, unknown> }[] = [
	{ route: 'settings/oauth', component: SettingsOauth, data: { providers: { ok: true, value: [] }, entitlements: licensed } },
	{ route: 'settings/permissions', component: SettingsPermissions, data: { permissions: [], schemas: [], entitlements: licensed, loadError: null } },
	{ route: 'webhooks/incoming', component: WebhooksIncoming, data: { schemas: { ok: true, value: [] }, incomingWebhooks: { ok: true, value: [] }, entitlements: licensed } },
];

describe('a sidebar destination under a heading', () => {
	it.each(destinations)('$route renders no back link', ({ component, data }) => {
		const { container } = render(component, { props: { data, form: null } as never });
		expect(container.querySelector('[data-testid="page-back"]')).toBeNull();
	});
});
