/**
 * The endpoint catalog the API reference page draws. The console carries it
 * rather than asking the engine, because the page explains each route in the
 * console's own words, which no machine description the engine serves holds.
 */

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type AuthRequirement =
	| 'none'           // Public: no token needed
	| 'bearer'         // Bearer JWT (Content API)
	| 'cookie'         // HTTP-only __Host-sys_session cookie (the console)
	| 'bearer-or-cookie'; // Either works (Admin API endpoints)

export interface EndpointParam {
	name: string;
	in: 'path' | 'query' | 'body';
	type: string;
	required: boolean;
	description: string;
	/** The values the engine accepts, when it enumerates them. */
	values?: string[];
}

export interface EndpointDoc {
	method: HttpMethod;
	path: string;
	summary: string;
	description?: string;
	auth: AuthRequirement;
	/** Minimum role required to call this endpoint */
	roles?: string[];
	params?: EndpointParam[];
	requestBody?: { description: string; example: string };
	response?: { description: string; example: string };
	/** The statuses the engine documents for the route, in code order. */
	statuses?: { code: string; description: string }[];
	tags?: string[];
}

export interface EndpointGroup {
	id: string;
	label: string;
	description: string;
	server: 'admin' | 'api' | 'both';
	baseUrl: string;
	endpoints: EndpointDoc[];
}

// Admin API (:3001 / /api/admin)

const adminAuthGroup: EndpointGroup = {
	id: 'admin-auth',
	label: 'Admin · Auth',
	description: 'Authentication and setup for LyEve Console. Uses HTTP-only cookie sessions.',
	server: 'admin',
	baseUrl: '/api/admin',
	endpoints: [
		{
			method: 'GET',
			path: '/api/admin/setup',
			summary: 'Setup status',
			description: 'Returns whether the engine has been set up, which means at least one admin account exists.',
			auth: 'none',
			response: {
				description: 'Setup state',
				example: `{ "setup_required": true, "token_source": "log" }`,
			},
		},
		{
			method: 'POST',
			path: '/api/admin/setup',
			summary: 'Initial setup',
			description:
				'Creates the first super admin account. It works only while no account exists, and only with the setup token: LYEVE_SETUP_TOKEN, or the one-time token the engine logs at boot. Without it the answer is 401.',
			auth: 'none',
			requestBody: {
				description: 'First user credentials and the setup token',
				example: `{\n  "email": "admin@example.com",\n  "password": "secure-password",\n  "setup_token": "from-the-engine-log"\n}`,
			},
			response: {
				description: 'Sets __Host-sys_session cookie and returns the created user.',
				example: `{\n  "id": "uuid",\n  "email": "admin@example.com",\n  "roles": ["super_admin"]\n}`,
			},
		},
		{
			method: 'POST',
			path: '/api/admin/auth/login',
			summary: 'Login',
			description: 'Authenticates with email/password. Sets an HTTP-only __Host-sys_session cookie on success.',
			auth: 'none',
			requestBody: {
				description: 'Credentials',
				example: `{\n  "email": "admin@example.com",\n  "password": "your-password"\n}`,
			},
			response: {
				description: 'User object. Cookie is set in the response header.',
				example: `{\n  "id": "uuid",\n  "email": "admin@example.com",\n  "roles": ["admin"]\n}`,
			},
		},
		{
			method: 'POST',
			path: '/api/admin/auth/logout',
			summary: 'Logout',
			description: 'Clears the __Host-sys_session cookie.',
			auth: 'cookie',
			response: { description: 'Empty 204 response.', example: '' },
		},
		{
			method: 'GET',
			path: '/api/admin/auth/me',
			summary: 'Current user',
			description: 'Returns the authenticated admin user from the active session.',
			auth: 'cookie',
			response: {
				description: 'Authenticated user',
				example: `{\n  "id": "uuid",\n  "email": "admin@example.com",\n  "roles": ["admin"]\n}`,
			},
		},
	],
};

const adminSchemasGroup: EndpointGroup = {
	id: 'admin-schemas',
	label: 'Admin · Content types',
	description: 'Manage content type definitions. Only an admin or a super admin can write a content type.',
	server: 'admin',
	baseUrl: '/api/admin',
	endpoints: [
		{
			method: 'GET',
			path: '/api/admin/schemas',
			summary: 'List content types',
			auth: 'cookie',
			response: {
				description: 'Array of content type definitions',
				example: `[{ "name": "posts", "display_name": "Posts", "fields": [...] }]`,
			},
		},
		{
			method: 'GET',
			path: '/api/admin/schemas/{name}',
			summary: 'Get content type',
			auth: 'cookie',
			params: [{ name: 'name', in: 'path', type: 'string', required: true, description: 'Content type identifier' }],
			response: {
				description: 'Single content type definition',
				example: `{ "name": "posts", "display_name": "Posts", "fields": [...] }`,
			},
		},
		{
			method: 'POST',
			path: '/api/admin/schemas',
			summary: 'Create / update content type',
			description: 'Creates a new content type or updates an existing one. Generates and applies DDL automatically.',
			auth: 'cookie',
			roles: ['admin', 'super_admin'],
			requestBody: {
				description: 'Full content type definition',
				example: `{\n  "name": "posts",\n  "display_name": "Posts",\n  "with_created_at": true,\n  "with_updated_at": true,\n  "fields": [\n    {\n      "name": "title",\n      "field_type": "text",\n      "required": true,\n      "unique": false,\n      "indexed": true\n    }\n  ]\n}`,
			},
			response: {
				description: 'Saved content type',
				example: `{ "name": "posts", "display_name": "Posts", "fields": [...] }`,
			},
		},
		{
			method: 'DELETE',
			path: '/api/admin/schemas/{name}',
			summary: 'Delete content type',
			description: "Deletes the content type definition and this tenant's rows. The table is dropped only when no other tenant defines the content type. This cannot be undone.",
			auth: 'cookie',
			roles: ['admin', 'super_admin'],
			params: [{ name: 'name', in: 'path', type: 'string', required: true, description: 'Content type identifier' }],
			response: { description: 'Empty 204 response.', example: '' },
		},
		{
			method: 'GET',
			path: '/api/admin/schemas/{name}/stats',
			summary: 'Content type stats',
			description: "Returns row count and storage size for the content type's table.",
			auth: 'cookie',
			params: [{ name: 'name', in: 'path', type: 'string', required: true, description: 'Content type identifier' }],
			response: {
				description: 'Stats object',
				example: `{ "rows": 142, "table": "content_posts" }`,
			},
		},
		{
			method: 'POST',
			path: '/api/admin/schemas/import',
			summary: 'Import content types',
			description:
				'Plans an import of a content type bundle, or of definitions from another system named by from, and applies it only with apply=true. The body is JSON or YAML, sent as application/json, application/yaml, application/x-yaml or text/yaml, at most 4 MiB. 422 when the definitions cannot be read, 409 when their references cannot be satisfied.',
			auth: 'cookie',
			roles: ['super_admin'],
			params: [
				{ name: 'from', in: 'query', type: 'string', required: false, description: 'Source format', values: ['lyeve', 'json-schema', 'openapi', 'strapi', 'contentful', 'wordpress'] },
				{ name: 'apply', in: 'query', type: 'boolean', required: false, description: 'Write the changes. Without it, nothing is written.' },
			],
			response: {
				description: 'The plan, and whether it was applied.',
				example: `{\n  "applied": false,\n  "plan": { ... }\n}`,
			},
		},
	],
};

const adminUsersGroup: EndpointGroup = {
	id: 'admin-users',
	label: 'Admin · Users',
	description: "Manage the console's accounts. Only a super admin can call these endpoints.",
	server: 'admin',
	baseUrl: '/api/admin',
	endpoints: [
		{
			method: 'GET',
			path: '/api/admin/users',
			summary: 'List users',
			auth: 'cookie',
			roles: ['super_admin'],
			response: {
				description: 'Array of users',
				example: `[{ "id": "uuid", "email": "admin@example.com", "roles": ["admin"] }]`,
			},
		},
		{
			method: 'POST',
			path: '/api/admin/users',
			summary: 'Create user',
			auth: 'cookie',
			roles: ['super_admin'],
			requestBody: {
				description: 'New user details',
				example: `{\n  "email": "editor@example.com",\n  "password": "secure-password",\n  "roles": ["editor"]\n}`,
			},
			response: {
				description: 'Created user',
				example: `{ "id": "uuid", "email": "editor@example.com", "roles": ["editor"] }`,
			},
		},
		{
			method: 'PUT',
			path: '/api/admin/users/{id}/roles',
			summary: 'Update user roles',
			auth: 'cookie',
			roles: ['super_admin'],
			params: [{ name: 'id', in: 'path', type: 'uuid', required: true, description: 'User ID' }],
			requestBody: {
				description: 'New roles array',
				example: `{ "roles": ["editor", "admin"] }`,
			},
			response: {
				description: 'Updated user',
				example: `{ "id": "uuid", "email": "...", "roles": ["editor", "admin"] }`,
			},
		},
		{
			method: 'DELETE',
			path: '/api/admin/users/{id}',
			summary: 'Delete user',
			auth: 'cookie',
			roles: ['super_admin'],
			params: [{ name: 'id', in: 'path', type: 'uuid', required: true, description: 'User ID' }],
			response: { description: 'Empty 204 response.', example: '' },
		},
	],
};

const adminMigrateGroup: EndpointGroup = {
	id: 'admin-migrate',
	label: 'Admin · Migrations',
	description: 'DDL migration status and application. Maps to the sys_ddl_log table.',
	server: 'admin',
	baseUrl: '/api/admin',
	endpoints: [
		{
			method: 'GET',
			path: '/api/admin/migrate',
			summary: 'Migration status',
			description: 'Returns count of pending DDL log entries not yet applied.',
			auth: 'cookie',
			response: {
				description: 'Pending count',
				example: `{ "pending": 2 }`,
			},
		},
		{
			method: 'POST',
			path: '/api/admin/migrate/apply',
			summary: 'Apply pending migrations',
			description: 'Executes all pending DDL statements in sys_ddl_log. Runs in a transaction.',
			auth: 'cookie',
			roles: ['admin', 'super_admin'],
			response: {
				description: 'Applied count',
				example: `{ "applied": 2 }`,
			},
		},
	],
};

const adminWebhooksGroup: EndpointGroup = {
	id: 'admin-webhooks',
	label: 'Admin · Webhooks',
	description: 'Manage outgoing HTTP webhooks. Each matching URL receives a POST after a content event.',
	server: 'admin',
	baseUrl: '/api/admin',
	endpoints: [
		{
			method: 'GET',
			path: '/api/admin/webhooks',
			summary: 'List webhooks',
			auth: 'cookie',
			roles: ['admin', 'super_admin'],
			response: {
				description: 'Array of webhook objects.',
				example: `[\n  {\n    "id": "uuid",\n    "name": "My Hook",\n    "url": "https://example.com/hook",\n    "events": ["after_create"],\n    "schemas": [],\n    "enabled": true\n  }\n]`,
			},
		},
		{
			method: 'GET',
			path: '/api/admin/webhooks/{id}',
			summary: 'Get webhook',
			auth: 'cookie',
			roles: ['admin', 'super_admin'],
			params: [{ name: 'id', in: 'path', type: 'uuid', required: true, description: 'Webhook UUID' }],
			response: { description: 'Single webhook object.', example: `{ "id": "uuid", "name": "...", ... }` },
		},
		{
			method: 'POST',
			path: '/api/admin/webhooks',
			summary: 'Create webhook',
			auth: 'cookie',
			roles: ['admin', 'super_admin'],
			requestBody: {
				description: 'Webhook definition',
				example: `{\n  "name": "Notify Slack",\n  "url": "https://hooks.slack.com/...",\n  "events": ["after_create", "after_update"],\n  "schemas": ["posts"],\n  "secret": "optional-hmac-key",\n  "enabled": true\n}`,
			},
			response: { description: 'Created webhook.', example: `{ "id": "uuid", "name": "Notify Slack", ... }` },
		},
		{
			method: 'PUT',
			path: '/api/admin/webhooks/{id}',
			summary: 'Update webhook',
			auth: 'cookie',
			roles: ['admin', 'super_admin'],
			params: [{ name: 'id', in: 'path', type: 'uuid', required: true, description: 'Webhook UUID' }],
			requestBody: {
				description: 'Fields to update (all optional)',
				example: `{\n  "enabled": false\n}`,
			},
			response: { description: 'Updated webhook.', example: `{ "id": "uuid", "enabled": false, ... }` },
		},
		{
			method: 'DELETE',
			path: '/api/admin/webhooks/{id}',
			summary: 'Delete webhook',
			auth: 'cookie',
			roles: ['admin', 'super_admin'],
			params: [{ name: 'id', in: 'path', type: 'uuid', required: true, description: 'Webhook UUID' }],
			response: { description: 'Empty 204 response.', example: '' },
		},
		{
			method: 'POST',
			path: '/api/admin/webhooks/{id}/test',
			summary: 'Test webhook',
			description: 'Fires a synchronous test POST to the webhook URL. Returns HTTP status and whether the request succeeded.',
			auth: 'cookie',
			roles: ['admin', 'super_admin'],
			params: [{ name: 'id', in: 'path', type: 'uuid', required: true, description: 'Webhook UUID' }],
			response: {
				description: 'Test result',
				example: `{ "success": true, "status_code": 200, "message": "OK" }`,
			},
		},
		{
			method: 'POST',
			path: '/api/admin/webhooks/{id}/rotate-secret',
			summary: 'Rotate webhook secret',
			description: 'Replaces the webhook signing secret. Pass new_secret in the body to choose it, or omit it to generate one. Only a super admin can call this.',
			auth: 'cookie',
			roles: ['super_admin'],
			params: [{ name: 'id', in: 'path', type: 'uuid', required: true, description: 'Webhook UUID' }],
			requestBody: {
				description: 'Optional new secret (min 16 chars). Omit to auto-generate.',
				example: `{ "new_secret": "my-new-custom-secret-here" }`,
			},
			response: { description: 'Updated webhook (secret redacted).', example: `{ "id": "uuid", "name": "...", ... }` },
		},
		{
			method: 'POST',
			path: '/api/admin/webhooks/{id}/deliveries/{delivery_id}/retry',
			summary: 'Retry a failed delivery',
			description: 'Re-fires a previously failed delivery to the webhook URL synchronously. Returns the HTTP status and success flag.',
			auth: 'cookie',
			roles: ['admin', 'super_admin'],
			params: [
				{ name: 'id', in: 'path', type: 'uuid', required: true, description: 'Webhook UUID' },
				{ name: 'delivery_id', in: 'path', type: 'uuid', required: true, description: 'Delivery UUID' },
			],
			response: {
				description: 'Retry result',
				example: `{ "success": true, "status_code": 200, "message": "OK", "delivery_id": "uuid" }`,
			},
		},
		{
			method: 'GET',
			path: '/api/admin/webhooks/{id}/retry-config',
			summary: 'Get retry config',
			description: 'Returns the per-webhook retry strategy configuration.',
			auth: 'cookie',
			roles: ['admin', 'super_admin'],
			params: [{ name: 'id', in: 'path', type: 'uuid', required: true, description: 'Webhook UUID' }],
			response: {
				description: 'Retry config',
				example: `{ "id": "uuid", "webhook_id": "uuid", "max_attempts": 5, "base_delay_ms": 30000, "max_delay_ms": 600000, "strategy": "exponential", "enabled": true }`,
			},
		},
		{
			method: 'PUT',
			path: '/api/admin/webhooks/{id}/retry-config',
			summary: 'Update retry config',
			description: 'Creates or updates the per-webhook retry strategy. Defaults: max_attempts=5, base_delay_ms=30000, max_delay_ms=600000, strategy=exponential.',
			auth: 'cookie',
			roles: ['admin', 'super_admin'],
			params: [{ name: 'id', in: 'path', type: 'uuid', required: true, description: 'Webhook UUID' }],
			requestBody: {
				description: 'Retry config fields (all optional)',
				example: `{ "max_attempts": 3, "strategy": "fixed", "enabled": false }`,
			},
			response: { description: 'Updated retry config.', example: `{ "id": "uuid", "max_attempts": 3, ... }` },
		},
		{
			method: 'GET',
			path: '/api/admin/webhooks/{id}/health',
			summary: 'Webhook health',
			description: 'Returns delivery health stats for a single webhook including success rate, DLQ count, and healthy flag.',
			auth: 'cookie',
			roles: ['admin', 'super_admin'],
			params: [{ name: 'id', in: 'path', type: 'uuid', required: true, description: 'Webhook UUID' }],
			response: {
				description: 'Health stats',
				example: `{ "webhook_id": "uuid", "webhook_name": "My Hook", "total_attempts": 100, "success_count": 95, "failed_count": 5, "exhausted_count": 2, "dlq_pending": 1, "healthy": true }`,
			},
		},
		{
			method: 'GET',
			path: '/api/admin/webhooks/health',
			summary: 'Global webhook health',
			description: 'Returns aggregated health stats across all webhooks.',
			auth: 'cookie',
			roles: ['admin', 'super_admin'],
			response: {
				description: 'Global health stats',
				example: `{ "total_webhooks": 5, "healthy_webhooks": 4, "unhealthy_webhooks": 1, "pending_retries": 12, "total_dlq": 3, "pending_dlq": 2 }`,
			},
		},
	],
};

// Admin · Dead Letter Queue

const adminDeadLettersGroup: EndpointGroup = {
	id: 'admin-dead-letters',
	label: 'Admin · Dead Letters',
	description: 'Manage webhook deliveries that exhausted all retry attempts. Entries can be replayed, dismissed, or permanently deleted.',
	server: 'admin',
	baseUrl: '/api/admin',
	endpoints: [
		{
			method: 'GET',
			path: '/api/admin/webhook-dead-letters',
			summary: 'List dead letters',
			description: 'Returns paginated dead letter entries. Optional status filter (pending, replayed, dismissed).',
			auth: 'cookie',
			roles: ['admin', 'super_admin'],
			params: [
				{ name: 'status', in: 'query', type: 'string', required: false, description: 'Filter by status: pending, replayed, dismissed' },
				{ name: 'limit', in: 'query', type: 'number', required: false, description: 'Max entries (default 20)' },
				{ name: 'offset', in: 'query', type: 'number', required: false, description: 'Pagination offset' },
			],
			response: {
				description: 'Paginated dead letter entries',
				example: `{ "items": [...], "total": 3, "limit": 20, "offset": 0 }`,
			},
		},
		{
			method: 'GET',
			path: '/api/admin/webhook-dead-letters/{id}',
			summary: 'Get dead letter',
			auth: 'cookie',
			roles: ['admin', 'super_admin'],
			params: [{ name: 'id', in: 'path', type: 'uuid', required: true, description: 'Dead letter UUID' }],
			response: { description: 'Single dead letter entry.', example: `{ "id": "uuid", "webhook_name": "...", ... }` },
		},
		{
			method: 'POST',
			path: '/api/admin/webhook-dead-letters/{id}/replay',
			summary: 'Replay dead letter',
			description: 'Re-fires the dead letter delivery to the webhook URL. Returns HTTP status of the replay attempt.',
			auth: 'cookie',
			roles: ['admin', 'super_admin'],
			params: [{ name: 'id', in: 'path', type: 'uuid', required: true, description: 'Dead letter UUID' }],
			response: {
				description: 'Replay result',
				example: `{ "id": "uuid", "status": "replayed", "http_status": 200 }`,
			},
		},
		{
			method: 'POST',
			path: '/api/admin/webhook-dead-letters/{id}/dismiss',
			summary: 'Dismiss dead letter',
			description: 'Marks the dead letter entry as dismissed without re-firing.',
			auth: 'cookie',
			roles: ['admin', 'super_admin'],
			params: [{ name: 'id', in: 'path', type: 'uuid', required: true, description: 'Dead letter UUID' }],
			response: {
				description: 'Dismissal confirmation',
				example: `{ "id": "uuid", "status": "dismissed" }`,
			},
		},
		{
			method: 'DELETE',
			path: '/api/admin/webhook-dead-letters/{id}',
			summary: 'Delete dead letter',
			description: 'Removes the dead letter entry. This cannot be undone.',
			auth: 'cookie',
			roles: ['admin', 'super_admin'],
			params: [{ name: 'id', in: 'path', type: 'uuid', required: true, description: 'Dead letter UUID' }],
			response: { description: 'Empty 204 response.', example: '' },
		},
	],
};

// Admin · System (entitlements / plugins)

const adminSystemGroup: EndpointGroup = {
	id: 'admin-system',
	label: 'Admin · System',
	description: 'Entitlements and plugin state, as the engine serves them.',
	server: 'admin',
	baseUrl: '/api/admin',
	endpoints: [
		{
			method: 'GET',
			path: '/api/admin/entitlements',
			summary: 'Entitlements',
			description:
				'Reports the plan and the state of its license, the features served to the caller\'s tenant and those withheld from it (withheld), the tenant quota, the numeric caps by name, where 0 is unlimited (caps), and whether the build links a license module (license_module). A license module can add the plan in its own words (plan_label), when the license expires (expires_at) and when a grace period ends (grace_ends_at), and why the license is not what was configured (license_error).',
			auth: 'cookie',
			roles: ['admin', 'super_admin'],
			response: {
				description: 'Entitlement snapshot.',
				example: `{\n  "plan": "example",\n  "plan_label": "Example",\n  "state": "active",\n  "features": ["search"],\n  "withheld": [],\n  "tenant_quota": 0,\n  "caps": {},\n  "expires_at": "2026-10-25T00:00:00Z",\n  "license_module": true\n}`,
			},
		},
		{
			method: 'GET',
			path: '/api/admin/plugins/status',
			summary: 'Plugin activation status',
			description:
				'Lists every plugin compiled into the binary with whether it is entitled, requested and running, and the phase it is in. A plugin that is not entitled can carry the URL where it is enabled (upgrade_url), and a running plugin lists the routes it serves (routes).',
			auth: 'cookie',
			roles: ['admin', 'super_admin'],
			response: {
				description: 'Plugin status report.',
				example: `{\n  "compiled": ["example"],\n  "entitled": [],\n  "plugins": [\n    {\n      "name": "example",\n      "compiled": true,\n      "entitled": false,\n      "requested": false,\n      "active": false,\n      "phase": "registered",\n      "upgrade_url": "/admin/settings/license?plugin=example"\n    }\n  ]\n}`,
			},
		},
		{
			method: 'GET',
			path: '/api/admin/plugins/{name}/schema',
			summary: 'Plugin configuration schema',
			description:
				"Returns the JSON Schema for a plugin's configuration, which the console uses to draw its settings form.",
			auth: 'cookie',
			roles: ['admin', 'super_admin'],
			params: [{ name: 'name', in: 'path', type: 'string', required: true, description: 'Plugin name' }],
			response: {
				description: 'JSON Schema document.',
				example: `{\n  "type": "object",\n  "properties": {\n    "max_items": { "type": "integer", "default": 100 }\n  }\n}`,
			},
		},
	],
};

// Content API (:3002 / /api/v1)

const apiAuthGroup: EndpointGroup = {
	id: 'api-auth',
	label: 'API · Auth',
	description: 'Obtain bearer tokens for the content API. Tokens are JWTs signed with EdDSA (Ed25519) and verifiable at /.well-known/jwks.json. HS256 is a legacy fallback.',
	server: 'api',
	baseUrl: '/api/v1',
	endpoints: [
		{
			method: 'POST',
			path: '/api/v1/auth/token',
			summary: 'Obtain Bearer token',
			description: 'Exchange email + password for a signed JWT. Use the token in the Authorization header for all other API endpoints.',
			auth: 'none',
			requestBody: {
				description: 'Credentials',
				example: `{\n  "email": "editor@example.com",\n  "password": "your-password"\n}`,
			},
			response: {
				description: 'Signed JWT token',
				example: `{ "token": "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJ..." }`,
			},
		},
	],
};

const apiSchemasGroup: EndpointGroup = {
	id: 'api-schemas',
	label: 'API · Content types',
	description: 'Read-only content type discovery for API consumers. Useful for dynamic form generation.',
	server: 'api',
	baseUrl: '/api/v1',
	endpoints: [
		{
			method: 'GET',
			path: '/api/v1/schemas',
			summary: 'List content types',
			auth: 'bearer',
			response: {
				description: 'Array of content type definitions',
				example: `[{ "name": "posts", "display_name": "Posts", "fields": [...] }]`,
			},
		},
		{
			method: 'GET',
			path: '/api/v1/schemas/{name}',
			summary: 'Get content type',
			auth: 'bearer',
			params: [{ name: 'name', in: 'path', type: 'string', required: true, description: 'Content type identifier' }],
			response: {
				description: 'Single content type definition',
				example: `{ "name": "posts", "display_name": "Posts", "fields": [...] }`,
			},
		},
	],
};

// The content API is one generic route family: the collection name is a path
// parameter the engine resolves per request, so it is documented once. The
// loader states the count of collections from the engine's document, never
// their names.
const base = '/api/v1/content/{schema}';
const schemaParam: EndpointParam = {
	name: 'schema',
	in: 'path',
	type: 'string',
	required: true,
	description: 'Content type name, as listed by GET /api/v1/schemas.',
};
const idParam: EndpointParam = {
	name: 'id',
	in: 'path',
	type: 'uuid',
	required: true,
	description: 'Content item ID',
};
const apiContentGroup: EndpointGroup = {
	id: 'api-content',
	label: 'API · Content',
	description:
		'Create, read, update and delete records in any content type. Only an editor, an admin or a super admin can write.',
	server: 'api',
	baseUrl: '/api/v1',
	endpoints: [
		{
			method: 'GET',
			path: base,
			summary: 'List content',
			auth: 'bearer',
			params: [
				schemaParam,
				{ name: 'limit', in: 'query', type: 'number', required: false, description: 'Max records to return (default 25)' },
				{ name: 'offset', in: 'query', type: 'number', required: false, description: 'Pagination offset (default 0)' },
			],
			response: {
				description: 'Paginated array of content items',
				example: `[\n  {\n    "id": "uuid",\n    "schema_name": "posts",\n    "data": { ... },\n    "created_at": "2026-01-01T00:00:00Z",\n    "updated_at": "2026-01-01T00:00:00Z"\n  }\n]`,
			},
		},
		{
			method: 'GET',
			path: `${base}/{id}`,
			summary: 'Get content item',
			auth: 'bearer',
			params: [schemaParam, idParam],
			response: {
				description: 'Single content item',
				example: `{\n  "id": "uuid",\n  "schema_name": "posts",\n  "data": { ... },\n  "created_at": "2026-01-01T00:00:00Z"\n}`,
			},
		},
		{
			method: 'POST',
			path: base,
			summary: 'Create content',
			auth: 'bearer',
			roles: ['editor', 'admin', 'super_admin'],
			params: [schemaParam],
			requestBody: {
				description: 'Field values wrapped in a data object',
				example: `{\n  "data": {\n    "title": "My first post",\n    "published": false\n  }\n}`,
			},
			response: {
				description: 'Created content item',
				example: `{\n  "id": "uuid",\n  "schema_name": "posts",\n  "data": { ... },\n  "created_at": "2026-01-01T00:00:00Z"\n}`,
			},
		},
		{
			method: 'PUT',
			path: `${base}/{id}`,
			summary: 'Update content',
			auth: 'bearer',
			roles: ['editor', 'admin', 'super_admin'],
			params: [schemaParam, idParam],
			requestBody: {
				description: 'Partial or full field values',
				example: `{\n  "data": {\n    "published": true\n  }\n}`,
			},
			response: {
				description: 'Updated content item',
				example: `{\n  "id": "uuid",\n  "schema_name": "posts",\n  "data": { ... }\n}`,
			},
		},
		{
			method: 'DELETE',
			path: `${base}/{id}`,
			summary: 'Delete content',
			auth: 'bearer',
			roles: ['editor', 'admin', 'super_admin'],
			params: [schemaParam, idParam],
			response: { description: 'Empty 204 response.', example: '' },
		},
	],
};

const apiJwksGroup: EndpointGroup = {
	id: 'api-jwks',
	label: 'API · JWKS',
	description: 'JSON Web Key Set for verifying the EdDSA (Ed25519) tokens the engine issues.',
	server: 'api',
	baseUrl: '/.well-known',
	endpoints: [
		{
			method: 'GET',
			path: '/.well-known/jwks.json',
			summary: 'Public JWKS',
			description: 'Returns the public key set used to verify JWT signatures. Clients should fetch this periodically to validate tokens without a shared secret.',
			auth: 'none',
			response: {
				description: 'RFC 7517 JWKS document',
				example: `{ "keys": [{ "kty": "OKP", "crv": "Ed25519", "x": "...", "use": "sig", "kid": "..." }] }`,
			},
		},
	],
};

/** Static groups shown even when no schemas are loaded. */
export const staticGroups: EndpointGroup[] = [
	adminAuthGroup,
	adminSchemasGroup,
	adminUsersGroup,
	adminMigrateGroup,
	adminWebhooksGroup,
	adminDeadLettersGroup,
	adminSystemGroup,
	apiAuthGroup,
	apiSchemasGroup,
	apiContentGroup,
	apiJwksGroup,
];
