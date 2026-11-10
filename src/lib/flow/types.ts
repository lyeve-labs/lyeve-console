/**
 * The flow definition as the engine stores and exports it, and the catalog
 * entry that describes a node type.
 *
 * JSON is canonical and YAML is the same tree. Positions are part of the
 * definition so an export re-imports as drawn, which is why the canvas never
 * keeps them anywhere else.
 */

export interface Position {
	x: number;
	y: number;
}

export interface FlowNode {
	/** `[a-z][a-z0-9_]{0,39}`, unique within the flow. */
	id: string;
	type: string;
	name?: string;
	position: Position;
	config: Record<string, unknown>;
}

export interface FlowEdge {
	from: string;
	to: string;
	/** Defaults to `out`. */
	from_port?: string;
	/** Defaults to `in`. */
	to_port?: string;
}

export interface FlowNote {
	id: string;
	text: string;
	position: Position;
	width?: number;
	height?: number;
}

export interface FlowTrigger {
	type: string;
	config: Record<string, unknown>;
	/** Where a person put the trigger card. Absent, the editor places it. */
	position?: Position;
}

export interface FlowSettings {
	timeout: string;
	step_timeout: string;
	max_steps: number;
	on_error: 'stop' | 'continue';
}

/**
 * Draft, active and disabled are the states an editor sets. Blocked is the
 * engine's: a published flow whose version names a node type no started
 * plugin contributes any more. Nothing serves or fires it, and it comes back
 * to active on its own when the type does.
 */
export type FlowStatus = 'draft' | 'active' | 'disabled' | 'blocked';

export interface FlowDefinition {
	version: 1;
	name: string;
	slug: string;
	description?: string;
	status?: FlowStatus;
	trigger: FlowTrigger;
	settings: FlowSettings;
	nodes: FlowNode[];
	edges: FlowEdge[];
	notes?: FlowNote[];
}

export interface Port {
	name: string;
	label?: string;
	/** Several edges may land here. The node receives a list. */
	multiple?: boolean;
}

export type NodeCategory = 'trigger' | 'data' | 'transform' | 'control' | 'output';

/** One catalog entry, as `GET /api/admin/flows/catalog` sends it. */
export interface NodeSpec {
	type: string;
	category: NodeCategory | string;
	label: string;
	description: string;
	/** An engine that has nothing to list may send null in place of an empty list. */
	inputs: Port[] | null;
	outputs: Port[] | null;
	/** JSON Schema 2020-12 with `additionalProperties: false`. */
	config_schema: JsonSchema;
	example: Record<string, unknown>;
	side_effects: boolean;
	trigger: boolean;
	/**
	 * The plugin that contributed the type. Absent on every built-in. The
	 * catalog lists contributed types after the built-ins, and the palette
	 * gives each contributing plugin a section of its own. `category` carries
	 * the same name on those specs.
	 */
	plugin?: string;
	/**
	 * Whether this instance may use the type, as the flow plugin says. A type
	 * it may not use is still offered, so a reader can build with it and read
	 * the refusal that names it. The marker is what says so before they try.
	 * A type without the flag reads as usable.
	 */
	enabled?: boolean;
}

/**
 * What a page renders for a 402 the flow plugin answered: the node ids it
 * named, or the ceiling on flows with the count already held. Both numbers
 * are the plugin's, so a page never holds a ceiling of its own.
 */
export interface RefusalNotice {
	nodeIds: string[];
	/** The most flows this instance keeps, when the refusal was the ceiling. */
	limit: number | null;
	/** How many flows there are already, when the plugin said. */
	current: number | null;
	/** Where a license allowing more is bought, when the plugin named it. Empty otherwise. */
	upgradeUrl: string;
}

/** Whether the flow plugin says this instance may not use a type. */
export function isLocked(spec: NodeSpec | undefined): boolean {
	return spec?.enabled === false;
}

/** The subset of JSON Schema the inspector renders. */
export interface JsonSchema {
	type?: string | string[];
	title?: string;
	description?: string;
	enum?: unknown[];
	properties?: Record<string, JsonSchema>;
	required?: string[];
	items?: JsonSchema;
	additionalProperties?: boolean | JsonSchema;
	default?: unknown;
	minimum?: number;
	maximum?: number;
	'x-expression'?: boolean;
	/** Where a picker's rows come from: the tenant's content schemas, their fields, the datasources, the published flows or the event types. */
	'x-source'?: SourceHint;
	/** The same, for the keys of a map. */
	'x-keys-source'?: SourceHint;
	/** Datasource kinds a datasource picker offers. */
	'x-kinds'?: string[];
	/** A code editor, or the grid for a table typed in place. */
	'x-editor'?: 'code' | 'grid';
	/** The language of a code editor, or `$key` for the sibling whose value holds it. */
	'x-language'?: string;
	/** False beside an option the flow plugin locks on this instance: it stays at its default, and setting it is refused on save. */
	'x-enabled'?: boolean;
	[key: string]: unknown;
}

export type SourceHint = 'content-schemas' | 'content-fields' | 'datasources' | 'flows' | 'event-types';

/** A content schema as the pickers need it: its name and the names of its fields. */
export interface SchemaOption {
	name: string;
	display_name: string;
	fields: string[];
	/** Why the "Fill fields with AI" node never fills a field, by field name. */
	unfillable?: Record<string, string>;
}

/** A datasource as the pickers need it. The config stores the name. Introspection takes the id. */
export interface DatasourceOption {
	id: string;
	name: string;
	kind: string;
}

/** A published flow as the flow picker needs it. The config stores the slug. */
export interface FlowOption {
	id: string;
	slug: string;
	name: string;
}

/** A hook a plugin publishes, as `GET /api/admin/flows/event-types` lists it. */
export interface SystemEvent {
	name: string;
	plugin: string;
	description: string;
}

/** What the event-types route answers: the content events and the system hooks of the started plugins. */
export interface EventTypes {
	content: string[];
	system: SystemEvent[];
}

/** The id the compiler gives the synthesized trigger node. */
export const TRIGGER_ID = 'trigger';

export const DEFAULT_OUT_PORT = 'out';
export const DEFAULT_IN_PORT = 'in';

export type Selection = { kind: 'node' | 'edge' | 'note'; id: string } | null;

export const DEFAULT_SETTINGS: FlowSettings = {
	timeout: '10s',
	step_timeout: '5s',
	max_steps: 200,
	on_error: 'stop',
};

/** A blank draft, the shape "New flow" starts from. */
export function emptyDefinition(name: string, slug: string): FlowDefinition {
	return {
		version: 1,
		name,
		slug,
		trigger: { type: 'trigger.http', config: { method: 'GET', auth: 'auth' } },
		settings: { ...DEFAULT_SETTINGS },
		nodes: [],
		edges: [],
		notes: [],
	};
}
