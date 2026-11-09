import type { PageServerLoad, Actions } from './$types';
import { fail } from '@sveltejs/kit';
import { staticGroups, type EndpointGroup } from '$lib/api/reference';
import { buildReference, type OpenAPIDocument } from '$lib/api/openapi';
import type { HttpClient } from '@lyeve-labs/client';
import { authedClient } from '$lib/server/authz';
import { buildPath, buildQuery, byteLength, findEndpoint, labEndpoints, riskOf } from '$lib/api/labs';
import { MAX_BODY_BYTES, send } from './labs.server';
import { asked } from '$lib/server/asked';

/**
 * The endpoints a lab may send, read from the engine every time.
 *
 * This is the allowlist, not a convenience. It is read again inside the send
 * rather than taken from the page's data or the submitted form, because
 * anything that travels through the browser is the caller's to choose, and an
 * allowlist the caller can choose is not one.
 */
async function readGroups(client: HttpClient): Promise<{ groups: EndpointGroup[]; source: 'engine' | 'catalog' }> {
	try {
		const doc = await client.get<OpenAPIDocument | null>('/api/admin/openapi.json', {
			headers: { Accept: 'application/json' },
		});
		if (doc && typeof doc.paths === 'object') {
			return { groups: buildReference(doc, staticGroups).groups, source: 'engine' };
		}
	} catch {
		// The catalog alone still lists endpoints worth trying, and the page
		// says which it is showing rather than implying the engine answered.
	}
	return { groups: staticGroups, source: 'catalog' };
}

export const load: PageServerLoad = async (event) => {
	const { groups, source } = await readGroups(authedClient(event));
	return { endpoints: labEndpoints(groups), source };
};

export const actions: Actions = {
	rest: asked(
		{
			question: 'Send this request?',
			detail: 'It changes data on the engine you are signed in to, as you. This is not a test run.',
			label: 'Send it',
		},
		async (event) => {
			// No extra role gate. The request goes out as the caller and the
			// engine's own authorization answers it, so a lab can send nothing its
			// operator could not already send with curl. Requiring more here would
			// be a second, weaker copy of a decision the engine already makes.
			const form = await event.request.formData();
			const id = String(form.get('endpoint') ?? '');

			const { groups } = await readGroups(authedClient(event));
			const ep = findEndpoint(groups, id);
			if (!ep) {
				return fail(400, { error: 'Choose an endpoint from the list.' });
			}

			const values: Record<string, string> = {};
			for (const [k, v] of form.entries()) {
				if (k.startsWith('p_')) values[k.slice(2)] = String(v);
			}

			const path = buildPath(ep, values);
			if (path === null) {
				return fail(400, {
					error: 'Fill in every path parameter. A placeholder such as {name} left in the path returns a misleading 404.',
				});
			}

			const raw = String(form.get('body') ?? '').trim();
			if (byteLength(raw) > MAX_BODY_BYTES) {
				return fail(400, { error: 'The body can be at most 256 KB. Upload files from the media screens.' });
			}
			const sendBody = raw && ep.method !== 'GET' ? raw : undefined;
			if (sendBody) {
				try {
					JSON.parse(sendBody);
				} catch (err) {
					return fail(400, { error: `Fix the JSON in the body: ${(err as Error).message}` });
				}
			}

			const out = await send(event, ep.method, path + buildQuery(ep, values), sendBody, 'application/json');
			if ('error' in out) return fail(504, { error: out.error });
			return { rest: out.result };
		},
		(form) => riskOf(String(form.get('endpoint') ?? '').split(' ')[0]) !== 'read',
	),
};
