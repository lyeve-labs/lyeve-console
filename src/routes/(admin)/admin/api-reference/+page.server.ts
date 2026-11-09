import type { Actions, PageServerLoad } from './$types';
import { fail } from '@sveltejs/kit';
import { authedClient, authedHeaders, loadUser, requireUser } from '$lib/server/authz';
import { engineOriginFor } from '$lib/server/engine';
import { checked } from '$lib/checkbox';
import {
	MAX_SHOWN_BODY,
	presentBody,
	refuse,
	type TryResult,
} from '$lib/api/try-it';
import { staticGroups, type EndpointGroup } from '$lib/api/reference';
import { buildReference, type OpenAPIDocument } from '$lib/api/openapi';

export type ReferenceSource = 'engine' | 'catalog';

/** Which of the engine's two documents the page shows. */
export type ReferenceHalf = 'public' | 'admin';

export interface ReferencePageData {
	groups: EndpointGroup[];
	/** Distinct collections the engine documented. 0 when unknown. */
	collections: number;
	/** Where the routes came from. The catalog is the fallback, never the truth. */
	source: ReferenceSource;
	half: ReferenceHalf;
	/** Whether the caller may read the admin half: a super admin only. */
	canSeeAdmin: boolean;
	/** The document behind the page, for the download. */
	specHref: string;
}

// The engine's document is the set of routes. The catalog is prose laid
// over it. When the document cannot be read (engine down, session gone) the
// catalog renders alone and the page says so, rather than showing an empty
// reference or a stale one that claims to be current.
//
// The engine serves two documents. The admin half is refused to anyone but a
// super admin, so a request for it from an admin shows the public half: the
// tab is hidden for them, and the engine is what refuses.
export const load: PageServerLoad = async (event): Promise<ReferencePageData> => {
	const { url } = event;
	const user = await loadUser(event);
	const canSeeAdmin = user.roles.includes('super_admin');
	const half: ReferenceHalf = canSeeAdmin && url.searchParams.get('api') === 'admin' ? 'admin' : 'public';
	const specHref = `/api/admin/openapi/${half}.json`;
	try {
		const doc = await authedClient(event).get<OpenAPIDocument | null>(specHref, {
			headers: { Accept: 'application/json' },
		});
		if (!doc || typeof doc.paths !== 'object') throw new Error(`${specHref} has no paths`);
		const { groups, collections } = buildReference(doc, staticGroups);
		return { groups, collections, source: 'engine', half, canSeeAdmin, specHref };
	} catch {
		const groups = staticGroups.filter((g) => (half === 'admin' ? g.server === 'admin' : g.server !== 'admin'));
		return { groups, collections: 0, source: 'catalog', half, canSeeAdmin, specHref };
	}
};

export const actions: Actions = {
	/**
	 * Run one documented endpoint against this instance.
	 *
	 * The reader already holds a session against the engine being documented,
	 * so there is no key to make and nothing to configure, which is the whole
	 * reason this belongs here rather than in a separate console.
	 *
	 * Through `event.fetch`, so the request is same-origin and carries the
	 * session and the CSRF token the engine wants, assembled in one place.
	 */
	try: async (event) => {
		// The role is read here rather than taken from the page, because the
		// page's copy of it is whatever the browser chose to send.
		const user = await requireUser(event);
		const form = await event.request.formData();
		const method = String(form.get('method') ?? 'GET').toUpperCase();
		const path = String(form.get('path') ?? '').trim();
		const body = String(form.get('body') ?? '');

		const refusal = refuse({
			method,
			path,
			acknowledged: checked(form, 'acknowledge'),
			canWrite: user.roles.includes('super_admin'),
		});
		if (refusal) return fail(422, { tryError: refusal.reason });

		/*
		 * An absolute URL to the listener that serves this path, rather than a
		 * relative one.
		 *
		 * SvelteKit resolves a relative fetch against its own router before
		 * anything else, so a relative `/api/v1/...` answers 404 from this
		 * application and never reaches the engine at all. The Public API half
		 * of this page is exactly the half that lives under /api/v1.
		 */
		const target = engineOriginFor(path).replace(/\/$/, '') + path;

		const started = Date.now();
		try {
			const res = await event.fetch(target, {
				method,
				headers: {
					...authedHeaders(event),
					Accept: 'application/json',
					...(body ? { 'Content-Type': 'application/json' } : {}),
				},
				...(body && method !== 'GET' && method !== 'HEAD' ? { body } : {}),
			});

			const contentType = res.headers.get('content-type') ?? '';
			const raw = await res.text();
			const truncated = raw.length > MAX_SHOWN_BODY;
			const result: TryResult = {
				status: res.status,
				durationMs: Date.now() - started,
				contentType,
				body: presentBody(truncated ? raw.slice(0, MAX_SHOWN_BODY) : raw, contentType),
				truncated,
			};
			return { tried: result };
		} catch {
			// A transport failure is not a response. Reporting it as one would
			// have the reader debugging an endpoint that was never reached. The
			// runtime's own words can name an internal address, so none of them
			// are shown.
			return fail(502, { tryError: 'Could not send the request. Try again.' });
		}
	},
};
