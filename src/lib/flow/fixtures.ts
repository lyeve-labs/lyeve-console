/**
 * Fixtures shared by every flow test: a three-node join flow and the slice of
 * the catalog it needs. The shapes follow the wire, so a test that passes
 * here passes against the catalog the engine serves.
 */

import type { DatasourceOption, EventTypes, FlowDefinition, FlowOption, NodeSpec, SchemaOption } from './types';
import type { Flow, FlowRun, FlowTemplate, Introspection, ValidationError } from '$lib/api/flows';

export const fixtureCatalog: NodeSpec[] = [
	{
		type: 'trigger.http',
		category: 'trigger',
		label: 'HTTP request',
		description: 'Starts the flow when a request reaches the flow URL.',
		inputs: [],
		outputs: [],
		config_schema: {
			type: 'object',
			additionalProperties: false,
			properties: {
				method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE', 'ANY'] },
				auth: { type: 'string', enum: ['public', 'auth', 'admin'] },
				body_limit: { type: 'integer', minimum: 1 },
			},
			required: ['method', 'auth'],
		},
		example: { method: 'GET', auth: 'auth' },
		side_effects: false,
		trigger: true,
		enabled: true,
	},
	{
		type: 'trigger.cron',
		category: 'trigger',
		label: 'Schedule',
		description: 'Starts the flow on a cron schedule.',
		inputs: [],
		outputs: [],
		config_schema: {
			type: 'object',
			additionalProperties: false,
			properties: {
				schedule: { type: 'string' },
				timezone: { type: 'string' },
			},
			required: ['schedule'],
		},
		example: { schedule: '0 2 * * *', timezone: 'UTC' },
		side_effects: false,
		trigger: true,
		enabled: true,
	},
	{
		type: 'trigger.event',
		category: 'trigger',
		label: 'Event',
		description: 'Starts the flow when a record changes or when a plugin publishes a hook.',
		inputs: [],
		outputs: [],
		config_schema: {
			type: 'object',
			additionalProperties: false,
			properties: {
				kind: { type: 'string', enum: ['content', 'system'], default: 'content', description: 'A content change, or a hook a plugin publishes.' },
				schema: { type: 'string', description: 'Content type name, or * for every content type.', 'x-source': 'content-schemas' },
				event: { type: 'string', enum: ['after_create', 'after_update', 'after_delete'], description: 'Which change starts the flow.' },
				name: { type: 'string', title: 'Hook', description: 'The hook name a plugin publishes.', 'x-source': 'event-types' },
				filter: { type: 'string', description: 'Only start the run when this is true.', 'x-expression': true },
			},
			required: [],
		},
		example: { kind: 'content', schema: 'customers', event: 'after_create' },
		side_effects: false,
		trigger: true,
		enabled: true,
	},
	{
		type: 'flow.call',
		category: 'control',
		label: 'Call a flow',
		description: 'Runs a published flow of this tenant and waits for its output.',
		inputs: [{ name: 'in' }],
		outputs: [{ name: 'out' }],
		config_schema: {
			type: 'object',
			additionalProperties: false,
			properties: {
				flow: { type: 'string', title: 'Flow', description: 'The slug of a published flow.', 'x-source': 'flows' },
				input: { type: 'object', description: 'Becomes trigger.body in the called flow.' },
				wait: { type: 'boolean', default: true },
			},
			required: ['flow'],
		},
		example: { flow: 'send-receipt', wait: true },
		side_effects: true,
		trigger: false,
	},
	{
		type: 'content.query',
		category: 'data',
		label: 'Query content',
		description: 'Lists rows of a content schema in this tenant, with relations populated.',
		inputs: [{ name: 'in' }],
		outputs: [{ name: 'out' }],
		config_schema: {
			type: 'object',
			additionalProperties: false,
			properties: {
				schema: { type: 'string', 'x-source': 'content-schemas' },
				filters: {
					type: 'object',
					additionalProperties: { type: 'string' },
					'x-keys-source': 'content-fields',
				},
				populate: { type: 'array', items: { type: 'string' }, 'x-source': 'content-fields' },
				limit: { type: 'integer', minimum: 1, maximum: 1000 },
				sort: { type: 'string', 'x-source': 'content-fields' },
			},
			required: ['schema'],
		},
		example: { schema: 'orders', limit: 100 },
		side_effects: false,
		trigger: false,
	},
	{
		type: 'db.query',
		category: 'data',
		label: 'SQL query',
		description: 'Runs a query against an external SQL datasource.',
		inputs: [{ name: 'in' }],
		outputs: [{ name: 'out' }],
		config_schema: {
			type: 'object',
			additionalProperties: false,
			properties: {
				datasource: { type: 'string', 'x-source': 'datasources', 'x-kinds': ['postgres', 'mysql', 'mssql'] },
				sql: { type: 'string', 'x-editor': 'code', 'x-language': 'sql' },
				params: { type: 'array', items: { type: 'string' } },
			},
			required: ['datasource', 'sql'],
		},
		example: { datasource: 'warehouse', sql: 'select * from orders where id = $1', params: ['{{ trigger.params.id }}'] },
		side_effects: true,
		trigger: false,
		enabled: true,
	},
	{
		type: 'data.inline',
		category: 'data',
		label: 'Inline data',
		description: 'Data typed in place: JSON, YAML, CSV, plain text or a small table.',
		inputs: [{ name: 'in' }],
		outputs: [{ name: 'out' }],
		config_schema: {
			type: 'object',
			additionalProperties: false,
			properties: {
				format: { type: 'string', enum: ['json', 'yaml', 'csv', 'text', 'table'] },
				content: { type: 'string', 'x-editor': 'code', 'x-language': '$format' },
				header: { type: 'boolean', default: true },
				columns: { type: 'array', items: { type: 'string' }, 'x-editor': 'grid' },
				rows: { type: 'array', items: { type: 'array', items: { type: 'string' } }, 'x-editor': 'grid' },
			},
			required: ['format'],
		},
		example: { format: 'json', content: '[{"id": 1}]' },
		side_effects: false,
		trigger: false,
	},
	{
		type: 'data.join',
		category: 'transform',
		label: 'Join',
		description: 'Joins the left list to the right list on a key.',
		inputs: [
			{ name: 'left', label: 'left' },
			{ name: 'right', label: 'right' },
		],
		outputs: [{ name: 'out' }],
		config_schema: {
			type: 'object',
			additionalProperties: false,
			properties: {
				left_key: { type: 'string' },
				right_key: { type: 'string' },
				how: { type: 'string', enum: ['inner', 'left'] },
				as: { type: 'string' },
				many: { type: 'boolean' },
			},
			required: ['left_key', 'right_key'],
		},
		example: { left_key: 'id', right_key: 'order_id', how: 'left', as: 'items', many: true },
		side_effects: false,
		trigger: false,
		enabled: true,
	},
	{
		type: 'control.condition',
		category: 'control',
		label: 'Condition',
		description: 'Routes the input down the true or the false branch.',
		inputs: [{ name: 'in' }],
		outputs: [{ name: 'true' }, { name: 'false' }],
		config_schema: {
			type: 'object',
			additionalProperties: false,
			properties: { expression: { type: 'string', 'x-expression': true } },
			required: ['expression'],
		},
		example: { expression: '{{ len(input) > 0 }}' },
		side_effects: false,
		trigger: false,
	},
	{
		type: 'response',
		category: 'output',
		label: 'Respond',
		description: 'Ends an HTTP run with this status and body.',
		inputs: [{ name: 'in', multiple: true }],
		// The engine sends null for a port list it has nothing to put in.
		outputs: null,
		config_schema: {
			type: 'object',
			additionalProperties: false,
			properties: {
				status: { type: 'integer' },
				headers: { type: 'object', additionalProperties: { type: 'string' } },
				body: { type: 'string', 'x-expression': true },
			},
		},
		example: { status: 200, body: '{{ input }}' },
		side_effects: false,
		trigger: false,
	},
	{
		type: 'note',
		category: 'output',
		label: 'Note',
		description: 'A sticky note on the canvas. It never runs.',
		inputs: null,
		outputs: null,
		config_schema: { type: 'object', additionalProperties: false, properties: {} },
		example: {},
		side_effects: false,
		trigger: false,
	},
	// Contributed by a plugin: listed after the built-ins, the plugin's name
	// as the category, the type prefixed with it. The two nodes are the email
	// plugin's. The bounce trigger is a stand-in for a contributed trigger.
	{
		type: 'email.render',
		category: 'email',
		label: 'Render template',
		description: 'Renders an email template with the input as its data.',
		inputs: [{ name: 'in' }],
		outputs: [{ name: 'out' }],
		config_schema: {
			type: 'object',
			additionalProperties: false,
			required: ['template'],
			properties: { template: { type: 'string', title: 'Template' } },
		},
		example: { template: 'welcome' },
		side_effects: false,
		trigger: false,
		plugin: 'email',
	},
	{
		type: 'email.send_template',
		category: 'email',
		label: 'Send email',
		description: 'Sends the rendered email to the recipients in the input.',
		inputs: [{ name: 'in' }],
		outputs: [{ name: 'out' }],
		config_schema: {
			type: 'object',
			additionalProperties: false,
			properties: { from: { type: 'string', title: 'From' } },
		},
		example: { from: 'noreply@example.com' },
		side_effects: true,
		trigger: false,
		plugin: 'email',
	},
	{
		type: 'email.bounced',
		category: 'email',
		label: 'Email bounced',
		description: 'Starts the flow when a sent email bounces.',
		inputs: null,
		outputs: [{ name: 'out' }],
		config_schema: {
			type: 'object',
			additionalProperties: false,
			properties: { template: { type: 'string', title: 'Template', description: 'Only bounces of this template; empty for every template.' } },
		},
		example: { template: 'welcome' },
		side_effects: false,
		trigger: true,
		plugin: 'email',
	},
];

/** The built-in slice alone, for a palette with nothing contributed. */
export const builtinCatalog: NodeSpec[] = fixtureCatalog.filter((s) => s.plugin === undefined);

export const fixtureSchemas: SchemaOption[] = [
	{ name: 'orders', display_name: 'Orders', fields: ['total', 'customer', 'status'] },
	{ name: 'shipments', display_name: 'Shipments', fields: ['order_id', 'carrier'] },
];

export const fixtureDatasources: DatasourceOption[] = [
	{ id: 'd1', name: 'warehouse', kind: 'postgres' },
	{ id: 'd2', name: 'inventory', kind: 'http' },
];

export const fixtureIntrospection: Introspection = {
	tables: [
		{
			name: 'public.orders',
			columns: [
				{ name: 'id', type: 'uuid' },
				{ name: 'total', type: 'numeric' },
			],
		},
		{ name: 'public.customers', columns: [{ name: 'id', type: 'uuid' }] },
	],
};

export const joinFlow: FlowDefinition = {
	version: 1,
	name: 'Orders with shipments',
	slug: 'orders_with_shipments',
	description: 'Joins orders to their shipments.',
	status: 'draft',
	trigger: { type: 'trigger.http', config: { method: 'GET', auth: 'auth' } },
	settings: { timeout: '10s', step_timeout: '5s', max_steps: 200, on_error: 'stop' },
	nodes: [
		{
			id: 'orders',
			type: 'content.query',
			name: 'Load orders',
			position: { x: 120, y: 200 },
			config: { schema: 'orders', populate: ['customer'], limit: 100, sort: '-created_at' },
		},
		{
			id: 'shipments',
			type: 'content.query',
			name: 'Load shipments',
			position: { x: 120, y: 420 },
			config: { schema: 'shipments' },
		},
		{
			id: 'join',
			type: 'data.join',
			name: 'Join',
			position: { x: 420, y: 300 },
			config: { left_key: 'id', right_key: 'order_id', how: 'left', as: 'shipments', many: true },
		},
	],
	edges: [
		{ from: 'orders', to: 'join', to_port: 'left' },
		{ from: 'shipments', to: 'join', to_port: 'right' },
	],
	notes: [{ id: 'n1', text: 'Cached 30s per customer', position: { x: 700, y: 120 }, width: 220 }],
};

/** The join flow answered by a response node, whose spec lists no outputs. */
export const respondingFlow: FlowDefinition = {
	...joinFlow,
	nodes: [
		...joinFlow.nodes,
		{
			id: 'respond',
			type: 'response',
			name: 'Respond',
			position: { x: 720, y: 300 },
			config: { status: 200, body: '{{ input }}' },
		},
	],
	edges: [...joinFlow.edges, { from: 'join', to: 'respond' }],
};

export const fixtureFlow: Flow = {
	id: 'f1',
	slug: joinFlow.slug,
	name: joinFlow.name,
	description: joinFlow.description ?? '',
	status: 'draft',
	version: 0,
	draft: joinFlow,
	trigger_type: 'trigger.http',
	created_by: 'u1',
	created_at: '2026-09-01T00:00:00Z',
	updated_at: '2026-09-10T00:00:00Z',
	last_run: null,
};

/**
 * A published flow the engine blocked: its version names a contributed type
 * whose plugin is no longer started. The draft is the same definition, so
 * the editor's validation and a save both meet the 422 below.
 */
export const blockedFlow: Flow = {
	...fixtureFlow,
	id: 'f3',
	slug: 'welcome_mail',
	name: 'Welcome mail',
	status: 'blocked',
	version: 2,
	trigger_type: 'trigger.event',
	draft: {
		...joinFlow,
		slug: 'welcome_mail',
		name: 'Welcome mail',
		status: 'blocked',
		trigger: { type: 'trigger.event', config: { kind: 'content', schema: 'orders', event: 'created' } },
		nodes: [
			{ id: 'render', type: 'email.render', position: { x: 80, y: 80 }, config: { template: 'welcome' } },
			{ id: 'respond', type: 'respond', position: { x: 320, y: 80 }, config: { status: 200, body: '{{ input }}' } },
		],
		edges: [{ from: 'render', to: 'respond' }],
	},
};

/** The 422 body of a save, publish or test of a definition naming a type no started plugin contributes. */
export const missingTypeErrors: ValidationError[] = [
	{
		node_id: 'render',
		path: '/type',
		message:
			'node type "email.render" is not available on this engine; it needs the email plugin, which is not started',
	},
];

/** The 422 body of a run of a blocked flow. */
export const blockedRunError = { error: 'flow is blocked: a node type it uses is not available on this engine' };

export const fixtureRun: FlowRun = {
	id: 'r1',
	flow_id: 'f1',
	version: 0,
	trigger_type: 'trigger.http',
	status: 'failed',
	is_test: true,
	input: { method: 'GET' },
	output: null,
	error: 'join: right_key missing on 3 rows',
	started_at: '2026-09-12T10:00:00Z',
	finished_at: '2026-09-12T10:00:01Z',
	duration_ms: 812,
	steps: [
		{
			id: 's1',
			node_id: 'orders',
			node_type: 'content.query',
			status: 'succeeded',
			attempt: 1,
			dry_run: false,
			input: { method: 'GET' },
			output: [{ id: 'o1', total: 12 }],
			error: '',
			started_at: '2026-09-12T10:00:00Z',
			finished_at: '2026-09-12T10:00:00.300Z',
			duration_ms: 300,
		},
		{
			id: 's2',
			node_id: 'shipments',
			node_type: 'content.query',
			status: 'succeeded',
			attempt: 1,
			dry_run: false,
			input: { method: 'GET' },
			output: [{ id: 'sh1', order_id: 'o1' }],
			error: '',
			started_at: '2026-09-12T10:00:00Z',
			finished_at: '2026-09-12T10:00:00.200Z',
			duration_ms: 200,
		},
		{
			id: 's3',
			node_id: 'join',
			node_type: 'data.join',
			status: 'failed',
			attempt: 1,
			dry_run: false,
			input: { left: [{ id: 'o1' }], right: [{ id: 'sh1' }] },
			output: null,
			error: 'right_key missing on 3 rows',
			started_at: '2026-09-12T10:00:00.400Z',
			finished_at: '2026-09-12T10:00:00.700Z',
			duration_ms: 300,
		},
	],
};

/** The catalog as an instance serves it when the flow plugin says the named types are not enabled there. */
export function withLocked(catalog: NodeSpec[], types: string[]): NodeSpec[] {
	return catalog.map((s) => (types.includes(s.type) ? { ...s, enabled: false } : s));
}

export const fixtureTemplates: FlowTemplate[] = [
	{
		id: 'join-three-tables-api',
		name: 'Join three tables into one API',
		description: 'Orders, customers and shipments in one cached, rate-limited GET.',
		definition: joinFlow,
	},
	{
		id: 'nightly-sheet-export',
		name: 'Nightly sheet export',
		description: 'Query a schema at 02:00 and append the rows to a Google Sheet.',
		definition: { ...joinFlow, name: 'Nightly sheet export', slug: 'nightly_sheet_export' },
	},
	{
		id: 'enrich-on-create',
		name: 'Enrich on create',
		description: 'Look a new record up over HTTP and write the answer back.',
		definition: { ...joinFlow, name: 'Enrich on create', slug: 'enrich_on_create' },
	},
];

/**
 * What the event-types route answers on an engine with the flow plugin
 * started: the content lifecycle, and the one hook a plugin publishes beyond
 * it.
 */
export const fixtureEventTypes: EventTypes = {
	content: ['after_create', 'after_update', 'after_delete'],
	system: [
		{ name: 'flow.run_failed', plugin: 'flow', description: 'A flow run ended failed.' },
	],
};

/**
 * Two publishers, listed out of order, for the tests that group and sort.
 * The second is a stand-in for a plugin that publishes hooks of its own.
 */
export const fixtureGroupedEventTypes: EventTypes['system'] = [
	{ name: 'flow.run_failed', plugin: 'flow', description: 'A flow run ended failed.' },
	{ name: 'example.closed', plugin: 'example', description: 'An example record was closed.' },
	{ name: 'example.opened', plugin: 'example', description: 'An example record was opened.' },
];

/** The published flows a picker offers. */
export const fixtureFlowOptions: FlowOption[] = [
	{ id: 'f1', slug: 'join-orders', name: 'Join orders' },
	{ id: 'f2', slug: 'send-receipt', name: 'Send receipt' },
	{ id: 'f3', slug: 'nightly-sync', name: 'nightly-sync' },
];
