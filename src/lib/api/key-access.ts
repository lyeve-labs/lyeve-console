import type { HttpClient } from '@lyeve-labs/client';
import { plural } from '$lib/format';

/**
 * What an API key may reach, as the create drawer builds it.
 *
 * A key's scopes are resource:action pairs, and a resource may name one thing
 * under it after a dot: `content.posts:read` reads the posts schema and no
 * other, `flows.order-sync:create` calls one flow endpoint. A scope on the
 * bare resource covers every name under it. The actions are read, create,
 * update and delete, and the engine also accepts `write` for create and
 * update together.
 *
 * The drawer lists what to grant from the engine's catalog of the routes a
 * key can call, so a plugin that adds a route appears here without a change
 * to the console.
 */

export type KeyAction = 'read' | 'create' | 'update' | 'delete';

export const KEY_ACTIONS: { value: KeyAction; label: string }[] = [
	{ value: 'read', label: 'Read' },
	{ value: 'create', label: 'Create' },
	{ value: 'update', label: 'Update' },
	{ value: 'delete', label: 'Delete' },
];

const ACTION_ORDER: string[] = KEY_ACTIONS.map((a) => a.value);

/** One route a key can call, as the engine's catalog lists it. */
export interface KeyScopeRoute {
	method: string;
	path: string;
	resource: string;
	/** A path parameter such as `{slug}`, a literal endpoint name, or absent. */
	name?: string;
	action: string;
	scope: string;
	owner: string;
	declared?: boolean;
}

export interface KeyScopeCatalog {
	actions: string[];
	routes: KeyScopeRoute[];
}

/**
 * The engine's catalog. A failed read rejects, and so does an answer without a
 * route list, because a catalog that cannot be read offers nothing and the
 * caller has to say so rather than offer fewer choices without a reason.
 */
export async function fetchKeyScopeCatalog(client: HttpClient): Promise<KeyScopeCatalog> {
	const c = await client.get<KeyScopeCatalog>('/api/admin/api-key-scopes');
	if (!c || !Array.isArray(c.routes)) throw new Error('The route catalog has no route list.');
	return c;
}

/** A resource other than content and the schema catalog, with its routes. */
export interface ResourceGroup {
	resource: string;
	label: string;
	actions: string[];
	routes: KeyScopeRoute[];
	/** The path parameter that names one thing under the resource, if a route has one. */
	nameParam: string | null;
}

/** The resources the drawer handles on its own rather than from the catalog. */
const BUILT_IN = new Set(['content', 'schemas', '*']);

/** Names a plain capitalization would misspell, and names a reader would not know. */
const LABELS: Record<string, string> = {
	gdpr: 'GDPR',
	graphql: 'GraphQL',
	grpc: 'gRPC',
	ai: 'AI',
	mcp: 'MCP',
	'openapi.json': 'API reference',
};

/**
 * The engine's OpenAPI document, which an AI agent's tool index reads. The
 * catalog lists only routes under /api/v1, and this one is under /api/admin,
 * so the drawer adds it here or a key could never be granted its scope.
 */
const API_REFERENCE_ROUTE: KeyScopeRoute = {
	method: 'GET',
	path: '/api/admin/openapi.json',
	resource: 'openapi.json',
	action: 'read',
	scope: 'openapi.json:read',
	owner: 'engine',
};

function titleOf(resource: string): string {
	if (LABELS[resource]) return LABELS[resource];
	const words = resource.replace(/[-_]+/g, ' ').trim();
	return words.charAt(0).toUpperCase() + words.slice(1);
}

function orderActions(actions: Iterable<string>): string[] {
	return [...new Set(actions)].sort((a, b) => {
		const ia = ACTION_ORDER.indexOf(a);
		const ib = ACTION_ORDER.indexOf(b);
		return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
	});
}

/** The catalog's routes grouped by resource in label order, content and schemas left out. */
export function groupCatalog(catalog: KeyScopeCatalog | null): ResourceGroup[] {
	if (!catalog) return [];
	const byResource = new Map<string, KeyScopeRoute[]>();
	const listed = catalog.routes.some((r) => r.scope === API_REFERENCE_ROUTE.scope);
	for (const r of listed ? catalog.routes : [...catalog.routes, API_REFERENCE_ROUTE]) {
		if (BUILT_IN.has(r.resource)) continue;
		const list = byResource.get(r.resource) ?? [];
		list.push(r);
		byResource.set(r.resource, list);
	}
	return [...byResource.entries()]
		.map(([resource, routes]) => ({
			resource,
			label: titleOf(resource),
			actions: orderActions(routes.map((r) => r.action)),
			routes,
			nameParam: routes.find((r) => !r.declared && r.name?.startsWith('{'))?.name ?? null,
		}))
		.sort((a, b) => a.label.localeCompare(b.label));
}

/** The access a key is being given, as the drawer holds it. */
export interface KeyAccess {
	/** Every schema, or only the ones in perSchema. */
	contentMode: 'all' | 'chosen';
	/** What the key may do on every schema, when contentMode is all. */
	contentActions: string[];
	/** What the key may do on each chosen schema. */
	perSchema: Record<string, string[]>;
	/** Read the schema catalog, so a client can discover the content types. */
	discoverSchemas: boolean;
	/** What the key may do on each other resource, and which names it is held to. */
	resources: Record<string, { actions: string[]; names: string }>;
}

/**
 * What a new key starts with: read every schema. Discovering the schemas is
 * left off, because its box sits in a folded section and a grant the reader
 * never saw is not one they chose.
 */
export function defaultAccess(): KeyAccess {
	return { contentMode: 'all', contentActions: ['read'], perSchema: {}, discoverSchemas: false, resources: {} };
}

/**
 * Route groups that read content across schemas without holding a key to
 * its chosen ones, so a key on chosen schemas reads every schema through
 * them. The drawer says so beside each.
 */
export const READS_EVERY_SCHEMA = new Set(['graphql']);

const NAME_RE = /^[a-z0-9_-]+$/;

/**
 * The names in a comma list that cannot be part of a scope, or '' when every
 * one can. A name is the path segment the key is held to, so letters,
 * digits, hyphens and underscores are all it may hold.
 */
export function namesProblem(raw: string): string {
	const bad = parseNames(raw).filter((n) => !NAME_RE.test(n));
	if (bad.length === 0) return '';
	return `${bad.map((n) => `"${n}"`).join(', ')} is not an endpoint name. Use only letters, digits, hyphens and underscores.`;
}

/** Names from a comma list: trimmed, each once, empty ones dropped. */
export function parseNames(raw: string): string[] {
	const out: string[] = [];
	for (const part of raw.split(',')) {
		const n = part.trim().toLowerCase();
		if (n && !out.includes(n)) out.push(n);
	}
	return out;
}

/** The schemas a chosen-mode key may reach, in name order. */
export function chosenSchemas(a: KeyAccess): string[] {
	return Object.keys(a.perSchema)
		.filter((s) => (a.perSchema[s] ?? []).length > 0)
		.sort();
}

/** Whether any route group's names cannot be part of a scope. */
export function accessProblem(a: KeyAccess): boolean {
	return Object.values(a.resources).some((r) => r.actions.length > 0 && namesProblem(r.names) !== '');
}

/** The scopes the access encodes, in a stable order. */
export function accessScopes(a: KeyAccess): string[] {
	const out: string[] = [];
	if (a.contentMode === 'all') {
		for (const act of orderActions(a.contentActions)) out.push(`content:${act}`);
	} else {
		for (const s of chosenSchemas(a)) {
			for (const act of orderActions(a.perSchema[s])) out.push(`content.${s}:${act}`);
		}
	}
	if (a.discoverSchemas) out.push('schemas:read');
	for (const resource of Object.keys(a.resources).sort()) {
		const { actions, names } = a.resources[resource];
		const list = parseNames(names);
		for (const act of orderActions(actions)) {
			if (list.length === 0) out.push(`${resource}:${act}`);
			else for (const n of list) out.push(`${resource}.${n}:${act}`);
		}
	}
	return [...new Set(out)];
}

/**
 * The schema list sent beside the scopes. A key held to chosen schemas sends
 * them, so the engine refuses every other schema on each route that reads
 * content, and not only on the ones a scope gates. A key on every schema
 * sends none, which the engine reads as all.
 */
export function accessSchemas(a: KeyAccess): string[] {
	return a.contentMode === 'chosen' ? chosenSchemas(a) : [];
}

/** A short summary of one section, for the badge on its fold. */
export function contentSummary(a: KeyAccess): string {
	if (a.contentMode === 'all') return a.contentActions.length ? `All content types: ${orderActions(a.contentActions).join(', ')}` : 'Off';
	const n = chosenSchemas(a).length;
	return n === 0 ? 'Off' : `${n} ${plural(n, 'content type')}`;
}

const SCOPE_RE = /^[a-z0-9_-]+(\.[a-z0-9_-]+)?:[a-z_-]+$/;

/**
 * Whether a scope is one the console issues: resource:action, the resource
 * optionally naming one thing. A wildcard is well formed to the engine, and
 * the console still never mints one: a key that reaches everything is a
 * decision for a script that names it, not a box ticked by accident.
 */
export function isValidScope(scope: string): boolean {
	return SCOPE_RE.test(scope);
}

/** The scopes a form sent, keeping the ones the console issues, lower-cased, once each. */
export function cleanScopes(raw: readonly string[]): string[] {
	const out: string[] = [];
	for (const s of raw) {
		const v = s.trim().toLowerCase();
		if (isValidScope(v) && !out.includes(v)) out.push(v);
	}
	return out;
}

/**
 * A key's scopes grouped for the list: one line per resource, its actions
 * joined. `content.posts: read, create` reads faster than four pairs.
 */
export function describeScopes(scopes: readonly string[]): string[] {
	const groups = new Map<string, string[]>();
	for (const s of scopes) {
		const i = s.lastIndexOf(':');
		if (i <= 0) continue;
		const resource = s.slice(0, i);
		const list = groups.get(resource) ?? [];
		list.push(s.slice(i + 1));
		groups.set(resource, list);
	}
	return [...groups.entries()].map(([resource, actions]) => `${resource}: ${orderActions(actions).join(', ')}`);
}
