import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authedHeaders } from '$lib/server/authz';
import { readRequest } from '$lib/assistant/request';
import { refusalKind } from '$lib/assistant/refusal';

const ASSISTANT_PATH = '/api/admin/ai/assistant';

/**
 * The assistant panel's way to the engine.
 *
 * A form action answers once, and the assistant answers as a stream of
 * events, so the panel posts here and reads the stream this route passes
 * through. The browser never holds the session: this route reads the cookie
 * and calls the engine as the person. A refusal reaches the panel as a kind,
 * never as the engine's text.
 */
export const POST: RequestHandler = async ({ request, cookies, url, fetch }) => {
	if (request.headers.get('origin') !== url.origin) return json({ refusal: 'failed' }, { status: 403 });
	const auth = authedHeaders({ cookies, url });
	const body = readRequest(await request.json().catch(() => null));
	if (!body) return json({ refusal: 'failed' }, { status: 400 });

	let res: Response;
	try {
		res = await fetch(ASSISTANT_PATH, {
			method: 'POST',
			headers: { ...auth, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
			body: JSON.stringify(body),
			signal: request.signal,
		});
	} catch {
		return json({ refusal: 'outage' }, { status: 502 });
	}
	if (!res.ok || !res.body) {
		const kind = refusalKind(res.status, await res.json().catch(() => null));
		return json({ refusal: kind }, { status: res.status >= 500 ? 502 : res.status });
	}
	return new Response(res.body, {
		status: 200,
		headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' },
	});
};
