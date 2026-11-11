/**
 * The admin sidebar tree.
 *
 * The tree is data, so the role gate is one function, a test can assert the
 * tree without rendering the layout, and the grouping is a decision a test can
 * pin.
 *
 * Seven destinations stay at depth 0 because they carry the daily work and
 * must never sit behind a disclosure: Dashboard, Content, Schema builder,
 * Flows, Reviews, Media Library and Search. Content, the Schema builder and
 * Flows lead, in a row and in the order a reader builds them: a schema, the
 * content in it, the flows that act on it. Flows sits here rather than under Delivery because
 * the tree files a page by how often it is opened, not by what it does, and
 * Reviews follows the three rather than splitting them. The rest group by the
 * question the reader is asking when they go looking for them.
 *
 *   Delivery    How content leaves the instance: the read API and the two
 *               directions a webhook can point.
 *   Access      Who may act and as what: people, machine keys, the roles that
 *               bound them and the identity providers behind them.
 *   Operations  What keeps the instance running: scheduled work, the plugins
 *               that are installed, the AI section they call through and the
 *               tenants they run for.
 *   Insight     What already happened: the audit trail, live health, logs and
 *               API usage.
 *   Settings    Instance configuration that is set once and revisited rarely,
 *               plus the compliance surface that belongs with it.
 *
 * An entry that belongs to a plugin is listed only while the engine reports
 * that plugin running for the signed-in tenant. The engine's own entries are
 * always listed, so an engine that runs no plugin still has a sidebar.
 *
 * An entry is listed only to the roles the engine answers on the read its page
 * opens with. An admin route answers admin and super_admin, a super admin
 * route answers super_admin alone, and a route for any signed-in caller
 * answers every role, a custom one included. A page that mixes them is listed
 * by its read and gates its own writes. Listed to a role the engine refuses,
 * an entry opens on a page with nothing in it and buttons that fail. Like the
 * plugin gate, this is a courtesy and never a control.
 *
 * Access ships expanded. The mobile drawer is the only way to reach anything on
 * a phone, and Users has to be on screen the moment it opens rather than behind
 * a disclosure a reader has to find first.
 *
 * On matching: the kit treats a leaf as answering for its own path and a node
 * with children as answering for its whole subtree, and it takes the first
 * match in document order. So a leaf whose href sits above a sibling's is
 * pinned to 'exact' (Dashboard over everything, Webhooks over Incoming
 * Webhooks), and a leaf with detail routes below
 * it takes 'prefix' so a record page still marks its section. The Settings node
 * keeps 'prefix' to cover the sub-pages that have no entry of their own, such
 * as /admin/settings/mfa. That is safe only while Access and Operations come
 * before it, because they hold the /admin/settings/* leaves that must win. The
 * order is asserted in nav.test.ts.
 */

import { PRODUCT_NAME } from '$lib/brand';
import type { NavNode, NavTree } from '@lyeve-labs/ui-kit';
import {
	Activity,
	ArrowDownToLine,
	ArrowLeftRight,
	BarChart3,
	BookOpen,
	Bot,
	Braces,
	Cable,
	Bug,
	Building2,
	CalendarClock,
	ClipboardCheck,
	Coins,
	Database,
	Download,
	EyeOff,
	FileText,
	Fingerprint,
	Flame,
	FlaskConical,
	Gauge,
	Globe,
	HardDrive,
	Home,
	Images,
	Key,
	KeyRound,
	KeySquare,
	Languages,
	Layout,
	Lock,
	LogIn,
	Mail,
	Network,
	Palette,
	Pin,
	Link as LinkIcon,
	LayoutTemplate,
	Plug,
	Puzzle,
	Radar,
	Radio,
	Rss,
	Satellite,
	Scale,
	ScrollText,
	Search,
	Send,
	Settings,
	Share2,
	Shield,
	ShieldAlert,
	ShieldCheck,
	SlidersHorizontal,
	Sparkles,
	Timer,
	Upload,
	UserCog,
	Users,
	Webhook,
	Workflow,
	Wrench,
	History,
	ShieldQuestion,
	LockKeyhole,
	UserLock,
} from '@lucide/svelte';
import { PLUGIN, type PluginName } from '$lib/plugin-names';
import { runs, UNNAMED, type PluginSet } from '$lib/plugins';

/** A heading with nothing under it is not a section, so it is dropped. */
function group(node: Omit<NavNode, 'children'>, children: NavNode[]): NavNode[] {
	return children.length > 0 ? [{ ...node, children }] : [];
}

/**
 * The plugin each nav entry belongs to, keyed by node id. An entry with no row
 * here is the engine's own and is always listed: the dashboard, the API
 * pages, users and admin tokens, the plugin list, the observability overview,
 * privacy requests and the engine's own settings.
 *
 * The names are the ones the engine reports in its running list, which is
 * what the layout reads. An entry is listed while its plugin runs for the
 * signed-in tenant, and a heading left with nothing under it goes too.
 *
 * Hiding an entry is a courtesy to the reader and never a control. Every
 * route behind these pages answers for itself, and the shell shows why a page
 * is unavailable when its URL is opened anyway.
 */
const PAGE_PLUGIN: Readonly<Record<string, PluginName>> = {
	content: PLUGIN.content,
	reviews: PLUGIN.review,
	schema: PLUGIN.schema,
	media: PLUGIN.media,
	flows: PLUGIN.flow,
	experiments: PLUGIN.abTesting,
	search: PLUGIN.search,
	webhooks: PLUGIN.webhook,
	'webhooks-incoming': PLUGIN.webhook,
	releases: PLUGIN.content,
	'content-history': PLUGIN.content,
	'content-activity': PLUGIN.content,
	'api-keys': PLUGIN.apikey,
	permissions: PLUGIN.permissions,
	jobs: PLUGIN.cron,
	ai: PLUGIN.ai,
	mcp: PLUGIN.mcp,
	tenants: PLUGIN.multitenant,
	'tenant-costs': PLUGIN.multitenant,
	'audit-log': PLUGIN.audit,
	logs: PLUGIN.logging,
	realtime: PLUGIN.realtime,
	events: PLUGIN.events,
	'data-export': PLUGIN.dataExport,
	analytics: PLUGIN.analytics,
	'analytics-destinations': PLUGIN.productAnalytics,
	oauth: PLUGIN.oauth,
	saml: PLUGIN.saml,
	scim: PLUGIN.scim,
	'message-broker': PLUGIN.messagebroker,
	residency: PLUGIN.dataResidency,
	recommendations: PLUGIN.recommendations,
	grpc: PLUGIN.grpc,
	graphql: PLUGIN.graphql,
	'rate-limits': PLUGIN.rateLimit,
	storage: PLUGIN.storage,
	imports: PLUGIN.bulkImport,
	'tenant-usage': PLUGIN.usage,
	telemetry: PLUGIN.telemetry,
	profiler: PLUGIN.profiler,
	synthetic: PLUGIN.syntheticMonitoring,
	'slow-queries': PLUGIN.queryMonitor,
	errors: PLUGIN.errorTracking,
	cache: PLUGIN.cache,
	captures: PLUGIN.requestCapture,
	captcha: PLUGIN.captcha,
	'tenant-rate-limits': PLUGIN.rateLimit,
	idempotency: PLUGIN.idempotency,
	email: PLUGIN.email,
	'config-sync': PLUGIN.schema,
	localization: PLUGIN.localization,
	pii: PLUGIN.piiMask,
	// The multitenant plugin serves each tenant's customization, and it also
	// has to let this tenant use it: adminNav reads that answer beside this.
	customization: PLUGIN.multitenant,
};

/**
 * The plugins that serve the privacy page's settings. The page belongs to none
 * of them alone, so it is listed while any one runs.
 */
const PRIVACY_PLUGINS: readonly PluginName[] = [PLUGIN.schema, PLUGIN.productAnalytics];

/**
 * Pages with no sidebar row, by path, each with its title and the plugin it
 * belongs to, if any. The account menu and the settings hub link the first
 * three, and a tenant's own pages are linked from its menu.
 */
const UNLISTED_PAGES: readonly { href: string; label: string; plugin?: PluginName }[] = [
	{ href: '/admin/settings/account', label: 'Account and appearance' },
	{ href: '/admin/settings/mfa', label: 'Two-factor authentication', plugin: PLUGIN.mfa },
	{ href: '/admin/settings/devices', label: 'Trusted devices', plugin: PLUGIN.deviceFingerprint },
	{ href: '/admin/settings/connected-editors', label: 'Builder connections', plugin: PLUGIN.builder },
	{ href: '/admin/pages', label: 'Pages', plugin: PLUGIN.multitenant },
];

/** Drops every entry `keep` refuses, and a heading left with nothing under it. */
function prune(nodes: NavTree, keep: (id: string) => boolean): NavTree {
	const kept: NavNode[] = [];
	for (const node of nodes) {
		if (!keep(node.id)) continue;
		const children = node.children ? prune(node.children, keep) : undefined;
		// A heading is only a heading because of what is under it.
		if (node.href === undefined && children !== undefined && children.length === 0) continue;
		kept.push(children === undefined ? node : { ...node, children });
	}
	return kept;
}

/** What the sidebar is built from, beside the reader's roles. */
export interface NavInputs {
	/** The plugins that serve this tenant. Unset lists every entry the roles allow. */
	plugins?: PluginSet;
	/**
	 * Whether this tenant may shape its admin, as the customization read
	 * answers. Unset leaves the entry to its plugin alone.
	 */
	customizable?: boolean;
	/**
	 * Whether the engine says the build links a license module, which is what
	 * has a license to show. False drops the License entry. Unset keeps it.
	 */
	licenseModule?: boolean;
}

export function adminNav(roles: readonly string[], inputs: NavInputs = {}): NavTree {
	const superAdmin = roles.includes('super_admin');
	// The roles an admin route answers: the tier that may read what the
	// instance did, without the tier that may change what it is.
	const operator = superAdmin || roles.includes('admin');
	// Wrap an entry whose page opens on an admin route, or on a super admin
	// route, so a role the engine refuses there is never offered it.
	const operatorOnly = (...nodes: NavNode[]): NavNode[] => (operator ? nodes : []);
	const superAdminOnly = (...nodes: NavNode[]): NavNode[] => (superAdmin ? nodes : []);

	const dailyWork: NavNode[] = [
		{ id: 'dashboard', label: 'Dashboard', href: '/admin', icon: Home, match: 'exact' },
		// Content, the Schema builder and Flows, in the order a reader builds
		// them: a schema, the content in it, the flows that act on it.
		//
		// Content is an admin's although its index lists the schemas first,
		// which any reader may read. Every collection opens on its entries, and
		// the content plugin serves those to an admin only.
		...operatorOnly({ id: 'content', label: 'Content', href: '/admin/content', icon: Database, match: 'prefix' }),
		// Any signed-in reader may read the definitions. A change takes an
		// admin, and the page offers one only to an admin.
		{ id: 'schema', label: 'Schema builder', href: '/admin/schema', icon: Layout, match: 'prefix' },
		// The flow list answers any signed-in reader with the flows the
		// permission rules let that reader see.
		{ id: 'flows', label: 'Flows', href: '/admin/flows', icon: Workflow, match: 'prefix' },
		// Reviews sit beside Content rather than under it: the content prefix
		// is a schema name, so the page lives on its own path. They follow the
		// three rather than splitting them: the queue serves Content and is
		// opened by a narrower group than the three are.
		//
		// A reviewer of any role reads their own assignments. The definitions
		// are an admin's, and the page reads them only for an admin.
		{ id: 'reviews', label: 'Reviews', href: '/admin/reviews', icon: ClipboardCheck, match: 'prefix' },
		...operatorOnly(
			{ id: 'media', label: 'Media library', href: '/admin/media', icon: Images, match: 'prefix' },
			{ id: 'search', label: 'Search', href: '/admin/search', icon: Search, match: 'prefix' },
		),
	];

	const delivery: NavNode[] = [
		// How an external app gets in: the token exchange, the roles a token
		// carries, and a token to try it with. It leads the section because
		// it is the first thing a reader integrating needs, before the
		// reference that lists what they can then call.
		//
		// Every role keeps it. The page reads nothing the engine guards, and
		// the token exchange it tries is open to every account.
		{ id: 'api-access', label: 'API access', href: '/admin/api-access', icon: KeyRound },
		// The engine serves its API document to an admin only, and both pages
		// open on it. Anybody else would get the built-in catalog under a
		// warning that the engine did not answer.
		...operatorOnly(
			{ id: 'api-reference', label: 'API reference', href: '/admin/api-reference', icon: BookOpen },
			// The executing half of the reference. It sits beside it because a
			// reader who wants to know what an endpoint answers is one row away
			// from the page that documents it. 'prefix', so each lab's tab marks
			// this row.
			{ id: 'api-labs', label: 'API labs', href: '/admin/api-labs', icon: FlaskConical, match: 'prefix' },
		),
		// The other protocol the instance answers on. It files with delivery
		// because that is the question it answers: how content gets out.
		//
		// The listener's status says how this process is reachable on its
		// host, so the engine serves it to a super admin only.
		...superAdminOnly({ id: 'grpc', label: 'gRPC', href: '/admin/settings/grpc', icon: Network }),
		...operatorOnly(
			// The endpoint takes any signed-in caller, but the page reads the
			// schema by introspection, which the GraphQL plugin answers for an
			// admin unless the instance opens it to everyone. The persisted
			// queries beside it are an admin route, on a tab of their own, so
			// the row takes 'prefix'.
			{ id: 'graphql', label: 'GraphQL', href: '/admin/settings/graphql', icon: Braces, match: 'prefix' },
			// Releases decide when a set of entries goes out, so they file with
			// how content leaves rather than with the daily editing above.
			// 'prefix', so a release's own page marks this row.
			{ id: 'releases', label: 'Releases', href: '/admin/releases', icon: CalendarClock, match: 'prefix' },
			// Experiments split the traffic that leaves through the read API, so
			// they file with delivery rather than with the instance's settings.
			{
				id: 'experiments',
				label: 'Experiments',
				href: '/admin/experiments',
				icon: FlaskConical,
				match: 'prefix',
			},
			{ id: 'webhooks', label: 'Webhooks', href: '/admin/webhooks', icon: Webhook, match: 'exact' },
			{
				id: 'webhooks-incoming',
				label: 'Incoming webhooks',
				href: '/admin/webhooks/incoming',
				icon: ArrowDownToLine,
			},
		),
	];

	// Admin tokens sit beside API keys, the other machine credential. An admin
	// may issue tokens of their own, so the row is the operator tier's while
	// the rest of the section stays the super admin's.
	const adminTokens: NavNode = {
		id: 'admin-tokens',
		label: 'Admin tokens',
		href: '/admin/admin-tokens',
		icon: KeySquare,
	};
	const access: NavNode[] = superAdmin
		? [
				{ id: 'users', label: 'Users', href: '/admin/users', icon: Users, match: 'prefix' },
				{ id: 'api-keys', label: 'API keys', href: '/admin/api-keys', icon: Key },
				adminTokens,
				{
					id: 'permissions',
					label: 'Permissions',
					href: '/admin/settings/permissions',
					icon: Shield,
				},
				{ id: 'oauth', label: 'OAuth providers', href: '/admin/settings/oauth', icon: LogIn },
				// SAML sits beside OAuth rather than under Settings: both answer
				// the same question, which is who may sign in and on whose word.
				{ id: 'saml', label: 'SAML SSO', href: '/admin/settings/saml', icon: Fingerprint },
				// Provisioning sits with the identity providers it comes from:
				// the same team configures both, usually in one sitting.
				{ id: 'scim', label: 'SCIM provisioning', href: '/admin/settings/scim', icon: UserCog },
			]
		: operator
			? [adminTokens]
			: [];

	const operations: NavNode[] = [
		...(superAdmin
			? [
					{
						id: 'jobs',
						label: 'Scheduled jobs',
						href: '/admin/jobs',
						icon: Timer,
						match: 'prefix' as const,
					},
			  ]
			: []),
		// The operator's, because every row comes from the plugin status, which
		// the engine refuses to everyone else. 'prefix', so a plugin's detail
		// route marks the section it belongs to.
		...(operator
			? [
					{
						id: 'plugins',
						label: 'Plugins',
						href: '/admin/plugins',
						icon: Puzzle,
						match: 'prefix' as const,
					},
			  ]
			: []),
		// AI is the tenant admin's as much as the operator's: the switch, the
		// prompts and the transcripts are theirs, and only provider and price
		// writes need super_admin, which the pages gate themselves.
		...(operator
			? [
					{
						// The section owns its own destination and lists what is
						// under it, the way Settings does, so every AI page has
						// a row.
						id: 'ai',
						label: 'AI',
						href: '/admin/ai',
						icon: Bot,
						match: 'prefix' as const,
						// Three of the tabs have record pages below them, so they take
						// prefix and a record page marks its own tab, not only AI.
						children: [
							{ id: 'ai-providers', label: 'Providers', href: '/admin/ai/providers', icon: Plug, match: 'prefix' as const },
							{ id: 'ai-prompts', label: 'Prompts', href: '/admin/ai/prompts', icon: Sparkles, match: 'prefix' as const },
							{ id: 'ai-prices', label: 'Prices', href: '/admin/ai/prices', icon: Coins },
							{ id: 'ai-transcripts', label: 'Transcripts', href: '/admin/ai/transcripts', icon: ScrollText, match: 'prefix' as const },
							// Named for its section rather than 'Settings', which would give
							// the tree two links with one accessible name: this one and
							// the Settings section itself.
							{ id: 'ai-settings', label: 'AI settings', href: '/admin/ai/settings', icon: SlidersHorizontal },
						],
					},
			  ]
			: []),
		...(superAdmin
			? [
					{
						id: 'tenants',
						label: 'Tenants',
						href: '/admin/tenants',
						icon: Building2,
						match: 'exact' as const,
					},
			  ]
			: []),
		// The quota reads and the cost ledger both answer an admin with the
		// caller's own tenant, and a super admin with every tenant.
		...(operator
			? [
					{
						id: 'tenant-usage',
						label: 'Quotas and usage',
						href: '/admin/tenants/usage',
						icon: Gauge,
					},
					{
						id: 'tenant-costs',
						label: 'Tenant costs',
						href: '/admin/tenants/costs',
						icon: Coins,
						// 'prefix', so the budgets and prices tabs mark this row.
						match: 'prefix' as const,
					},
			  ]
			: []),
	];

	const insight: NavNode[] = operator
		? [
				// 'prefix', because retention is a route below it and should mark this
				// section rather than none.
				{
					id: 'audit-log',
					label: 'Audit log',
					href: '/admin/audit-log',
					icon: ScrollText,
					match: 'prefix' as const,
				},
				// Who changed which entry, beside the audit trail it narrows. It
				// sits outside /admin/content so it never takes the address of a
				// content type with the same name.
				{
					id: 'content-activity',
					label: 'Content activity',
					href: '/admin/content-activity',
					icon: History,
					match: 'prefix' as const,
				},
				// Connection counts are the calling tenant's. The per-tenant
				// roster inside is the super admin's and the page asks for it
				// only on their behalf.
				{ id: 'realtime', label: 'Realtime', href: '/admin/realtime', icon: Satellite },
				// The durable log and the replay that runs against it. Both
				// take an admin, since a replay is scoped to the caller's
				// tenant the way the log is.
				{ id: 'events', label: 'Events', href: '/admin/events', icon: Rss },
				// Exports and the schedules that start them. The jobs are the
				// caller's tenant's, the way the content they read is.
				{ id: 'data-export', label: 'Data export', href: '/admin/data-export', icon: Download },
				// Bulk imports are the other direction and belong beside the
				// export they mirror. 'prefix', so the templates tab marks this row.
				{ id: 'imports', label: 'Imports', href: '/admin/imports', icon: Upload, match: 'prefix' as const },
				// The section owns its overview and lists the pages below it, the
				// way AI does.
				{
					id: 'observability',
					label: 'Observability',
					href: '/admin/observability',
					icon: Activity,
					match: 'prefix' as const,
					// Telemetry, the profiler, the cache and request capture each
					// keep their tabs on routes below their own, so each takes
					// 'prefix' and a tab marks its row.
					children: [
						{ id: 'telemetry', label: 'Telemetry', href: '/admin/observability/telemetry', icon: Radio, match: 'prefix' as const },
						// Both describe every tenant: the profiler samples every
						// request, and a captured statement carries a query's text.
						...(superAdmin
							? [
									{ id: 'profiler', label: 'Profiler', href: '/admin/observability/profiler', icon: Flame, match: 'prefix' as const },
									{ id: 'slow-queries', label: 'Slow queries', href: '/admin/observability/queries', icon: Timer },
								]
							: []),
						{ id: 'synthetic', label: 'Synthetic monitoring', href: '/admin/observability/synthetic', icon: Radar },
						{ id: 'errors', label: 'Errors', href: '/admin/observability/errors', icon: Bug },
						{ id: 'cache', label: 'Cache', href: '/admin/observability/cache', icon: Database, match: 'prefix' as const },
						// The tenant's own captured requests, their rules and
						// the sets replayed together.
						{ id: 'captures', label: 'Request capture', href: '/admin/observability/captures', icon: History, match: 'prefix' as const },
						{ id: 'idempotency', label: 'Idempotency', href: '/admin/observability/idempotency', icon: KeyRound },
					],
				},
				{ id: 'logs', label: 'Logs', href: '/admin/logs', icon: FileText },
				{ id: 'analytics', label: 'API analytics', href: '/admin/analytics', icon: BarChart3 },
				// Where this tenant's tracked events are sent, and the deliveries
				// still owed. An admin's, since the providers are the tenant's.
				{
					id: 'analytics-destinations',
					label: 'Analytics destinations',
					href: '/admin/analytics-destinations',
					icon: Share2,
				},
		  ]
		: [];

	// A tenant's admin shapes that tenant's admin, so the entry is an
	// operator's, not only the super admin's.
	const customization: NavNode = {
		id: 'customization',
		label: 'Customization',
		href: '/admin/settings/customization',
		icon: Palette,
		match: 'prefix',
		// No beta badge here. The page's own header carries it, and a badge on
		// some entries and not on equally beta ones reads as a claim about
		// maturity the tree is not making.
	};
	// The widget this tenant's own pages render. The admin login is not on
	// it: the console always challenges with the instance's own settings.
	const captcha: NavNode = {
		id: 'captcha',
		label: 'Captcha',
		href: '/admin/settings/captcha',
		icon: ShieldQuestion,
	};
	// How the accounts this tenant's identity provider created may sign in
	// without it. The engine answers the tenant's admin and a super admin.
	const signIn: NavNode = {
		id: 'sign-in',
		label: 'Sign-in',
		href: '/admin/settings/sign-in',
		icon: LockKeyhole,
	};
	// A tenant admin's own limit and address lists. A super admin reaches the
	// same page from the instance rate limits.
	const tenantRateLimits: NavNode = {
		id: 'tenant-rate-limits',
		label: 'Rate limits',
		href: '/admin/settings/rate-limits/tenant',
		icon: Gauge,
		// 'prefix', so the refusal history tab marks this row.
		match: 'prefix',
	};
	// Which content types keep versions and for how long. The content plugin
	// serves the settings to an admin and a super admin.
	const contentHistory: NavNode = {
		id: 'content-history',
		label: 'Content history',
		href: '/admin/settings/content-history',
		icon: History,
	};
	// What a tenant's erasures do with its form submissions, and what a
	// person may take in an export of their own data. Each setting on
	// the page is served by its own plugin, so the entry is listed while any
	// of them runs, and the page leaves out the ones that do not answer.
	const privacy: NavNode = {
		id: 'privacy',
		label: 'Privacy',
		href: '/admin/settings/privacy',
		icon: UserLock,
	};
	// Whether outside agents may reach this tenant, and which ones did. The
	// plugin serves its settings to an admin and a super admin.
	const mcp: NavNode = {
		id: 'mcp',
		label: 'MCP server',
		href: '/admin/settings/mcp',
		icon: Cable,
	};
	const settings: NavNode[] = superAdmin
		? [
				// One entry, because there is one place mail is configured: the
				// provider pool and the fallback transport are two halves of the
				// same send.
				{ id: 'email', label: 'Email', href: '/admin/settings/email', icon: Mail, match: 'prefix' },
				// What readers are shown next, and the control arm that proves it.
				{
					id: 'recommendations',
					label: 'Recommendations',
					href: '/admin/settings/recommendations',
					icon: Sparkles,
				},
				// Where content events go once they leave the instance. It is a
				// read: the broker is chosen by the deployment, not here.
				{
					id: 'message-broker',
					label: 'Message broker',
					href: '/admin/settings/message-broker',
					icon: Radio,
				},
				{ id: 'license', label: 'License', href: '/admin/settings/license', icon: ShieldCheck },
				{
					id: 'configuration',
					label: 'Configuration',
					href: '/admin/settings/configuration',
					icon: SlidersHorizontal,
				},
				// Moving that configuration to another instance, beside the page
				// that shows it.
				{
					id: 'config-sync',
					label: 'Config sync',
					href: '/admin/settings/config-sync',
					icon: ArrowLeftRight,
				},
				{
					id: 'security',
					label: 'Security',
					href: '/admin/settings/security',
					icon: ShieldAlert,
				},
				// Throttling sits with the other instance-wide controls rather
				// than under Insight: it is configuration, not a reading.
				{
					id: 'rate-limits',
					label: 'Rate limits',
					href: '/admin/settings/rate-limits',
					icon: Gauge,
					// 'prefix', so the tenant controls below it mark this row.
					match: 'prefix',
				},
				{ id: 'storage', label: 'Storage', href: '/admin/settings/storage', icon: HardDrive },
				// Retention is a tab of the audit log rather than a row here.
				// Settings is right for a policy set once and wrong for a legal
				// hold, which is raised during an incident by somebody already
				// reading the entries it protects.
				{
					id: 'localization',
					label: 'Locales',
					href: '/admin/settings/localization',
					icon: Languages,
				},
				// Where the data is, beside the rules about who may see it.
				{ id: 'residency', label: 'Data residency', href: '/admin/settings/residency', icon: Globe },
				{ id: 'gdpr', label: 'Privacy requests', href: '/admin/gdpr', icon: Scale },
				// What is redacted and who read it in the clear. It sits in
				// Settings beside GDPR because both answer the same auditor.
				// 'prefix', so the unmasked reads tab marks this row.
				{ id: 'pii', label: 'PII masking', href: '/admin/settings/pii', icon: EyeOff, match: 'prefix' },
				customization,
				captcha,
				signIn,
				contentHistory,
				privacy,
				mcp,
		  ]
		: operator
			? [customization, captcha, signIn, tenantRateLimits, contentHistory, privacy, mcp]
			: [];

	const tree: NavTree = [
		...dailyWork,
		...group({ id: 'delivery', label: 'Delivery', icon: Send }, delivery),
		...group({ id: 'access', label: 'Access', icon: Lock, defaultExpanded: true }, access),
		...group({ id: 'operations', label: 'Operations', icon: Wrench }, operations),
		...group({ id: 'insight', label: 'Insight', icon: Gauge }, insight),
		// The section owns the destination its own heading would otherwise
		// duplicate: the kit renders a node with both an href and children as a
		// link beside its own disclosure, so Settings stays one entry.
		{
			id: 'settings',
			label: 'Settings',
			href: '/admin/settings',
			icon: Settings,
			match: 'prefix',
			children: settings,
		},
	];

	const plugins = inputs.plugins ?? UNNAMED;
	const customizable = inputs.customizable ?? true;
	const licenseModule = inputs.licenseModule ?? true;
	return prune(tree, (id) => {
		const plugin = PAGE_PLUGIN[id];
		if (plugin !== undefined && !runs(plugins, plugin)) return false;
		if (id === 'license') return licenseModule;
		if (id === 'privacy') return PRIVACY_PLUGINS.some((p) => runs(plugins, p));
		return id !== 'customization' || customizable;
	});
}

/**
 * Where the current page sits, as the header shows it: the sidebar's own
 * labels from the section down to the page, at most the last two of them.
 *
 * Read from the tree the sidebar is already rendering, so a page cannot be
 * filed one place in the nav and another in the header. GraphQL lives at
 * /admin/settings/graphql but is filed under Delivery, and the header says
 * Delivery / GraphQL. The URL is where the route was mounted, not where a
 * reader looks for it. Two labels are enough to place any page, and a third
 * would truncate the one that names the page on a phone.
 *
 * Matching follows the same rule the kit's SidebarNav uses to decide which row
 * is current, and for the same reason: a leaf answers for its own path and a
 * node that owns a section answers for its subtree. A plain prefix test over
 * every node instead lets Dashboard, whose href is /admin, claim every admin
 * route that has no entry of its own, so a page with no nav row would be
 * announced in the header as Dashboard.
 *
 * Where two nodes both match, the deeper href wins, which is what makes
 * /admin/settings/license read as Settings / License rather than as Settings.
 */
export function adminTrail(pathname: string, items: NavTree): string[] {
	const path = pathname.replace(/\/+$/, '') || '/';
	let best: { trail: string[]; length: number } | undefined;

	const walk = (nodes: NavTree, above: string[]): void => {
		for (const node of nodes) {
			const trail = [...above, node.label];
			const mode = node.match ?? (node.children?.length ? 'prefix' : 'exact');
			const hit =
				node.href !== undefined &&
				mode !== 'none' &&
				(path === node.href || (mode === 'prefix' && path.startsWith(node.href + '/')));
			if (hit && (!best || node.href!.length > best.length)) {
				best = { trail, length: node.href!.length };
			}
			if (node.children) walk(node.children, trail);
		}
	};
	walk(items, []);

	// A page with no row of its own is named by its title, under the row that
	// encloses it, so the header never stops at Settings on a settings page.
	const unlisted = UNLISTED_PAGES.find((p) => path === p.href || path.startsWith(p.href + '/'));
	if (unlisted && (!best || unlisted.href.length > best.length)) {
		return [...(best?.trail ?? []), unlisted.label].slice(-2);
	}
	return best ? best.trail.slice(-2) : [];
}

/** The header's text for the current page: its trail, or the admin's name off the map. */
export function adminSection(pathname: string, items: NavTree, name = PRODUCT_NAME): string {
	const trail = adminTrail(pathname, items);
	return trail.length > 0 ? trail.join(' / ') : name;
}

// Every entry, whoever reads: which plugin draws a page is a fact about the
// page, and the role gate is the page's own. The tree takes no input past the
// role, so it is built once, on first use, rather than on every navigation.
let everyEntry: NavTree | undefined;

/** The entry that owns a page: the longest href at or above the path, by prefix. */
function owner(pathname: string): { href: string; label: string; plugin: PluginName | undefined } | undefined {
	const path = pathname.replace(/\/+$/, '') || '/';
	const under = (href: string) => path === href || path.startsWith(href + '/');
	let best: { href: string; label: string; plugin: PluginName | undefined } | undefined;
	const consider = (href: string, label: string, plugin: PluginName | undefined) => {
		if (href !== '/admin' && under(href) && (!best || href.length > best.href.length)) best = { href, label, plugin };
	};
	const walk = (nodes: NavTree): void => {
		for (const node of nodes) {
			if (node.href !== undefined) consider(node.href, node.label, PAGE_PLUGIN[node.id]);
			if (node.children) walk(node.children);
		}
	};
	walk(everyEntry ??= adminNav(['super_admin']));
	for (const page of UNLISTED_PAGES) consider(page.href, page.label, page.plugin);
	return best;
}

/**
 * The plugin the page at `pathname` belongs to, or undefined for a page the
 * engine owns.
 *
 * Unlike adminTrail this matches every entry by prefix: a page below a leaf,
 * such as a flow's editor under Flows, still belongs to that leaf's plugin.
 * The longest href wins, so /admin/tenants/usage is the usage plugin's
 * through its own entry rather than the multitenant plugin's through its
 * parent's.
 */
export function pagePlugin(pathname: string): PluginName | undefined {
	return owner(pathname)?.plugin;
}

/** The name of the entry that owns the page at `pathname`, for a heading. */
export function pageLabel(pathname: string): string | undefined {
	return owner(pathname)?.label;
}

/** What a tenant changed about its menu, as the customization read returns it. */
export interface NavCustomization {
	hidden: readonly string[];
	pinned: readonly string[];
	links: readonly { label: string; url: string; roles?: string[] }[];
	pages: readonly { slug: string; title: string }[];
}

/**
 * The sidebar as one tenant shaped it: its hidden entries dropped, its pinned
 * ones repeated in a group at the top, and its own pages and links in groups
 * of their own under the daily work. Hiding is presentation only. The page
 * behind a hidden entry is still guarded by its own route.
 */
export function customizeNav(tree: NavTree, custom: NavCustomization | null | undefined, roles: readonly string[]): NavTree {
	if (!custom) return tree;
	const hidden = new Set(custom.hidden);
	const shaped = prune(tree, (id) => !hidden.has(id));

	const byId = new Map<string, NavNode>();
	const index = (nodes: NavTree) => {
		for (const node of nodes) {
			if (node.href !== undefined) byId.set(node.id, node);
			if (node.children) index(node.children);
		}
	};
	index(shaped);
	const pinned: NavNode[] = [];
	for (const id of custom.pinned) {
		const node = byId.get(id);
		if (node?.href) pinned.push({ id: `pinned-${id}`, label: node.label, href: node.href, icon: node.icon, match: 'none' });
	}

	const pages: NavNode[] = custom.pages.map((p) => ({
		id: `page-${p.slug}`,
		label: p.title,
		href: `/admin/pages/${p.slug}`,
		icon: FileText,
	}));
	const links: NavNode[] = custom.links
		.filter((l) => !l.roles || l.roles.length === 0 || roles.includes('super_admin') || l.roles.some((r) => roles.includes(r)))
		.map((l, i) => ({ id: `link-${i}`, label: l.label, href: l.url, icon: LinkIcon, match: 'none' as const }));

	// Pinned leads, because pinning says "I open this every day". The tenant's
	// own pages and links follow the daily work, which is where a reader looks
	// for something the team made.
	const firstGroup = shaped.findIndex((n) => n.children !== undefined && n.href === undefined);
	const at = firstGroup === -1 ? shaped.length : firstGroup;
	return [
		...group({ id: 'pinned', label: 'Pinned', icon: Pin, defaultExpanded: true }, pinned),
		...shaped.slice(0, at),
		...group({ id: 'custom-pages', label: 'Pages', icon: LayoutTemplate, defaultExpanded: true }, pages),
		...group({ id: 'custom-links', label: 'Links', icon: LinkIcon }, links),
		...shaped.slice(at),
	];
}

/**
 * Every entry of a tree a reader can open, with the section it sits in, in
 * sidebar order: what a tenant chooses from when it hides or pins entries.
 */
export function navLeaves(tree: NavTree): { id: string; label: string; section: string }[] {
	const out: { id: string; label: string; section: string }[] = [];
	const walk = (nodes: NavTree, section: string) => {
		for (const node of nodes) {
			if (node.href !== undefined && node.id !== 'customization') out.push({ id: node.id, label: node.label, section });
			if (node.children) walk(node.children, section || node.label);
		}
	};
	walk(tree, '');
	return out;
}
