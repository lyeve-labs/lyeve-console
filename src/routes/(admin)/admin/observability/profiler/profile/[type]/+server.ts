import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { PROFILER_ROOT, clampSeconds, isProfileType } from '$lib/api/profiler';
import { engineFetch } from '$lib/server/engine';
import { sessionToken } from '$lib/server/session-cookie';
import { OUTAGE } from '$lib/outage';
import { SESSION_ENDED } from '$lib/session';

/**
 * Proxies a pprof export to the profiler plugin and hands the bytes back as
 * the download it already labels.
 *
 * It lives under the page rather than under /api/, because a proxy serving
 * the console and the engine on one address sends every /api/ path to the
 * engine, which refuses the form body.
 *
 * A pprof export is a file, not a page, so it is not a load, and the browser
 * cannot read the httpOnly session cookie to send it as a bearer. This route
 * reads the cookie, forwards it as the engine expects, and streams the
 * answer through untouched: the plugin decides the role (super_admin) and
 * whether a heap export is allowed at all.
 */
export const POST: RequestHandler = async (event) => {
	const { cookies, params, request, url } = event;
	const token = sessionToken(event);
	if (!token) error(401, SESSION_ENDED);
	if (!isProfileType(params.type)) error(404, 'Unknown profile type');

	// The page submits a plain form so the browser treats the answer as a
	// download, which puts the window in the body. A direct call may put it
	// in the query as the engine takes it.
	let raw: string | null = url.searchParams.get('duration_sec');
	if (raw === null && (request.headers.get('content-type') ?? '').includes('form')) {
		const data = await request.formData().catch(() => null);
		raw = data ? String(data.get('duration_sec') ?? '') : null;
	}
	const seconds = clampSeconds(raw);
	let res: Response;
	try {
		res = await engineFetch(event, `${PROFILER_ROOT}/profile/${params.type}?duration_sec=${seconds}`, {
			method: 'POST',
			token,
			signal: AbortSignal.timeout((seconds + 15) * 1000),
		});
	} catch {
		error(502, OUTAGE.title);
	}

	const headers = new Headers();
	for (const name of ['content-type', 'content-disposition', 'content-length']) {
		const v = res.headers.get(name);
		if (v) headers.set(name, v);
	}
	headers.set('cache-control', 'no-store');
	return new Response(res.body, { status: res.status, headers });
};
