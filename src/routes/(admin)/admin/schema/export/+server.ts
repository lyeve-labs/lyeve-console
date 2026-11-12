import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authedHeaders } from '$lib/server/authz';

/**
 * Every content type as one file, for moving them to another instance.
 *
 * A plain link, like the transcript download: the session cookie is httpOnly
 * and the engine wants a bearer, so this route forwards the file with the
 * engine's own type and filename. YAML by default, JSON on request.
 */
export const GET: RequestHandler = async ({ cookies, url, fetch }) => {
	const auth = authedHeaders({ cookies, url });
	const json = url.searchParams.get('format') === 'json';

	let res: Response;
	try {
		res = await fetch(`/api/admin/schemas/export${json ? '?format=json' : ''}`, { headers: auth });
	} catch {
		error(502, 'Could not reach the engine. Try again in a moment.');
	}
	if (!res.ok) {
		if (res.status === 403) error(403, 'Only an admin or a super admin can export content types.');
		error(502, 'Could not export the content types. Try again.');
	}
	const headers = new Headers();
	headers.set('Content-Type', res.headers.get('content-type') ?? (json ? 'application/json; charset=utf-8' : 'application/yaml; charset=utf-8'));
	headers.set('Content-Disposition', `attachment; filename="lyeve-schemas.${json ? 'json' : 'yaml'}"`);
	headers.set('Cache-Control', 'no-store');
	return new Response(res.body, { status: 200, headers });
};
