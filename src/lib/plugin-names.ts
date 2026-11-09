/**
 * Plugin names, as the engine serves them in the plugin status and the
 * running list: lower-case, hyphenated and unprefixed.
 *
 * A page belongs to one plugin and shows only while the engine reports that
 * plugin running, so these are the only names a page gates on. What a running
 * plugin lets a caller do beyond that is the plugin's own answer, or the
 * refusal its routes send.
 */
export const PLUGIN = {
	content: 'content',
	schema: 'schema',
	media: 'media',
	// Providers, prompts, transcripts and the assists that call them.
	ai: 'ai',
	flow: 'flow',
	review: 'review',
	search: 'search',
	webhook: 'webhook',
	apikey: 'apikey',
	cron: 'cron',
	audit: 'audit',
	logging: 'logging',
	analytics: 'apianalytics',
	// Tracked events and the third-party destinations they are sent to, which
	// is a different plugin from the API usage above.
	productAnalytics: 'analytics',
	// The tenant registry, the cost ledger and each tenant's customization.
	multitenant: 'multitenant',
	permissions: 'permissions',
	mfa: 'mfa',
	oauth: 'oauth',
	// The translations panel and the locales page.
	localization: 'localization',
	// Identity providers, their certificates and the rollover between them.
	// The sign-in buttons on the login page come from the plugin's own public
	// route, so a route that refuses means no button.
	saml: 'saml',
	// Account provisioning from an identity provider. The connections screen
	// owns who may call the SCIM endpoints. The endpoints themselves are the
	// identity provider's.
	scim: 'scim',
	// Remembered browsers. Every route is the signed-in person's own, so the
	// page sits with the account rather than the instance settings.
	deviceFingerprint: 'device-fingerprint',
	// Browsers a person approved to edit pages through a signed connection.
	builder: 'builder',
	// Probes this instance runs against itself, and the alerts they raise.
	syntheticMonitoring: 'synthetic-monitoring',
	// Content events published to NATS, Kafka or RabbitMQ. The plugin serves
	// one read and nothing to write: the broker is a deployment choice.
	messagebroker: 'messagebroker',
	// Traffic splitting, exposures and conversions.
	abTesting: 'ab-testing',
	// Regions, tenant placement and the report that says where data is.
	dataResidency: 'data-residency',
	// Computed feeds, trending items and the control arm they are measured
	// against.
	recommendations: 'recommendations',
	// Schemas, content and flows over gRPC, on listeners of the plugin's own.
	grpc: 'grpc',
	// The GraphQL schema generated from the content types, and its allowlist.
	graphql: 'graphql',
	rateLimit: 'rate-limit',
	cache: 'cache',
	idempotency: 'idempotency',
	errorTracking: 'error-tracking',
	bulkImport: 'bulk-import',
	storage: 'storage',
	usage: 'usage',
	email: 'email',
	// Response masking and the log of who read unmasked data.
	piiMask: 'pii-mask',
	// Content exports: the jobs that ran and the schedules that start them.
	dataExport: 'data-export',
	// The durable event log and the replay that runs against it.
	events: 'events',
	// Two transports, presence and broadcast. The tenant metrics route is
	// every admin's. The per-tenant roster across the instance is not.
	realtime: 'realtime',
	// Sampled slow queries with their plans. Super admin only, since a
	// captured statement carries the text of a query over one tenant's data.
	queryMonitor: 'query-monitor',
	telemetry: 'telemetry',
	profiler: 'profiler',
	// Requests this instance served, kept to be replayed and compared.
	requestCapture: 'request-capture',
	// The widget a tenant's own pages render. The admin login always
	// challenges with the instance's.
	captcha: 'captcha',
} as const;

/** One of the names above. */
export type PluginName = (typeof PLUGIN)[keyof typeof PLUGIN];
