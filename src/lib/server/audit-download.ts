import { error, type RequestEvent } from '@sveltejs/kit';
import { sessionToken } from '$lib/server/session-cookie';
import { engineFetch } from '$lib/server/engine';
import { exportBody, readFilter } from '$lib/server/audit-filter';
import { OUTAGE } from '$lib/outage';

/**
 * Proxy one of the engine's audit exports and hand the bytes back as the
 * download it already labels.
 *
 * An export is a file, not a page, so it cannot be a form action: SvelteKit
 * refuses a Response returned from one and answers 500. It cannot be a plain
 * client call either, because the browser cannot read the httpOnly session
 * cookie to send it as a bearer.
 *
 * The call uses the global fetch against an absolute engine URL rather than
 * event.fetch. That matters: event.fetch forwards the browser's cookies, which
 * flips the engine to cookie auth and applies the double-submit CSRF check,
 * and a proxy has no token to echo. Going out of process keeps the engine on
 * bearer auth, where this request belongs.
 */
/** Seconds allowed for an export before the proxy gives up on the engine. */
const TIMEOUT_MS = 120_000;

export async function proxyAuditDownload(
	event: RequestEvent,
	path: string,
	fallbackName: string
): Promise<Response> {
	const token = sessionToken(event);
	if (!token) error(401, 'Not authenticated');

	// The export form carries the filter on screen, so the file holds the
	// entries the list shows rather than the whole log.
	const fields = new URLSearchParams();
	let posted: FormData | null = null;
	try {
		posted = await event.request.formData();
	} catch {
		posted = null;
	}
	for (const key of ['q', 'action', 'from', 'to']) {
		const value = posted?.get(key);
		if (typeof value === 'string' && value) fields.set(key, value);
	}
	const body = exportBody(readFilter(new URL(`http://filter/?${fields}`)));

	let res: Response;
	try {
		res = await engineFetch(event, path, {
			method: 'POST',
			token,
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(TIMEOUT_MS)
		});
	} catch {
		error(502, OUTAGE.body);
	}

	if (!res.ok) {
		// The engine's own status carries the meaning: 402 not enabled, 403 wrong
		// role, 503 database. Passing a static message keeps driver text out of
		// the answer while leaving the status to say what happened.
		error(res.status, 'Export refused');
	}

	const headers = new Headers();
	for (const name of ['content-type', 'content-disposition', 'content-length']) {
		const value = res.headers.get(name);
		if (value) headers.set(name, value);
	}
	if (!headers.has('content-disposition')) {
		headers.set('content-disposition', `attachment; filename="${fallbackName}"`);
	}
	headers.set('cache-control', 'no-store');
	return new Response(res.body, { status: res.status, headers });
}
