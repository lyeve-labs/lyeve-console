/**
 * The flow plugin's admin endpoints.
 *
 * These take the client rather than `fetch` because the authenticated client
 * is where the session bearer token and the double-submit CSRF header are
 * joined. The two calls that carry a body the client cannot encode (a YAML
 * export and a YAML import) take a `fetch` instead and say so.
 */

import { ApiError, type HttpClient } from '@lyeve-labs/client';
import { query, readAll, rowsOf, statedTotal, type ListEnvelope } from '$lib/api/list';
import type { EventTypes, FlowDefinition, FlowOption, FlowStatus, NodeSpec } from '$lib/flow/types';
import { count } from './narrow';

export interface LastRun {
	id: string;
	status: RunStatus;
	started_at: string;
	duration_ms: number;
}

export interface Flow {
	id: string;
	slug: string;
	name: string;
	description: string;
	status: FlowStatus;
	version: number;
	draft?: FlowDefinition;
	trigger_type: string;
	/**
	 * The event an event trigger starts on, null for any other trigger.
	 * Absent from a flow plugin too old to send it.
	 */
	trigger_event?: { kind: string; name: string; schema?: string } | null;
	created_by: string;
	created_at: string;
	updated_at: string;
	last_run: LastRun | null;
	/**
	 * The actions the caller's roles grant on this flow, a subset of read,
	 * update, delete and activate. Absent when the engine does not send it,
	 * which reads as all of them.
	 */
	actions?: string[];
}

export interface FlowVersion {
	flow_id: string;
	version: number;
	definition?: FlowDefinition;
	checksum: string;
	created_by: string;
	created_at: string;
}

export interface ValidationError {
	/** Absent for an error on the flow itself: its trigger, settings or edges. */
	node_id?: string;
	path: string;
	message: string;
}

export interface ValidationResult {
	ok: boolean;
	errors: ValidationError[];
}

export type RunStatus = 'running' | 'succeeded' | 'failed' | 'canceled';
export type StepStatus = 'succeeded' | 'failed' | 'skipped';

export interface RunStep {
	id: string;
	node_id: string;
	node_type: string;
	status: StepStatus;
	attempt: number;
	dry_run: boolean;
	input: unknown;
	output: unknown;
	error: string;
	started_at: string;
	finished_at: string;
	duration_ms: number;
}

export interface FlowRun {
	id: string;
	flow_id: string;
	version: number;
	trigger_type: string;
	status: RunStatus;
	is_test: boolean;
	input: unknown;
	output: unknown;
	error: string;
	started_at: string;
	finished_at: string;
	duration_ms: number;
	steps?: RunStep[];
	/**
	 * The reader's own access does not cover what the run read, so the run's
	 * input, output and error, and every step's, come back empty. The plugin
	 * omits the field when nothing was withheld.
	 */
	withheld?: boolean;
}

export interface TestRequest {
	trigger: unknown;
	definition?: FlowDefinition;
	live?: boolean;
	until_node?: string;
}

export interface FlowTemplate {
	id: string;
	name: string;
	description: string;
	definition: FlowDefinition;
	/** builtin ships with the binary. Saved is one this tenant kept. */
	source?: 'builtin' | 'saved';
	/** Where a saved template was read from, so it can be read again. */
	source_url?: string;
	/**
	 * Whether this instance may use the template, as the flow plugin says. It
	 * can still be put on the canvas, and saving it is refused with the node
	 * ids at fault. Absent when the plugin does not send it.
	 */
	enabled?: boolean;
}

export type DatasourceKind = 'postgres' | 'mysql' | 'mssql' | 'http' | 'google_sheets';

export interface Datasource {
	id: string;
	name: string;
	kind: DatasourceKind;
	config: Record<string, unknown>;
	has_secret: boolean;
	allow_writes: boolean;
	allow_private: boolean;
	created_at: string;
	updated_at: string;
}

export interface DatasourceBody {
	name: string;
	kind: DatasourceKind;
	config: Record<string, unknown>;
	secret?: Record<string, unknown>;
	allow_writes: boolean;
	allow_private: boolean;
}

export interface DatasourceTest {
	ok: boolean;
	latency_ms: number;
	error: string;
}

export interface Variable {
	key: string;
	value?: string;
	is_secret: boolean;
	updated_at: string;
}

export interface ImportResult extends Flow {
	unresolved_datasources?: string[];
}

export interface Page<T> {
	rows: T[];
	total: number | null;
}

/** The flow list, with whether the caller may create one. */
export interface FlowPage extends Page<Flow> {
	/** `can_create` beside the list. Absent reads as allowed. */
	canCreate: boolean;
}

const BASE = '/api/admin/flows';


export async function listFlows(
	client: HttpClient,
	params: { limit?: number; offset?: number; status?: string; q?: string } = {}
): Promise<FlowPage> {
	const res = await client.get<(ListEnvelope<Flow> & { can_create?: boolean }) | Flow[]>(`${BASE}${query(params)}`);
	const canCreate = !Array.isArray(res) && typeof res?.can_create === 'boolean' ? res.can_create : true;
	return { rows: rowsOf(res), total: statedTotal(res), canCreate };
}

/** The engine caps a page of flows at this many rows. */
const FLOW_PAGE = 200;

/**
 * Every published flow, for the flow picker, as pages of the list route up
 * to `cap` rows. A tenant past the cap still gets the picker's free-text
 * escape for the rest. The list is a convenience, the slug is the contract.
 */
export function listPublishedFlows(client: HttpClient, cap = 1000): Promise<FlowOption[]> {
	return listFlowOptions(client, 'active', cap);
}

/** Every flow in any status, for the permissions page's resource picker. */
export function listAllFlows(client: HttpClient, cap = 1000): Promise<FlowOption[]> {
	return listFlowOptions(client, '', cap);
}

async function listFlowOptions(client: HttpClient, status: string, cap: number): Promise<FlowOption[]> {
	const { rows } = await readAll(
		async (limit, offset) => ({ rows: (await listFlows(client, { limit, offset, status })).rows, total: null }),
		FLOW_PAGE,
		cap
	);
	return rows.slice(0, cap).map((f) => ({ id: f.id, slug: f.slug, name: f.name }));
}

export function getFlow(client: HttpClient, id: string): Promise<Flow> {
	return client.get<Flow>(`${BASE}/${encodeURIComponent(id)}`);
}

export function createFlow(
	client: HttpClient,
	body: { name: string; slug: string; definition?: FlowDefinition }
): Promise<Flow> {
	return client.post<Flow>(BASE, body);
}

export function saveDraft(
	client: HttpClient,
	id: string,
	body: { name: string; slug?: string; description?: string; definition: FlowDefinition }
): Promise<Flow> {
	return client.put<Flow>(`${BASE}/${encodeURIComponent(id)}`, body);
}

export async function deleteFlow(client: HttpClient, id: string): Promise<void> {
	await client.delete<void>(`${BASE}/${encodeURIComponent(id)}`);
}

export function publishFlow(client: HttpClient, id: string): Promise<Flow> {
	return client.post<Flow>(`${BASE}/${encodeURIComponent(id)}/publish`, undefined);
}

export function disableFlow(client: HttpClient, id: string): Promise<Flow> {
	return client.post<Flow>(`${BASE}/${encodeURIComponent(id)}/disable`, undefined);
}

export function rollbackFlow(client: HttpClient, id: string, version: number): Promise<Flow> {
	return client.post<Flow>(`${BASE}/${encodeURIComponent(id)}/rollback`, { version });
}

export async function listVersions(client: HttpClient, id: string): Promise<FlowVersion[]> {
	const res = await client.get<ListEnvelope<FlowVersion> | FlowVersion[]>(
		`${BASE}/${encodeURIComponent(id)}/versions`
	);
	return rowsOf(res);
}

export function validateFlow(
	client: HttpClient,
	id: string,
	definition: FlowDefinition
): Promise<ValidationResult> {
	return client.post<ValidationResult>(`${BASE}/${encodeURIComponent(id)}/validate`, definition);
}

export function testFlow(client: HttpClient, id: string, body: TestRequest): Promise<FlowRun> {
	return client.post<FlowRun>(`${BASE}/${encodeURIComponent(id)}/test`, body);
}

export async function listRuns(
	client: HttpClient,
	id: string,
	params: { limit?: number; offset?: number; status?: string; is_test?: string } = {}
): Promise<Page<FlowRun>> {
	const res = await client.get<ListEnvelope<FlowRun> | FlowRun[]>(
		`${BASE}/${encodeURIComponent(id)}/runs${query(params)}`
	);
	return { rows: rowsOf(res), total: statedTotal(res) };
}

export function getRun(client: HttpClient, runId: string): Promise<FlowRun> {
	return client.get<FlowRun>(`${BASE}/runs/${encodeURIComponent(runId)}`);
}

/**
 * The export as text. Takes `fetch` because the client decodes every body as
 * JSON and a YAML export is not one. Callers in the browser pass their own
 * fetch. The cookie session rides along on a same-origin GET.
 */
export async function exportFlow(
	fetchFn: typeof fetch,
	id: string,
	format: 'json' | 'yaml',
	headers: Record<string, string> = {}
): Promise<string> {
	const res = await fetchFn(`${BASE}/${encodeURIComponent(id)}/export?format=${format}`, { headers });
	if (!res.ok) throw new Error('Could not export the flow. Try again.');
	return res.text();
}

/** A pasted definition, or a file chosen in the browser. */
export type ImportBody =
	| { content: string; format: 'json' | 'yaml' | ''; mode: 'create' | 'replace'; slug?: string }
	| { file: File; mode: 'create' | 'replace'; slug?: string };

/**
 * Imports a definition. A paste goes up as a JSON envelope with the text and
 * its format, an empty format leaving the sniff to the engine. A file goes up
 * as multipart with one part named `file`, and the engine sniffs it. Takes
 * `fetch` because the authed client sends JSON only.
 */
export async function importFlow(
	fetchFn: typeof fetch,
	body: ImportBody,
	headers: Record<string, string> = {}
): Promise<ImportResult> {
	const init: RequestInit = { method: 'POST', headers: { ...headers } };
	if ('file' in body) {
		const form = new FormData();
		form.set('file', body.file, body.file.name);
		init.body = form;
	} else {
		init.headers = { ...headers, 'Content-Type': 'application/json' };
		init.body = JSON.stringify({ content: body.content, format: body.format });
	}
	const res = await fetchFn(`${BASE}/import${query({ mode: body.mode, slug: body.slug })}`, init);
	const text = await res.text();
	if (!res.ok) {
		const refusal = refusalOf(res.status, text);
		if (refusal) throw refusal;
		let message = text;
		let code = '';
		try {
			const json = JSON.parse(text) as { error?: string; code?: string };
			message = json.error ?? text;
			code = typeof json.code === 'string' ? json.code : '';
		} catch {
			// Not JSON: the text is the message.
		}
		throw new ImportError(res.status, message, text, code);
	}
	return JSON.parse(text) as ImportResult;
}

/**
 * An import refusal, carrying the raw body so a 422 can surface its error
 * list. `code` is the API error code, empty when something in front of the
 * engine answered.
 */
export class ImportError extends Error {
	readonly status: number;
	readonly body: string;
	readonly code: string;
	constructor(status: number, message: string, body: string, code = '') {
		super(message);
		this.name = 'ImportError';
		this.status = status;
		this.body = body;
		this.code = code;
	}
}

/**
 * The node catalog. Each spec says whether this instance may use it, and a
 * spec without the flag reads as usable.
 */
export async function getCatalog(client: HttpClient): Promise<NodeSpec[]> {
	const res = await client.get<ListEnvelope<NodeSpec> | NodeSpec[]>(`${BASE}/catalog`);
	return rowsOf(res);
}

/**
 * The event types a trigger can subscribe to. An engine without the route
 * answers 404, which the caller treats as an empty list: the name field
 * then takes free text, which it accepts anyway.
 */
export async function getEventTypes(client: HttpClient): Promise<EventTypes> {
	const res = await client.get<Partial<EventTypes> | null>(`${BASE}/event-types`);
	return {
		content: Array.isArray(res?.content) ? res.content.map(String) : [],
		system: Array.isArray(res?.system)
			? res.system
					.filter((e) => e && typeof e.name === 'string' && e.name)
					.map((e) => ({ name: e.name, plugin: String(e.plugin ?? ''), description: String(e.description ?? '') }))
			: [],
	};
}

export async function getTemplates(client: HttpClient): Promise<FlowTemplate[]> {
	const res = await client.get<ListEnvelope<FlowTemplate> | FlowTemplate[]>(`${BASE}/templates`);
	return rowsOf(res);
}

/** Keeps a template read from a URL, or from a pasted YAML or JSON definition. */
export function saveTemplate(client: HttpClient, from: { url: string } | { document: string }): Promise<FlowTemplate> {
	return client.post<FlowTemplate>(`${BASE}/templates`, from);
}

/** Removes a saved template. A built-in one is refused. */
export function deleteTemplate(client: HttpClient, id: string): Promise<void> {
	return client.delete<void>(`${BASE}/templates/${encodeURIComponent(id)}`);
}

/** The datasources, and whether this instance may use datasources at all. */
export interface DatasourceList {
	rows: Datasource[];
	/**
	 * Whether this instance may use datasources, as the flow plugin says.
	 * Without it the list is empty by design and every write is refused. A
	 * plugin that does not send the flag reads as enabled: the
	 * plugin still refuses what it does not allow, and the page relays that.
	 */
	enabled: boolean;
}

export async function listDatasources(client: HttpClient): Promise<DatasourceList> {
	const res = await client.get<(ListEnvelope<Datasource> & { enabled?: boolean }) | Datasource[]>(`${BASE}/datasources`);
	return { rows: rowsOf(res), enabled: Array.isArray(res) || res?.enabled !== false };
}

export function createDatasource(client: HttpClient, body: DatasourceBody): Promise<Datasource> {
	return client.post<Datasource>(`${BASE}/datasources`, body);
}

export function updateDatasource(
	client: HttpClient,
	id: string,
	body: DatasourceBody
): Promise<Datasource> {
	return client.put<Datasource>(`${BASE}/datasources/${encodeURIComponent(id)}`, body);
}

export async function deleteDatasource(client: HttpClient, id: string): Promise<void> {
	await client.delete<void>(`${BASE}/datasources/${encodeURIComponent(id)}`);
}

export function testDatasource(client: HttpClient, id: string): Promise<DatasourceTest> {
	return client.post<DatasourceTest>(`${BASE}/datasources/${encodeURIComponent(id)}/test`, undefined);
}

export interface IntrospectedColumn {
	name: string;
	type: string;
}

export interface IntrospectedTable {
	/** Schema-qualified where the dialect has schemas, such as public.orders. */
	name: string;
	columns: IntrospectedColumn[];
}

export interface Introspection {
	tables: IntrospectedTable[];
}

/**
 * The tables and columns of a SQL datasource, capped by the engine at 500
 * tables. A datasource of another kind answers 400, which the client throws.
 */
export async function introspectDatasource(client: HttpClient, id: string): Promise<Introspection> {
	const res = await client.get<Introspection>(`${BASE}/datasources/${encodeURIComponent(id)}/introspect`);
	return { tables: Array.isArray(res?.tables) ? res.tables : [] };
}

export async function listVariables(
	client: HttpClient,
	limit = 50,
	offset = 0
): Promise<ListEnvelope<Variable> | Variable[]> {
	return client.get<ListEnvelope<Variable> | Variable[]>(
		`${BASE}/variables?limit=${limit}&offset=${offset}`
	);
}

export function putVariable(
	client: HttpClient,
	body: { key: string; value: string; is_secret: boolean }
): Promise<Variable> {
	return client.put<Variable>(`${BASE}/variables`, body);
}

export async function deleteVariable(client: HttpClient, key: string): Promise<void> {
	await client.delete<void>(`${BASE}/variables/${encodeURIComponent(key)}`);
}

/**
 * A 402 the flow plugin answered. A definition that uses what this instance
 * does not enable arrives with the node ids at fault under `errors`, the key
 * a 422 uses, so the canvas can mark them the way it marks a validation
 * problem. `trigger` is the id of the trigger. The ceiling on flows arrives
 * with the limit and the count instead, so a page quotes the plugin's
 * numbers and holds none of its own, and with the link where more are
 * bought when the plugin names one.
 *
 * The body is read before the client sees the response, so every flow write
 * throws this one class whichever call made it. An ApiError still, so a
 * caller that only asks the status keeps its answer.
 */
export class FlowRefusal extends ApiError {
	readonly errors: ValidationError[];
	/** The most flows this instance keeps, when the refusal is the ceiling. Null otherwise. */
	readonly limit: number | null;
	/** How many flows there are already, when the ceiling refusal says. */
	readonly current: number | null;
	/** Where a license allowing more is bought, as the plugin sent it, or empty. */
	readonly upgradeUrl: string;
	constructor(errors: ValidationError[], limit: number | null = null, current: number | null = null, upgradeUrl = '') {
		super(402, 'payment_required');
		this.name = 'FlowRefusal';
		this.errors = errors;
		this.limit = limit;
		this.current = current;
		this.upgradeUrl = upgradeUrl;
	}

	/** The distinct node ids the errors name, in the order they were named. */
	get nodeIds(): string[] {
		return [...new Set(this.errors.map((e) => e.node_id).filter((id): id is string => typeof id === 'string' && id !== ''))];
	}
}

/** The refusal in a 402 body, or null for any other status. A body that is not JSON is a refusal that names nothing. */
export function refusalOf(status: number, text: string): FlowRefusal | null {
	if (status !== 402) return null;
	try {
		const body = JSON.parse(text) as { errors?: unknown; limit?: unknown; current?: unknown; upgrade_url?: unknown };
		const errors = Array.isArray(body.errors) ? (body.errors as ValidationError[]) : [];
		const upgradeUrl = typeof body.upgrade_url === 'string' ? body.upgrade_url.trim() : '';
		return new FlowRefusal(errors, count(body.limit), count(body.current), upgradeUrl);
	} catch {
		return new FlowRefusal([]);
	}
}

/** A fetch that turns a 402 into a FlowRefusal. Every other response passes through untouched. */
export function refusalAware(fetchFn: typeof fetch): typeof fetch {
	return async (input, init) => {
		const res = await fetchFn(input, init);
		if (res.status !== 402) return res;
		throw refusalOf(res.status, await res.text());
	};
}

/**
 * The error list out of a 422 body, when the message the client threw was one.
 *
 * The client keeps `error` from a JSON body and falls back to the whole text
 * otherwise. A validation refusal has no `error` key, so what reaches the
 * action is the JSON itself and the list is still in there.
 */
export function validationErrors(message: string): ValidationError[] {
	try {
		const body = JSON.parse(message) as Partial<ValidationResult>;
		return Array.isArray(body.errors) ? body.errors : [];
	} catch {
		return [];
	}
}
