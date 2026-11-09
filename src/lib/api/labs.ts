/**
 * The API labs: the executing half of the API reference.
 *
 * The reference page documents every endpoint and renders a curl line that is
 * explicitly a preview, not a client. A reader who wants to know what the API
 * actually answers has to leave the product, copy the line, find a token and
 * paste it into a terminal. The labs close that: pick a documented endpoint,
 * fill its parameters, send it, read the answer.
 *
 * Three protocols, because the instance speaks three and a tester has to be
 * able to reach each: REST over the admin and content routers, GraphQL at one
 * endpoint with a query and variables, and gRPC through the transcoded REST
 * paths its own listener serves.
 *
 * ## Why the request is built here and sent by the server
 *
 * The session is an HttpOnly `__Host-` cookie, so browser JavaScript cannot
 * attach it and must not be handed a token to attach instead. The send is a
 * form action, which already carries the caller's session, and the reply is
 * rendered from the action's result.
 *
 * ## Why a server that sends a request is dangerous, and what stops it
 *
 * A server-side sender that takes a URL is a request forgery primitive: the
 * caller names a host and the server, inside the network, fetches it. Nothing
 * here takes a host. A lab request names an endpoint **that the engine
 * documented**, and the path is rebuilt from that document by substituting
 * parameter values into its own template. An arbitrary path cannot be
 * expressed, so there is nothing to smuggle a host into.
 *
 * The caller's own session is used unchanged, so the engine's authorization
 * decides what the request may do. The labs add no capability: anything a
 * lab can send, its operator could already have sent with curl.
 */
import type { StatusTone } from '@lyeve-labs/ui-kit';
import type { EndpointDoc, EndpointGroup, HttpMethod } from './reference';
import { SESSION_ENDED } from '../session';

/** Methods that change something. Named so a page can say so before sending. */
const MUTATING: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function mutates(method: string): boolean {
	return MUTATING.has(method.toUpperCase());
}

/**
 * How much damage a method can do, for the warning a page shows.
 *
 * DELETE is apart from the rest because it is the only one whose result
 * cannot be inspected and undone by sending something else: a tester who
 * POSTs a bad record deletes it afterwards, and one who DELETEs the wrong
 * record is asking the backup for help.
 */
export type Risk = 'read' | 'write' | 'destructive';

export function riskOf(method: string): Risk {
	const m = method.toUpperCase();
	if (m === 'DELETE') return 'destructive';
	return mutates(m) ? 'write' : 'read';
}

export const RISK_LABELS: Readonly<Record<Risk, string>> = {
	read: 'Reads, changes nothing',
	write: 'Writes to this engine',
	destructive: 'Deletes from this engine',
};

export function riskTone(risk: Risk): StatusTone {
	if (risk === 'read') return 'success';
	return risk === 'write' ? 'warn' : 'danger';
}

/** One endpoint a lab can send, flattened out of the reference groups. */
export interface LabEndpoint {
	/** Stable across a reload, and what the form posts back. */
	id: string;
	groupId: string;
	groupLabel: string;
	server: EndpointGroup['server'];
	method: HttpMethod;
	path: string;
	summary: string;
	params: EndpointDoc['params'];
	requestBody?: EndpointDoc['requestBody'];
	/** A written example of what it answers, when the catalog has one. */
	response?: EndpointDoc['response'];
	statuses?: EndpointDoc['statuses'];
}

/**
 * An id that survives a reload and names nothing a caller can forge into a
 * different request. It is looked up in the same document it was built from,
 * so an unknown id is refused rather than used.
 */
export function endpointId(method: string, path: string): string {
	return `${method.toUpperCase()} ${path}`;
}

/** Every documented endpoint, in the order the reference lists them. */
export function labEndpoints(groups: readonly EndpointGroup[]): LabEndpoint[] {
	const out: LabEndpoint[] = [];
	for (const g of groups) {
		for (const ep of g.endpoints) {
			out.push({
				id: endpointId(ep.method, ep.path),
				groupId: g.id,
				groupLabel: g.label,
				server: g.server,
				method: ep.method,
				path: ep.path,
				summary: ep.summary,
				params: ep.params,
				requestBody: ep.requestBody,
				response: ep.response,
				statuses: ep.statuses,
			});
		}
	}
	return out;
}

export function findEndpoint(
	groups: readonly EndpointGroup[],
	id: string
): LabEndpoint | null {
	return labEndpoints(groups).find((e) => e.id === id) ?? null;
}

/** The path parameters an endpoint needs before it can be sent at all. */
export function pathParams(ep: LabEndpoint): string[] {
	return [...ep.path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
}

/**
 * The path to send, with each `{name}` replaced by the value given for it.
 *
 * Every value is percent-encoded as a single path segment, so a value holding
 * a slash, a `?` or a `..` becomes text rather than structure. That is what
 * keeps a parameter from rewriting the request: the template is the engine's
 * and the caller only fills the holes.
 *
 * Returns null when a parameter has no value, because a path still carrying
 * `{id}` would be sent literally and answer 404 for a reason that has nothing
 * to do with the endpoint.
 */
export function buildPath(ep: LabEndpoint, values: Record<string, string>): string | null {
	let missing = false;
	const path = ep.path.replace(/\{([^}]+)\}/g, (_, name: string) => {
		const v = (values[name] ?? '').trim();
		if (!v) {
			missing = true;
			return '';
		}
		return encodeURIComponent(v);
	});
	return missing ? null : path;
}

/**
 * The query string, from the parameters the engine documents as `in: query`.
 *
 * Only documented names are read. A caller cannot add one, which is the same
 * rule the path follows and for the same reason.
 */
export function buildQuery(ep: LabEndpoint, values: Record<string, string>): string {
	const q = new URLSearchParams();
	for (const p of ep.params ?? []) {
		if (p.in !== 'query') continue;
		const v = (values[p.name] ?? '').trim();
		if (v) q.set(p.name, v);
	}
	const s = q.toString();
	return s ? `?${s}` : '';
}

/**
 * Whether a built path can only reach this instance.
 *
 * `fetch` resolves a relative path against this origin, but `//host/x` is not
 * a relative path: it keeps the scheme and replaces the host, which is exactly
 * the request forgery the labs are built to prevent. Every path a lab sends is
 * an engine template with percent-encoded values substituted in, so nothing
 * should ever fail this. It is checked anyway, because the argument that it
 * cannot happen lives in a comment and this lives in the code.
 */
export function isSameOriginPath(path: string): boolean {
	return path.startsWith('/') && !path.startsWith('//');
}

/**
 * The real size of a string on the wire.
 *
 * `length` counts UTF-16 units, so a body of accented text or CJK measures
 * well under a limit it exceeds by three times once encoded.
 */
export function byteLength(s: string): number {
	return new TextEncoder().encode(s).length;
}

/** What a lab send produced, as the page renders it. */
export interface LabResult {
	method: string;
	path: string;
	status: number;
	statusText: string;
	durationMs: number;
	/** Pretty-printed when the answer parsed as JSON, raw otherwise. */
	body: string;
	/** True when the body was JSON, so the page can label it. */
	json: boolean;
	/** Headers worth reading back. The full set is noise. */
	headers: Record<string, string>;
}

/**
 * Response headers a tester actually reads.
 *
 * The full set is thirty lines of cache and security policy on every answer.
 * These are the ones that explain the status: what came back, how much of it,
 * how long the caller may keep it, and which of the engine's limits fired.
 */
export const SHOWN_HEADERS = [
	'content-type',
	'content-length',
	'cache-control',
	'etag',
	'location',
	'retry-after',
	'x-request-id',
	'ratelimit-remaining',
	'ratelimit-reset',
] as const;

export function pickHeaders(h: Headers): Record<string, string> {
	const out: Record<string, string> = {};
	for (const name of SHOWN_HEADERS) {
		const v = h.get(name);
		if (v !== null) out[name] = v;
	}
	return out;
}

/** Pretty-print a JSON body, or hand back what came if it is not JSON. */
export function formatBody(raw: string, contentType: string | null): { body: string; json: boolean } {
	if (contentType?.includes('json')) {
		try {
			return { body: JSON.stringify(JSON.parse(raw), null, 2), json: true };
		} catch {
			// A content type is a claim, not a guarantee. A malformed body is
			// shown as it arrived rather than replaced by a parse error,
			// because the malformed bytes are the finding.
			return { body: raw, json: false };
		}
	}
	return { body: raw, json: false };
}


/**
 * What a status means here, where the usual suspects have one cause.
 *
 * A tester meeting 402 for the first time should not have to guess: the plugin
 * is not enabled, and no amount of retrying or re-authenticating changes it.
 */
export const STATUS_HINTS: Readonly<Record<number, string>> = {
	401: SESSION_ENDED,
	402: 'The plugin behind this route is not enabled on this engine. Changing the request does not help.',
	403: 'You are signed in, but your role cannot call this route.',
	404: 'The route or the record does not exist. A path parameter that matches nothing returns this.',
	409: 'The change is not allowed from the current state.',
	422: 'The body failed validation. The response says which field.',
	429: 'A rate limit was reached. The Retry-After header says when to try again.',
	503: 'The database or a replica is unavailable. Send the request again later.',
};

export function statusHint(status: number): string {
	return STATUS_HINTS[status] ?? '';
}

/** The engine route that runs one transcoded gRPC call. */
export const GRPC_INVOKE_URL = '/api/admin/grpc/invoke';

/**
 * The parameter names a transcoded route needs.
 *
 * The route arrives as "POST /api/content/{schema}", the shape the plugin
 * declares, so the method and the template are read off one string.
 */
export function grpcRouteParts(route: string): { method: string; template: string } | null {
	const at = route.indexOf(' ');
	if (at <= 0) return null;
	const method = route.slice(0, at);
	const template = route.slice(at + 1);
	if (!template.startsWith('/')) return null;
	return { method, template };
}

export function grpcRouteParams(route: string): string[] {
	const parts = grpcRouteParts(route);
	if (!parts) return [];
	return [...parts.template.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
}

/** Whether a transcoded route needs a body, which is the same question as whether it writes. */
export function grpcRouteTakesBody(route: string): boolean {
	const parts = grpcRouteParts(route);
	if (!parts) return false;
	return parts.method === 'POST' || parts.method === 'PUT';
}

/** What the invoke route answers with. */
export interface GrpcInvokeResult {
	route: string;
	method: string;
	path: string;
	status: number;
	duration_ms: number;
	body: string;
}

/**
 * The invoke answer as the shared result renderer reads it.
 *
 * The outer call is always 200 when the route ran. The status that matters is
 * the one the transcoded handler gave, so that is the one shown.
 */
export function labResultFromInvoke(r: GrpcInvokeResult): LabResult {
	const { body, json } = formatBody(r.body, 'application/json');
	return {
		method: r.method,
		path: r.path,
		status: r.status,
		statusText: '',
		durationMs: r.duration_ms,
		body,
		json,
		headers: {},
	};
}

/** The GraphQL endpoint the lab posts to. */
export const GRAPHQL_URL = '/api/v1/graphql';

/**
 * Whether a GraphQL document only reads.
 *
 * Read off the operation keyword, which is the only thing that decides it.
 * A document with no keyword is an anonymous query, which reads. This is a
 * label for the operator, not a control: the engine decides what it runs.
 */
export function graphqlMutates(document: string): boolean {
	return /(^|\s)mutation(\s|\{|\()/i.test(document);
}

/** Variables must be a JSON object, or the engine refuses the whole request. */
export function parseVariables(raw: string): { ok: true; value: unknown } | { ok: false; error: string } {
	const t = raw.trim();
	if (!t) return { ok: true, value: undefined };
	try {
		const v = JSON.parse(t);
		if (v === null || typeof v !== 'object' || Array.isArray(v)) {
			return { ok: false, error: 'Variables are a JSON object, such as {"id": "abc"}.' };
		}
		return { ok: true, value: v };
	} catch (err) {
		return { ok: false, error: `Variables are not valid JSON: ${(err as Error).message}` };
	}
}

/**
 * Whether an answer's status is one the document lists for the route. Null
 * when the document lists none, so the page claims nothing either way.
 */
export function documentedStatus(
	statuses: EndpointDoc['statuses'],
	status: number,
): { code: string; description: string } | false | null {
	if (!statuses?.length) return null;
	const code = String(status);
	const range = `${code[0]}XX`;
	return statuses.find((s) => s.code === code || s.code.toUpperCase() === range || s.code === 'default') ?? false;
}
