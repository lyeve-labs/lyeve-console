import type { PageServerLoad, Actions } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { authedClient, requireUser } from '$lib/server/authz';
import { actionError } from '$lib/server/action-error';
import { checked } from '$lib/checkbox';
import { refusalOf, refusalText } from '$lib/api/refusal';
import { pageOf, pageWindow, pastEndOffset, withOffset, type ListEnvelope } from '$lib/api/list';
import { section, type Section } from '$lib/api/gate';
import { describeMedia, importMedia, importRefusal, parseTags, setMediaPublic, updateMediaDetails, type MediaItem, setFocalPoint, signTransformUrl, transformRequestFrom } from '$lib/api/media';
import { ApiError } from '@lyeve-labs/client';
import { PLUGIN } from '$lib/plugin-names';
import { runs } from '$lib/plugins';
import { couldNotLoad } from '$lib/outage';
import { asked } from '$lib/server/asked';

export type { MediaItem } from '$lib/api/media';

/**
 * Why no description came back, in the reader's terms. The AI plugin answers
 * 503 when no provider is enabled, which is a setting and not an outage, and
 * 402 both for a license that leaves AI out and for a spent budget, which
 * only the body tells apart.
 */
function describeFailure(err: unknown): string {
	if (err instanceof ApiError && err.status === 503 && /no enabled ai provider/i.test(err.message)) {
		return 'No AI provider is enabled. A super admin can enable one under AI providers.';
	}
	if (err instanceof ApiError && err.status === 402 && /budget/i.test(err.message)) {
		return 'The AI budget for this billing period is used up. You can suggest alt text again when it renews.';
	}
	const refused = refusalOf(err);
	if (refused) return refusalText(refused);
	return actionError(err, 'Could not suggest alt text. Try again.');
}

/** The engine's own page size when a request names none. */
const DEFAULT_LIMIT = 60;

/**
 * One below the engine's list ceiling, because the request below asks for a row
 * past the page to learn whether another page exists. At the ceiling that extra
 * row would be clamped away and the last page would always look like the last
 * page.
 */
const MAX_LIMIT = 199;

/**
 * A write that names no file belongs to no drawer, so it is said at the top
 * of the page with the other page-level failures.
 */
const NO_FILE = 'This form is missing its file. Reload the page and try again.';

const LIST_FAILED = couldNotLoad('the media library');

/**
 * The grid renders one window of the library. A library of ten thousand files
 * is a page the browser cannot lay out, and the operator has no way to reach
 * the end of it either way.
 */
export const load: PageServerLoad = async (event) => {
	const { url, parent } = event;
	const client = authedClient(event);
	const { limit, offset } = pageWindow(url, DEFAULT_LIMIT, MAX_LIMIT);
	const q = (url.searchParams.get('q') ?? '').trim();

	// The list route has no text filter. A search goes through the engine's
	// search endpoint, which answers `items` and `total` rather than the list
	// envelope, sorted here the way the list is so the two views read alike.
	const request = q
		? client
				.post<{ items?: MediaItem[] | null; total?: number }>('/api/admin/media/search', {
					query: q,
					limit: limit + 1,
					offset,
					sort_by: 'created_at',
					sort_desc: true,
				})
				.then((r): ListEnvelope<MediaItem> => ({ data: r.items ?? [], total: r.total }))
		: client.get<ListEnvelope<MediaItem> | MediaItem[]>(`/api/admin/media?limit=${limit + 1}&offset=${offset}`);
	const read = await section(request, LIST_FAILED);

	// The alt-text suggestion is the AI plugin's. Without it the drawer does
	// not offer one.
	const { plugins } = await parent();
	const aiEnabled = runs(plugins, PLUGIN.ai);

	// Nothing was read, so the page draws the gate in place of the grid and
	// there is no last page to send the request back to.
	if (!read.ok) return { items: read, limit, offset, total: null, hasMore: false, q, aiEnabled };

	const page = pageOf<MediaItem>(read.value, limit, offset);
	const back = pastEndOffset(page.rows.length, limit, offset, page.total);
	if (back !== null) redirect(307, withOffset(url, back));
	// Typed, because a bare literal widens `ok` to boolean and the page could
	// no longer tell the two cases apart.
	const items: Section<MediaItem[]> = { ok: true, value: page.rows };
	return { items, limit, offset, total: page.total, hasMore: page.hasMore, q, aiEnabled };
};

export const actions: Actions = {
	delete: asked(
		{
			question: 'Delete this file?',
			detail: 'The file is removed from the library, and any page that links to it can no longer load it. This cannot be undone.',
			label: 'Delete',
		},
		async (event) => {
			await requireUser(event);
			const { request } = event;
			const client = authedClient(event);
			const data = await request.formData();
			const id = String(data.get('id') ?? '');
			if (!id) return fail(400, { error: NO_FILE });
			try {
				await client.delete(`/api/admin/media/${encodeURIComponent(id)}`);
			} catch (err) {
				// The delete is asked from the preview drawer, which stays open on a
				// refusal, so the failure names its file and shows there.
				return fail(400, { deleteError: actionError(err, 'Could not delete the file. Try again.'), deleteId: id });
			}
		},
	),

	update: async (event) => {
		await requireUser(event);
		const data = await event.request.formData();
		const id = String(data.get('id') ?? '');
		if (!id) return fail(400, { error: NO_FILE });
		try {
			const item = await updateMediaDetails(authedClient(event), id, {
				alt_text: String(data.get('alt_text') ?? '').trim(),
				tags: parseTags(String(data.get('tags') ?? '')),
				folder: String(data.get('folder') ?? '').trim() || '/',
			});
			return { updated: item };
		} catch (err) {
			return fail(400, { detailsError: actionError(err, 'Could not save the details. Try again.'), detailsId: id });
		}
	},

	importUrl: async (event) => {
		await requireUser(event);
		const data = await event.request.formData();
		const url = String(data.get('url') ?? '').trim();
		if (!/^https?:\/\/\S+$/i.test(url)) {
			return fail(400, { importError: 'Enter an http or https address.' });
		}
		try {
			const item = await importMedia(authedClient(event), {
				url,
				alt_text: String(data.get('alt_text') ?? '').trim(),
				public: checked(data, 'public'),
			});
			return { imported: item };
		} catch (err) {
			return fail(400, { importError: importRefusal(actionError(err, 'Could not import the file. Try again.')) });
		}
	},

	publish: async (event) => {
		await requireUser(event);
		const data = await event.request.formData();
		const id = String(data.get('id') ?? '');
		if (!id) return fail(400, { error: NO_FILE });
		try {
			const item = await setMediaPublic(authedClient(event), id, data.get('public') === 'true');
			return { updated: item };
		} catch (err) {
			return fail(400, { detailsError: actionError(err, data.get('public') === 'true' ? 'Could not publish the file. Try again.' : 'Could not unpublish the file. Try again.'), detailsId: id });
		}
	},

	focal: async (event) => {
		await requireUser(event);
		const data = await event.request.formData();
		const id = String(data.get('id') ?? '');
		if (!id) return fail(400, { error: NO_FILE });
		const clear = data.get('clear') === 'true';
		const x = Number(data.get('x'));
		const y = Number(data.get('y'));
		if (!clear && (!Number.isFinite(x) || !Number.isFinite(y))) {
			return fail(400, { focalError: 'Click the image to place the point.', focalId: id });
		}
		try {
			const item = await setFocalPoint(authedClient(event), id, clear ? null : { x, y });
			return { updated: item, focalSaved: id };
		} catch (err) {
			return fail(400, { focalError: actionError(err, 'Could not save the focal point. Try again.'), focalId: id });
		}
	},

	transformUrl: async (event) => {
		await requireUser(event);
		const data = await event.request.formData();
		const id = String(data.get('id') ?? '');
		if (!id) return fail(400, { error: NO_FILE });
		try {
			const signed = await signTransformUrl(authedClient(event), id, transformRequestFrom(data));
			return { transform: { id, url: signed.url, expires_at: signed.expires_at ?? null } };
		} catch (err) {
			const refused = refusalOf(err);
			if (refused) return fail(402, { transformError: refusalText(refused), transformRefused: refused, transformId: id });
			return fail(400, { transformError: actionError(err, 'Could not build the URL. Try again.'), transformId: id });
		}
	},

	describe: async (event) => {
		await requireUser(event);
		const id = String((await event.request.formData()).get('id') ?? '');
		if (!id) return fail(400, { error: NO_FILE });
		try {
			return { described: { id, text: await describeMedia(authedClient(event), id) } };
		} catch (err) {
			return fail(400, { detailsError: describeFailure(err), detailsId: id });
		}
	},
};
