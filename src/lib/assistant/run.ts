/**
 * Running a request the assistant proposed, once the person approves it.
 *
 * The assistant never runs a call that changes data, deletes it, sends it
 * out or needs a super admin. It proposes the call, the panel shows it in
 * full, and the person runs it from the panel with their own session, so the
 * engine's own authorization decides it. The console's route sends it, the
 * way the API labs send a request, and takes no host: the path has to be one
 * of the engine's own `/api/` paths, so nothing can point the console's server
 * anywhere else.
 */

export interface RunRequest {
	method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
	path: string;
	query?: Record<string, unknown>;
	body?: unknown;
}

const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const PATH = /^\/api\/[A-Za-z0-9._~%:@\-/]*$/;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The request to send, or null when the path or the method is not one the engine serves. */
export function readRun(input: unknown): RunRequest | null {
	if (!isObject(input) || typeof input.method !== 'string' || typeof input.path !== 'string') return null;
	const method = input.method.toUpperCase();
	const path = input.path;
	if (!METHODS.has(method) || !PATH.test(path) || path.includes('..') || path.includes('//')) return null;
	return {
		method: method as RunRequest['method'],
		path,
		...(isObject(input.query) ? { query: input.query } : {}),
		...(input.body !== undefined && method !== 'GET' ? { body: input.body } : {}),
	};
}

/** The path with its query, each value as text and an array as repeated keys. */
export function runTarget(run: RunRequest): string {
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(run.query ?? {})) {
		for (const v of Array.isArray(value) ? value : [value]) {
			if (v === null || v === undefined) continue;
			params.append(key, typeof v === 'object' ? JSON.stringify(v) : String(v));
		}
	}
	const q = params.toString();
	return q ? `${run.path}?${q}` : run.path;
}
