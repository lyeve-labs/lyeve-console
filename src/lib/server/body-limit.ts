import type { RequestEvent } from '@sveltejs/kit';
import { requireUser } from '#lib/server/authz.ts';
import { sessionToken } from '#lib/server/session-cookie.ts';

/**
 * The largest body the console parses before it knows who sent it.
 *
 * SvelteKit runs a form action before any load, so the admin layout's session
 * check never comes first, and an action that reads its form before asking
 * the engine about the session parses the body for anyone. The image allows
 * bodies of 10 MiB for the actions below, and parsing one costs hundreds of
 * milliseconds of CPU and hundreds of megabytes.
 */
export const BODY_LIMIT = 1024 * 1024;

/** The action a form POST names, as SvelteKit reads it from the query. */
function actionName(url: URL): string {
	for (const key of url.searchParams.keys()) {
		if (key.startsWith('/')) return key.slice(1);
	}
	return 'default';
}

/**
 * The actions that send the engine a body it accepts past the limit, by route
 * and action name. Each reads its body only after the engine has confirmed
 * the session. Every other write sends the engine 1 MiB at most, and a file
 * upload goes from the browser to the engine without passing through here.
 */
const LARGE_BODY_ACTIONS: Record<string, readonly string[]> = {
	// A configuration bundle, up to 8 MiB.
	'/(admin)/admin/settings/config-sync': ['diff', 'dryRun', 'apply'],
	// A schema bundle up to 4 MiB, and a saved preset of up to 1 MiB plus its form.
	'/(admin)/admin/schema': ['import', 'savePreset'],
	// A flow bundle up to 4 MiB, and a template of up to 1 MiB plus its form.
	'/(admin)/admin/flows': ['import'],
	'/(admin)/admin/flows/[id]': ['import', 'saveTemplate'],
	// A datasource or a variable, up to 2 MiB.
	'/(admin)/admin/flows/datasources': ['create'],
	'/(admin)/admin/flows/variables': ['put'],
};

function takesLargeBody(event: RequestEvent): boolean {
	const actions = event.route.id ? LARGE_BODY_ACTIONS[event.route.id] : undefined;
	return actions?.includes(actionName(event.url)) ?? false;
}

function tooLarge(): Response {
	return new Response('Payload Too Large', { status: 413, headers: { 'content-type': 'text/plain' } });
}

/**
 * A copy of the request holding its whole body, read here up to the limit,
 * or null once the body passes it. A body sent without a length is read
 * before the action runs, so a body too large gets a 413 from here rather
 * than a failed read inside the action.
 */
async function buffered(request: Request, limit: number): Promise<Request | null> {
	const reader = request.body!.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > limit) {
			await reader.cancel();
			return null;
		}
		chunks.push(value);
	}
	const body = new Uint8Array(size);
	let at = 0;
	for (const chunk of chunks) {
		body.set(chunk, at);
		at += chunk.byteLength;
	}
	return new Request(request, { body });
}

/**
 * Holds a request body to the limit before any action reads it. Answers 413
 * for a declared length over the limit, lets a larger body through to the
 * actions above once the engine has confirmed the session, and reads a body sent without a length
 * up to the limit before the action does.
 * Returns the refusal, or null to go on.
 */
export async function limitBody(event: RequestEvent): Promise<Response | null> {
	const { request } = event;
	if (request.method === 'GET' || request.method === 'HEAD' || request.body === null) return null;
	const declared = request.headers.get('content-length');
	if (declared !== null && Number(declared) <= BODY_LIMIT) return null;
	// Without a session cookie the engine is not asked, so an anonymous
	// caller cannot make this server call it once per request. Such a body
	// meets the same limit as any other.
	if (takesLargeBody(event) && sessionToken(event)) {
		await requireUser(event);
		return null;
	}
	if (declared !== null) return tooLarge();
	const read = await buffered(request, BODY_LIMIT);
	if (!read) return tooLarge();
	// SvelteKit types the request as readonly, but the event is a plain object
	// the handle hook owns, and resolve() reads the request from it.
	(event as { request: Request }).request = read;
	return null;
}
