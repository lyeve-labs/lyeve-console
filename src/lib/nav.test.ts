// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { NavNode, NavTree } from '@lyeve-labs/ui-kit';
import { adminNav, adminSection, adminTrail, customizeNav, navLeaves, pageLabel, pagePlugin } from './nav';
import type { PluginSet } from './plugins';

/** Every node in the tree, depth first, so a case can look for one by id. */
function flatten(items: NavTree): NavNode[] {
	return items.flatMap((node) => [node, ...flatten(node.children ?? [])]);
}

function ids(items: NavTree): string[] {
	return items.map((node) => node.id);
}

function find(items: NavTree, id: string): NavNode {
	const node = flatten(items).find((candidate) => candidate.id === id);
	if (!node) throw new Error(`no nav node with id ${id}`);
	return node;
}

function labels(items: NavTree): string[] {
	return flatten(items)
		.filter((node) => node.href !== undefined)
		.map((node) => node.label);
}

const EDITOR = ['editor'];
const VIEWER = ['viewer'];
// A role the tenant made up. The engine answers it as any signed-in reader.
const TRANSLATOR = ['translator'];
const ADMIN = ['admin'];
const SUPER = ['super_admin'];

describe('adminNav role gate', () => {
	it('gives an admin and a super admin the seven daily destinations at depth 0', () => {
		for (const roles of [ADMIN, SUPER]) {
			expect(ids(adminNav(roles)).slice(0, 7)).toEqual([
				'dashboard',
				'content',
				'schema',
				'flows',
				'reviews',
				'media',
				'search',
			]);
		}
	});

	it('keeps Flows at depth 0 and out of every section', () => {
		// Flows is a daily destination beside Content and the Schema builder,
		// so a reader never opens a disclosure to find it.
		const tree = adminNav(EDITOR);
		expect(find(tree, 'flows').href).toBe('/admin/flows');
		expect(tree.some((node) => node.id === 'flows')).toBe(true);
		expect(ids(find(tree, 'delivery').children ?? [])).not.toContain('flows');
	});

	it('leads with Content, the Schema builder and Flows, in a row', () => {
		// Content, the Schema builder and Flows lead. Reviews is the queue that
		// serves one of them, so it follows the three rather than splitting
		// them.
		const order = ids(adminNav(SUPER));
		expect(order.slice(1, 4)).toEqual(['content', 'schema', 'flows']);
		expect(order.indexOf('reviews')).toBeGreaterThan(order.indexOf('flows'));
	});

	it('gives a role with neither tier the pages any reader may open and nothing privileged', () => {
		const tree = adminNav(EDITOR);
		expect(ids(tree)).toEqual(['dashboard', 'schema', 'flows', 'reviews', 'delivery', 'settings']);
		// The token exchange is open to every account. The rest of Delivery
		// opens on reads the engine serves to an admin.
		expect(ids(find(tree, 'delivery').children ?? [])).toEqual(['api-access']);
		// Settings keeps its own destination without the sections only a super
		// admin may open, so it renders as a plain link.
		expect(find(tree, 'settings').children).toEqual([]);
		expect(labels(tree)).not.toContain('Users');
	});

	it('gives an admin the read-only insight section, their own admin tokens and no configuration', () => {
		const tree = adminNav(ADMIN);
		expect(ids(tree)).toContain('insight');
		expect(ids(find(tree, 'insight').children ?? [])).toEqual([
			'audit-log',
			'content-activity',
			'realtime',
			'events',
			'data-export',
			'imports',
			'observability',
			'logs',
			'analytics',
			'analytics-destinations',
		]);
		// An admin issues admin tokens of their own. The rest of Access (users,
		// keys, identity providers) stays the super admin's.
		expect(ids(find(tree, 'access').children ?? [])).toEqual(['admin-tokens']);
		// Plugins, AI, quotas and tenant costs are the operations entries an
		// admin may reach: the AI switch, prompts and transcripts are the
		// tenant's own, and the quota reads and the cost ledger read the
		// caller's tenant.
		expect(ids(find(tree, 'operations').children ?? [])).toEqual(['plugins', 'ai', 'tenant-usage', 'tenant-costs']);
		// Customizing the tenant's admin, its captcha, how its provider
		// accounts sign in, its own rate limits, its content history and its
		// privacy settings are the tenant admin's, so they are the settings
		// entries an admin reaches.
		expect(ids(find(tree, 'settings').children ?? [])).toEqual([
			'customization',
			'captcha',
			'sign-in',
			'tenant-rate-limits',
			'content-history',
			'privacy',
		]);
	});

	it('gives a super admin every section and all seventy-one destinations', () => {
		const tree = adminNav(SUPER);
		expect(ids(tree)).toEqual([
			'dashboard',
			'content',
			'schema',
			'flows',
			'reviews',
			'media',
			'search',
			'delivery',
			'access',
			'operations',
			'insight',
			'settings',
		]);
		expect(labels(tree)).toHaveLength(71);
		expect(ids(find(tree, 'settings').children ?? [])).toEqual([
			'email',
			'recommendations',
			'message-broker',
			'license',
			'configuration',
			'config-sync',
			'security',
			'rate-limits',
			'storage',
			'localization',
			'residency',
			'gdpr',
			'pii',
			'customization',
			'captcha',
			'sign-in',
			'content-history',
			'privacy',
		]);
		expect(ids(find(tree, 'access').children ?? [])).toEqual([
			'users',
			'api-keys',
			'admin-tokens',
			'permissions',
			'oauth',
			'saml',
			'scim',
		]);
	});

	it('names every node once, because ids key the render and the stored expansion', () => {
		const all = flatten(adminNav(SUPER));
		expect(new Set(all.map((node) => node.id)).size).toBe(all.length);
		const hrefs = all.map((node) => node.href).filter((href): href is string => href !== undefined);
		expect(new Set(hrefs).size).toBe(hrefs.length);
	});
});

describe('adminNav reach by role', () => {
	// Each entry is listed to the roles the engine answers on the read its
	// page opens with. Listed to anybody else, it would open on a page the
	// engine refuses, drawn as an empty one.
	const ADMIN_DAILY = ['dashboard', 'content', 'schema', 'flows', 'reviews', 'media', 'search'];
	const READER_DAILY = ['dashboard', 'schema', 'flows', 'reviews'];
	const DELIVERY = [
		'api-access',
		'api-reference',
		'api-labs',
		'grpc',
		'graphql',
		'releases',
		'experiments',
		'webhooks',
		'webhooks-incoming',
	];

	/** The destinations at depth 0, where the daily work sits. */
	const daily = (tree: NavTree) => tree.filter((node) => node.children === undefined).map((node) => node.id);
	const delivery = (tree: NavTree) => ids(find(tree, 'delivery').children ?? []);
	/** The headings, each drawn only while the role has something under it. */
	const sections = (tree: NavTree) => tree.filter((node) => node.children !== undefined).map((node) => node.id);

	it('gives a super admin every daily destination and every delivery entry', () => {
		const tree = adminNav(SUPER);
		expect(daily(tree)).toEqual(ADMIN_DAILY);
		// How an app gets in, the read API, then the two directions a webhook
		// can point: the order is what the sidebar renders.
		expect(delivery(tree)).toEqual(DELIVERY);
		expect(sections(tree)).toEqual(['delivery', 'access', 'operations', 'insight', 'settings']);
	});

	it('gives an admin the same daily work and every delivery entry but the gRPC listener', () => {
		const tree = adminNav(ADMIN);
		expect(daily(tree)).toEqual(ADMIN_DAILY);
		// The listener's status is a super admin route.
		expect(delivery(tree)).toEqual(DELIVERY.filter((id) => id !== 'grpc'));
		expect(sections(tree)).toEqual(['delivery', 'access', 'operations', 'insight', 'settings']);
	});

	it.each([
		{ who: 'an editor', roles: EDITOR },
		{ who: 'a viewer', roles: VIEWER },
		{ who: 'a custom role', roles: TRANSLATOR },
	])('gives $who only the pages any signed-in reader may open', ({ roles }) => {
		const tree = adminNav(roles);
		// Content, the media library and search open on admin routes, and so
		// does every delivery page but API access.
		expect(daily(tree)).toEqual(READER_DAILY);
		expect(delivery(tree)).toEqual(['api-access']);
		// Access, Operations and Insight hold nothing this role may open, so
		// none of the three is drawn.
		expect(sections(tree)).toEqual(['delivery', 'settings']);
	});

	it('gives a custom role held beside admin what the admin role reaches', () => {
		const tree = adminNav([...TRANSLATOR, ...ADMIN]);
		expect(daily(tree)).toEqual(ADMIN_DAILY);
		expect(delivery(tree)).toEqual(DELIVERY.filter((id) => id !== 'grpc'));
	});
});

describe('adminNav plugin gate', () => {
	// A plugin's entries are listed while the engine names the plugin as
	// running for this tenant. The engine's own entries are always listed.
	const named = (running: string[], withheld: string[] = []): PluginSet => ({ state: 'named', running, withheld });
	const RUNNING = ['content', 'review', 'schema', 'media', 'flow', 'cron', 'apikey', 'logging', 'multitenant'];
	const ENGINE = [
		'dashboard',
		'api-access',
		'api-reference',
		'api-labs',
		'users',
		'admin-tokens',
		'plugins',
		'observability',
		'license',
		'configuration',
		'security',
		'gdpr',
		'settings',
		'sign-in',
	];
	const present = (tree: NavTree) => flatten(tree).map((node) => node.id);

	it('lists only the engine entries on an engine that runs no plugin, for every role', () => {
		const kernel = named([]);
		expect(ids(adminNav(SUPER, { plugins: kernel }))).toEqual(['dashboard', 'delivery', 'access', 'operations', 'insight', 'settings']);
		for (const id of present(adminNav(SUPER, { plugins: kernel }))) {
			expect(ENGINE.concat(['delivery', 'access', 'operations', 'insight']), id).toContain(id);
		}
		expect(present(adminNav(ADMIN, { plugins: kernel }))).toEqual([
			'dashboard',
			'delivery',
			'api-access',
			'api-reference',
			'api-labs',
			'access',
			'admin-tokens',
			'operations',
			'plugins',
			'insight',
			'observability',
			'settings',
			'sign-in',
		]);
		expect(present(adminNav(EDITOR, { plugins: kernel }))).toEqual(['dashboard', 'delivery', 'api-access', 'settings']);
	});

	it('lists only the engine entries when the running list could not be read', () => {
		expect(present(adminNav(SUPER, { plugins: { state: 'unread' } }))).toEqual(present(adminNav(SUPER, { plugins: named([]) })));
	});

	it('lists every entry on an engine that does not name its plugins', () => {
		expect(present(adminNav(SUPER, { plugins: { state: 'unnamed' } }))).toEqual(present(adminNav(SUPER)));
	});

	it('drops the entry for a plugin that does not run', () => {
		const items = present(adminNav(SUPER, { plugins: named(RUNNING) }));
		expect(items).toContain('content');
		expect(items).not.toContain('search');
		expect(items).not.toContain('ai');
		expect(items).not.toContain('audit-log');
	});

	it('brings the entry back when the plugin runs', () => {
		const items = present(adminNav(SUPER, { plugins: named([...RUNNING, 'search', 'ai', 'audit']) }));
		expect(items).toContain('search');
		expect(items).toContain('ai');
		expect(items).toContain('audit-log');
	});

	it('drops the entry for a plugin withheld from this tenant', () => {
		const items = present(adminNav(SUPER, { plugins: named(RUNNING.filter((p) => p !== 'media'), ['media']) }));
		expect(items).not.toContain('media');
	});

	it('drops both webhook entries together, since one plugin draws both', () => {
		const items = present(adminNav(SUPER, { plugins: named(RUNNING) }));
		expect(items).not.toContain('webhooks');
		expect(items).not.toContain('webhooks-incoming');
	});

	it('gates permissions, telemetry and the profiler on their own plugins', () => {
		const without = present(adminNav(SUPER, { plugins: named(RUNNING) }));
		for (const id of ['permissions', 'telemetry', 'profiler']) expect(without, id).not.toContain(id);
		const withThem = present(adminNav(SUPER, { plugins: named([...RUNNING, 'permissions', 'telemetry', 'profiler']) }));
		for (const id of ['permissions', 'telemetry', 'profiler']) expect(withThem, id).toContain(id);
	});

	it('keeps privacy requests, which the engine serves itself', () => {
		expect(present(adminNav(SUPER, { plugins: named([]) }))).toContain('gdpr');
	});

	it('lists privacy while a plugin serving one of its settings runs', () => {
		expect(present(adminNav(ADMIN, { plugins: named(['schema']) }))).toContain('privacy');
		expect(present(adminNav(ADMIN, { plugins: named(['analytics']) }))).toContain('privacy');
		expect(present(adminNav(ADMIN, { plugins: named([]) }))).not.toContain('privacy');
	});

	it('lists customization only while the multitenant plugin runs and lets this tenant use it', () => {
		expect(present(adminNav(ADMIN, { plugins: named(['multitenant']), customizable: true }))).toContain('customization');
		expect(present(adminNav(ADMIN, { plugins: named(['multitenant']), customizable: false }))).not.toContain('customization');
		expect(present(adminNav(ADMIN, { plugins: named([]), customizable: true }))).not.toContain('customization');
	});

	it('lists the license page only on a build that links a license module', () => {
		expect(present(adminNav(SUPER, { plugins: named([]), licenseModule: true }))).toContain('license');
		expect(present(adminNav(SUPER, { plugins: named([]), licenseModule: false }))).not.toContain('license');
		// Unset leaves the entry to the role gate, as every other input does.
		expect(present(adminNav(SUPER, { plugins: named([]) }))).toContain('license');
	});

	it('keeps a section that owns a destination of its own, with nothing under it, as a plain link', () => {
		const tree = adminNav(EDITOR, { plugins: named([]) });
		expect(find(tree, 'settings').href).toBe('/admin/settings');
		expect(find(tree, 'settings').children).toEqual([]);
	});

	it('still refuses a privileged entry to a role that may not see it', () => {
		// The plugin gate narrows. It never widens. Every plugin running does
		// not give an editor the user list, the content or the webhooks.
		const everything = named([...RUNNING, 'search', 'ai', 'audit', 'webhook', 'mfa', 'oauth']);
		const items = present(adminNav(EDITOR, { plugins: everything }));
		for (const id of ['users', 'content', 'media', 'search', 'webhooks']) expect(items, id).not.toContain(id);
	});
});

describe('adminNav matching', () => {
	it('pins a leaf that sits above a sibling to its own path', () => {
		const tree = adminNav(SUPER);
		// Each of these has another entry underneath its href. Prefix matching
		// would light both rows at once.
		expect(find(tree, 'dashboard').match).toBe('exact');
		expect(find(tree, 'webhooks').match).toBe('exact');
		expect(find(tree, 'tenants').match).toBe('exact');
	});

	it('lets a leaf with detail routes answer for its own subtree', () => {
		const tree = adminNav(SUPER);
		for (const id of ['content', 'reviews', 'schema', 'media', 'flows', 'users', 'jobs', 'ai', 'plugins']) {
			expect(find(tree, id).match, id).toBe('prefix');
		}
	});

	it('lets an area split into tabs mark its row from every tab', () => {
		const tree = adminNav(SUPER);
		for (const id of ['telemetry', 'profiler', 'cache', 'captures', 'pii', 'graphql', 'imports', 'tenant-costs', 'api-labs']) {
			expect(find(tree, id).match, id).toBe('prefix');
		}
		expect(find(adminNav(ADMIN), 'tenant-rate-limits').match).toBe('prefix');
	});

	it('orders the sections that hold a settings sub-page before the settings section', () => {
		// The kit takes the first match in document order. Settings answers for
		// /admin/settings and everything under it, so Permissions and OAuth only
		// win their own pages while Access comes first.
		const order = ids(adminNav(SUPER));
		expect(order.indexOf('access')).toBeLessThan(order.indexOf('settings'));
		expect(order.indexOf('operations')).toBeLessThan(order.indexOf('settings'));
		expect(find(adminNav(SUPER), 'settings').match).toBe('prefix');
	});
});

describe('adminNav mobile drawer contract', () => {
	it('ships the section holding Users expanded', () => {
		// The mobile drawer has to show the Users link the moment it opens, so a
		// collapsed section would hide it inside a hidden list.
		const access = find(adminNav(SUPER), 'access');
		expect(access.defaultExpanded).toBe(true);
		expect(find(adminNav(SUPER), 'users').href).toBe('/admin/users');
	});

	it('keeps the hrefs of the four mobile drawer destinations', () => {
		const tree = adminNav(SUPER);
		expect(find(tree, 'dashboard').href).toBe('/admin');
		expect(find(tree, 'content').href).toBe('/admin/content');
		expect(find(tree, 'schema').href).toBe('/admin/schema');
		expect(find(tree, 'users').href).toBe('/admin/users');
	});

	it('labels the four mobile drawer destinations as the drawer shows them', () => {
		const tree = adminNav(SUPER);
		expect(find(tree, 'dashboard').label).toBe('Dashboard');
		expect(find(tree, 'content').label).toBe('Content');
		expect(find(tree, 'schema').label).toBe('Schema builder');
		expect(find(tree, 'users').label).toBe('Users');
	});
});

describe('adminSection', () => {
	const tree = adminNav(['super_admin']);

	it('names the page from the deepest matching href', () => {
		// /admin/settings/license lives under a Settings node that also owns
		// /admin/settings, and the shallower one matches too. Taking the first
		// match would call every settings sub-page Settings.
		expect(adminSection('/admin/settings/license', tree)).toBe('Settings / License');
	});

	it('names content activity from its own row, not the content one', () => {
		expect(adminSection('/admin/content-activity', tree)).toBe('Insight / Content activity');
		expect(adminSection('/admin/content-activity', adminNav(['admin']))).toBe('Insight / Content activity');
	});

	it('names a section from its own entry', () => {
		expect(adminSection('/admin/settings', tree)).toBe('Settings');
	});

	it('ignores a trailing slash', () => {
		expect(adminSection('/admin/settings/', tree)).toBe('Settings');
	});

	it('falls back to the product name for a route with no nav entry', () => {
		expect(adminSection('/admin/nowhere', tree)).toBe('LyEve Console');
	});

	it('files a page where the sidebar files it, not where its URL is mounted', () => {
		expect(adminSection('/admin/settings/graphql', tree)).toBe('Delivery / GraphQL');
		expect(adminSection('/admin/settings/oauth', tree)).toBe('Access / OAuth providers');
		expect(adminSection('/admin/api-labs', tree)).toBe('Delivery / API labs');
	});

	it('keeps the last two labels of a deep trail', () => {
		expect(adminTrail('/admin/observability/queries', tree)).toEqual(['Observability', 'Slow queries']);
		expect(adminSection('/admin/ai/providers/p1', tree)).toBe('AI / Providers');
	});

	it('files every tab under the row of its area', () => {
		expect(adminTrail('/admin/observability/profiler/memory', tree)).toEqual(['Observability', 'Profiler']);
		expect(adminTrail('/admin/observability/telemetry/export', tree)).toEqual(['Observability', 'Telemetry']);
		expect(adminTrail('/admin/observability/cache/rules', tree)).toEqual(['Observability', 'Cache']);
		expect(adminTrail('/admin/observability/captures/sets', tree)).toEqual(['Observability', 'Request capture']);
		expect(adminTrail('/admin/observability/goroutines', tree)).toEqual(['Insight', 'Observability']);
		expect(adminTrail('/admin/settings/pii/reads', tree)).toEqual(['Settings', 'PII masking']);
		expect(adminTrail('/admin/settings/graphql/persisted', tree)).toEqual(['Delivery', 'GraphQL']);
		expect(adminTrail('/admin/imports/templates', tree)).toEqual(['Insight', 'Imports']);
		expect(adminTrail('/admin/tenants/costs/budgets', tree)).toEqual(['Operations', 'Tenant costs']);
		expect(adminTrail('/admin/api-labs/graphql', tree)).toEqual(['Delivery', 'API labs']);
		expect(adminTrail('/admin/settings/rate-limits/live', tree)).toEqual(['Settings', 'Rate limits']);
		expect(adminTrail('/admin/settings/rate-limits/tenant/refusals', adminNav(['admin']))).toEqual(['Settings', 'Rate limits']);
	});

	it('names a depth-0 destination and its detail pages by the destination alone', () => {
		expect(adminSection('/admin/flows', tree)).toBe('Flows');
		expect(adminSection('/admin/flows/f1', tree)).toBe('Flows');
	});

	it('names a page with no sidebar row by its own title, under the row that encloses it', () => {
		for (const roles of [['super_admin'], ['viewer']]) {
			const nav = adminNav(roles);
			expect(adminSection('/admin/settings/mfa', nav)).toBe('Settings / Two-factor authentication');
			expect(adminSection('/admin/settings/devices', nav)).toBe('Settings / Trusted devices');
			expect(adminSection('/admin/settings/account', nav)).toBe('Settings / Account and appearance');
			expect(adminSection('/admin/settings/connected-editors', nav)).toBe('Settings / Builder connections');
			expect(adminSection('/admin/settings/connected-editors/builder', nav)).toBe('Settings / Builder connections');
		}
		// A tenant's own page is named by its menu row when the menu lists it.
		const custom = customizeNav(tree, { hidden: [], pinned: [], links: [], pages: [{ slug: 'launch', title: 'Launch' }] }, ['super_admin']);
		expect(adminSection('/admin/pages/launch', custom)).toBe('Pages / Launch');
		expect(adminSection('/admin/pages/launch', tree)).toBe('Pages');
	});

	it('names the deepest section this reader can actually see', () => {
		// The header reads the same tree the sidebar renders. An editor has no
		// License row, so the page falls back to the section that encloses it
		// rather than naming a destination that is not in their nav.
		const editor = adminNav(['editor']);
		expect(adminSection('/admin/settings/license', editor)).toBe('Settings');
	});

	it('does not let the dashboard claim a route with no entry', () => {
		// Dashboard's href is /admin, which is a prefix of every admin route. A
		// plain prefix test over every node would name every unmapped page
		// Dashboard.
		expect(adminSection('/admin', tree)).toBe('Dashboard');
		expect(adminSection('/admin/nowhere', tree)).toBe('LyEve Console');
	});
});

describe('pagePlugin', () => {
	it('names the plugin a page belongs to, below its entry too', () => {
		expect(pagePlugin('/admin/media')).toBe('media');
		expect(pagePlugin('/admin/flows/abc/edit')).toBe('flow');
		expect(pagePlugin('/admin/webhooks/incoming')).toBe('webhook');
		expect(pagePlugin('/admin/tenants/abc')).toBe('multitenant');
		expect(pagePlugin('/admin/tenants/usage')).toBe('usage');
		expect(pagePlugin('/admin/observability/telemetry')).toBe('telemetry');
	});

	it('names the plugin of a page with no sidebar row', () => {
		expect(pagePlugin('/admin/settings/mfa')).toBe('mfa');
		expect(pagePlugin('/admin/settings/devices')).toBe('device-fingerprint');
		expect(pagePlugin('/admin/settings/connected-editors')).toBe('builder');
		expect(pagePlugin('/admin/pages/launch')).toBe('multitenant');
		expect(pagePlugin('/admin/content-activity')).toBe('content');
	});

	it('names the same plugin whoever reads, because the role gate is the page\'s own', () => {
		expect(pagePlugin('/admin/settings/email')).toBe('email');
		expect(pagePlugin('/admin/tenants')).toBe('multitenant');
	});

	it('names the plugin of a tab below its area', () => {
		expect(pagePlugin('/admin/observability/profiler/memory')).toBe('profiler');
		expect(pagePlugin('/admin/observability/cache/stored')).toBe('cache');
		expect(pagePlugin('/admin/observability/captures/rules')).toBe('request-capture');
		expect(pagePlugin('/admin/settings/pii/reads')).toBe('pii-mask');
		expect(pagePlugin('/admin/imports/templates')).toBe('bulk-import');
		expect(pagePlugin('/admin/settings/rate-limits/tenant/refusals')).toBe('rate-limit');
		expect(pagePlugin('/admin/settings/connected-editors/builder')).toBe('builder');
	});

	it('names nothing for a page the engine owns', () => {
		for (const path of ['/admin', '/admin/settings/license', '/admin/gdpr', '/admin/observability', '/admin/users', '/admin/plugins/search']) {
			expect(pagePlugin(path), path).toBeUndefined();
		}
	});
});

describe('pageLabel', () => {
	it('names the entry that owns a page, for the heading of a page that cannot render', () => {
		expect(pageLabel('/admin/flows/abc')).toBe('Flows');
		expect(pageLabel('/admin/settings/mfa')).toBe('Two-factor authentication');
		expect(pageLabel('/admin/tenants/usage')).toBe('Quotas and usage');
		expect(pageLabel('/admin/content-activity')).toBe('Content activity');
	});
});

describe('customizeNav', () => {
	const roles = ['admin'];
	const base = adminNav(roles);
	const ids = (tree: ReturnType<typeof adminNav>): string[] =>
		tree.flatMap((n) => [n.id, ...(n.children ? ids(n.children) : [])]);

	it('leaves the menu alone without a customization', () => {
		expect(customizeNav(base, null, roles)).toEqual(base);
	});

	it('hides, pins and adds the tenant own entries', () => {
		const tree = customizeNav(
			base,
			{
				hidden: ['search'],
				pinned: ['media'],
				links: [
					{ label: 'Status', url: 'https://status.example.com' },
					{ label: 'Finance', url: '/admin/tenants/costs', roles: ['super_admin'] },
				],
				pages: [{ slug: 'launch', title: 'Launch checklist' }],
			},
			roles,
		);
		const all = ids(tree);
		expect(all).not.toContain('search');
		expect(tree[0].id).toBe('pinned');
		expect(tree[0].children?.[0]).toMatchObject({ label: 'Media library', href: '/admin/media' });
		expect(all).toContain('page-launch');
		const links = tree.find((n) => n.id === 'custom-links');
		expect(links?.children?.map((c) => c.label)).toEqual(['Status']);
	});
});

describe('navLeaves', () => {
	it('lists every entry a reader can open, with its section, and never the customization entry', () => {
		const leaves = navLeaves(adminNav(['super_admin']));
		expect(leaves.find((l) => l.id === 'media')).toMatchObject({ label: 'Media library', section: '' });
		expect(leaves.some((l) => l.id === 'customization')).toBe(false);
	});
});
