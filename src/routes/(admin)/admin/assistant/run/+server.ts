import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authedHeaders } from '$lib/server/authz';
import { readRun, runTarget } from '$lib/assistant/run';
import { SESSION_ENDED } from '$lib/session';

/** A write that met no answer may still have landed, so the sentence claims nothing about it. */
const UNCERTAIN = 'Check whether your change was saved, then try again.';

const coded = (e: unknown): e is { message: string; code: string } =>
	typeof e === 'object' && e !== null && typeof (e as { message?: unknown }).message === 'string' && typeof (e as { code?: unknown }).code === 'string' && (e as { message: string }).message.trim() !== '';

/**
 * Runs a request the assistant proposed, after the person approved it in
 * the panel. It goes out with the person's own session, so the engine
 * decides it as it would any request of theirs. The answer to the panel is
 * the status and, on a refusal, a sentence: the engine's own message for a
 * 4xx that carries an error code, and the console's for the rest.
 */
export const POST: RequestHandler = async ({ request, cookies, url, fetch }) => {
	if (request.headers.get('origin') !== url.origin) return json({ ok: false, message: 'Could not run the request. Try again.' }, { status: 403 });
	const auth = authedHeaders({ cookies, url });
	const run = readRun(await request.json().catch(() => null));
	if (!run) return json({ ok: false, message: 'This request cannot be run from the console.' }, { status: 400 });

	let res: Response;
	try {
		res = await fetch(runTarget(run), {
			method: run.method,
			headers: { ...auth, Accept: 'application/json', ...(run.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
			...(run.body !== undefined ? { body: JSON.stringify(run.body) } : {}),
		});
	} catch {
		return json({ ok: false, status: 0, message: UNCERTAIN });
	}
	if (res.ok) return json({ ok: true, status: res.status });
	if (res.status === 401) return json({ ok: false, status: 401, message: SESSION_ENDED });
	const body = (await res.json().catch(() => null)) as { error?: unknown; code?: unknown; errors?: unknown } | null;
	if (res.status < 500 && typeof body?.error === 'string' && typeof body.code === 'string' && body.error.trim()) {
		return json({ ok: false, status: res.status, message: body.error });
	}
	// A validation refusal lists each field with its own code and message.
	const fields = res.status < 500 && Array.isArray(body?.errors) ? body.errors.filter(coded).map((e) => e.message.trim()) : [];
	if (fields.length > 0) return json({ ok: false, status: res.status, message: fields.join(' ') });
	return json({ ok: false, status: res.status, message: res.status < 500 ? 'Could not run the request.' : UNCERTAIN });
};
