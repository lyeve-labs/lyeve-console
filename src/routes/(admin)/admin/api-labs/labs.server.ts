import type { RequestEvent } from '@sveltejs/kit';
import { authedHeaders } from '$lib/server/authz';
import { formatBody, isSameOriginPath, pickHeaders, type LabResult } from '$lib/api/labs';

/*
 * What every lab's action shares. The labs are separate routes, so the send
 * and its limits live here rather than in one route another imports.
 */

/**
 * A lab request is capped so a mistake stays a mistake.
 *
 * A tester who asks for a million rows should get a timeout rather than a
 * page that never renders, and a body larger than this is a file upload,
 * which belongs in the media screens where progress and resumption exist.
 */
const TIMEOUT_MS = 20_000;
export const MAX_BODY_BYTES = 256 * 1024;

/** The response text kept. Past this the page is unreadable anyway. */
const MAX_SHOWN_CHARS = 512 * 1024;

/**
 * Sends one request the engine documented, as the caller.
 *
 * The host is this instance and nothing else. The path is rebuilt from the
 * endpoint's own template with each value percent-encoded into one segment,
 * so no caller-supplied string reaches the host portion, and the result is
 * checked against isSameOriginPath before it is sent. That is the whole of
 * why this action is not a request forgery primitive.
 */
export async function send(
	event: RequestEvent,
	method: string,
	path: string,
	body: string | undefined,
	contentType: string,
): Promise<{ result: LabResult } | { error: string }> {
	// A raw request rather than the client, because the lab shows the reply's
	// status, headers and text as they came. The session headers carry the CSRF
	// token, without which every write a lab sends is refused with 403.
	const headers: Record<string, string> = { ...authedHeaders(event), Accept: 'application/json' };
	if (body !== undefined) headers['Content-Type'] = contentType;

	if (!isSameOriginPath(path)) {
		return { error: 'That path is not on this engine. The request was not sent.' };
	}

	const started = Date.now();
	const abort = AbortSignal.timeout(TIMEOUT_MS);
	let res: Response;
	try {
		res = await event.fetch(path, { method, headers, body, signal: abort });
	} catch (err) {
		// The runtime's own words for a failed connection can name an internal
		// address, so none of them are shown.
		const msg = err instanceof Error && err.name === 'TimeoutError'
			? `The request timed out after ${TIMEOUT_MS / 1000} seconds.`
			: 'Could not send the request. Try again.';
		return { error: msg };
	}

	const raw = (await res.text()).slice(0, MAX_SHOWN_CHARS);
	const { body: shown, json } = formatBody(raw, res.headers.get('content-type'));

	return {
		result: {
			method,
			path,
			status: res.status,
			statusText: res.statusText,
			durationMs: Date.now() - started,
			body: shown,
			json,
			headers: pickHeaders(res.headers),
		},
	};
}
