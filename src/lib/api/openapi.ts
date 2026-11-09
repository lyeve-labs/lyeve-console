/**
 * The API Reference is built from the engine's own OpenAPI documents,
 * GET /api/admin/openapi/public.json and /admin.json, which the engine tests
 * against its router in both directions. The hand-written catalog in reference.ts is laid over it
 * for prose: a summary or example written by a person beats the generated
 * one, but the set of routes is the engine's, so a route it adds appears here
 * on the next load and a route it drops disappears.
 *
 * The document expands the content API once per collection, so an instance
 * with two hundred collections serves a document with over a thousand
 * operations that differ only in the collection name. Those collapse back
 * into the one `{schema}` family the engine actually routes, and the page
 * states how many collections there are rather than naming them.
 */
import type { AuthRequirement, EndpointDoc, EndpointGroup, EndpointParam, HttpMethod } from './reference';
import { plural } from '$lib/format';

export interface OpenAPIParameter {
	name: string;
	in: 'path' | 'query' | 'header' | 'cookie';
	description?: string;
	required?: boolean;
	schema?: { type?: string; enum?: unknown[]; default?: unknown; format?: string };
}

export interface OpenAPIOperation {
	tags?: string[];
	summary?: string;
	description?: string;
	security?: Record<string, unknown[]>[];
	parameters?: OpenAPIParameter[];
	requestBody?: {
		required?: boolean;
		content?: Record<string, { schema?: { example?: unknown } }>;
	};
	responses?: Record<string, { description?: string }>;
}

export interface OpenAPIDocument {
	paths: Record<string, Record<string, OpenAPIOperation>>;
}

export interface ReferenceModel {
	groups: EndpointGroup[];
	/** Distinct collections the document expanded the content API for. */
	collections: number;
}

/** A parameter whose allowed values run longer than this renders collapsed. */
export const VALUES_SHOWN = 8;

const CONTENT_PREFIX = '/api/v1/content/';
const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

/**
 * Every collection-specific path folds onto the generic one the engine
 * routes. `/api/v1/content/posts/{id}/revisions` is `{schema}` family too.
 */
export function collapseContentPath(path: string): { path: string; collection: string | null } {
	if (!path.startsWith(CONTENT_PREFIX)) return { path, collection: null };
	const rest = path.slice(CONTENT_PREFIX.length);
	const [first, ...tail] = rest.split('/');
	if (!first || first === '{schema}') return { path, collection: null };
	return { path: CONTENT_PREFIX + ['{schema}', ...tail].join('/'), collection: first };
}

function authOf(security: OpenAPIOperation['security']): AuthRequirement {
	if (!security || security.length === 0) return 'none';
	const names = new Set(security.flatMap((s) => Object.keys(s)));
	const bearer = names.has('bearerAuth');
	const cookie = names.has('cookieAuth');
	if (bearer && cookie) return 'bearer-or-cookie';
	if (cookie) return 'cookie';
	return 'bearer';
}

function paramOf(p: OpenAPIParameter): EndpointParam {
	const values = Array.isArray(p.schema?.enum) ? p.schema!.enum!.map(String) : undefined;
	return {
		name: p.name,
		in: p.in === 'query' ? 'query' : 'path',
		type: p.schema?.format ?? p.schema?.type ?? 'string',
		required: p.required === true || p.in === 'path',
		description: p.description ?? '',
		...(values && values.length ? { values } : {}),
	};
}

function exampleOf(body: OpenAPIOperation['requestBody']): string | undefined {
	const example = body?.content?.['application/json']?.schema?.example;
	if (example === undefined) return undefined;
	return JSON.stringify(example, null, 2);
}

function groupIdOf(tag: string): string {
	return tag
		.toLowerCase()
		.replace(/\s*\/\s*/g, '-')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
}

/** The group a tag belongs to, or a new one shaped like the catalog's. */
function groupFor(tag: string, path: string, groups: Map<string, EndpointGroup>): EndpointGroup {
	const id = groupIdOf(tag);
	let g = groups.get(id);
	if (!g) {
		const api = path.startsWith('/api/v1/') || path.startsWith('/.well-known/');
		g = {
			id,
			// The catalog writes its labels as "Admin · Auth". The engine tags
			// "Admin / Auth". One spelling on the page.
			label: tag.replace(/\s*\/\s*/g, ' \u00b7 '),
			description: '',
			server: api ? 'api' : 'admin',
			baseUrl: api ? '/api/v1' : '/api/admin',
			endpoints: [],
		};
		groups.set(id, g);
	}
	return g;
}

/**
 * Lay the catalog's prose over an endpoint the engine documents. The
 * engine decides that the route exists and what it takes. A person's
 * summary, description, roles and examples are kept where they were written.
 */
/** The documented statuses, in code order. None when the document lists none. */
export function statusesOf(responses: OpenAPIOperation['responses']): EndpointDoc['statuses'] {
	const out = Object.entries(responses ?? {}).map(([code, r]) => ({ code, description: r?.description ?? '' }));
	if (out.length === 0) return undefined;
	return out.sort((a, b) => a.code.localeCompare(b.code));
}

function overlay(engine: EndpointDoc, written: EndpointDoc | undefined): EndpointDoc {
	if (!written) return engine;
	return {
		...engine,
		summary: written.summary || engine.summary,
		description: written.description ?? engine.description,
		roles: written.roles ?? engine.roles,
		requestBody: written.requestBody ?? engine.requestBody,
		response: written.response ?? engine.response,
		tags: written.tags ?? engine.tags,
		params: engine.params?.length
			? engine.params.map((p) => {
					const w = written.params?.find((x) => x.name === p.name && x.in === p.in);
					return w ? { ...p, description: w.description || p.description, type: w.type || p.type } : p;
				})
			: written.params,
	};
}

export function buildReference(doc: OpenAPIDocument, catalog: EndpointGroup[]): ReferenceModel {
	const written = new Map<string, { group: EndpointGroup; endpoint: EndpointDoc }>();
	for (const g of catalog) for (const e of g.endpoints) written.set(`${e.method} ${e.path}`, { group: g, endpoint: e });

	const groups = new Map<string, EndpointGroup>();
	const seen = new Set<string>();
	const collections = new Set<string>();

	for (const [rawPath, ops] of Object.entries(doc.paths ?? {})) {
		const { path, collection } = collapseContentPath(rawPath);
		if (collection) collections.add(collection);
		for (const [m, op] of Object.entries(ops)) {
			const method = m.toUpperCase() as HttpMethod;
			if (!METHODS.includes(method)) continue;
			const key = `${method} ${path}`;
			if (seen.has(key)) continue;
			seen.add(key);

			const prose = written.get(key);
			// A collapsed content route keeps the catalog's group so the page
			// reads "API · Content", not one tag per collection.
			const tag = collection ? (prose?.group.label ?? 'Content API / Content') : (op.tags?.[0] ?? 'Other');
			const group = prose ? groupFor(prose.group.label, path, groups) : groupFor(tag, path, groups);
			if (prose && !group.description) {
				group.description = prose.group.description;
				group.server = prose.group.server;
				group.baseUrl = prose.group.baseUrl;
			}
			const engine: EndpointDoc = {
				method,
				path,
				summary: op.summary ?? `${method} ${path}`,
				description: op.description,
				auth: authOf(op.security),
				params: op.parameters?.map(paramOf),
				requestBody: (() => {
					const example = exampleOf(op.requestBody);
					return example ? { description: 'Request body', example } : undefined;
				})(),
				statuses: statusesOf(op.responses),
			};
			group.endpoints.push(overlay(engine, prose?.endpoint));
		}
	}

	// The schema parameter names the size of the instance, never its
	// collections.
	const count = collections.size;
	for (const g of groups.values()) {
		for (const e of g.endpoints) {
			const p = e.params?.find((x) => x.name === 'schema' && x.in === 'path');
			if (p) {
				p.description = count
					? `Content type name. This engine has ${count} ${plural(count, 'content type')}. See the Schema builder.`
					: 'Content type name, as listed by GET /api/v1/schemas.';
				delete p.values;
			}
		}
	}

	// Catalog order first, so the groups keep the catalog's order. Engine
	// groups the catalog never named follow, admin before content. The
	// plugin groups come last, since they would otherwise sit between the
	// admin API and the content API.
	const order = new Map(catalog.map((g, i) => [groupIdOf(g.label), i]));
	const rank = (g: EndpointGroup) => {
		const known = order.get(groupIdOf(g.label));
		if (known !== undefined) return known;
		if (g.id.startsWith('plugin-')) return 2000;
		return g.server === 'admin' ? 1000 : 1001;
	};
	const ordered = [...groups.values()].sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label));
	return { groups: ordered, collections: count };
}
