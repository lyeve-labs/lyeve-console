import type { PageServerLoad, Actions, RequestEvent } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { ApiError, type Schema, type SchemaField, type HttpClient } from '@lyeve-labs/client';
import { getSchema } from '@lyeve-labs/client-rest';
import { authedClient, exactParse, requireUser, stripProtectedFields, withExactIntegers } from '$lib/server/authz';
import { actionError, actionFailure } from '$lib/server/action-error';
import { readError } from '$lib/server/read-error';
import { readRelationChoices } from '$lib/server/relation-choices';
import { setEntryRelations } from '$lib/server/content-relations';
import { fieldRefusalOf } from '$lib/server/content-validation';
import { PLUGIN } from '$lib/plugin-names';
import { runs } from '$lib/plugins';
import { listMediaChoices, type MediaChoice } from '$lib/api/media';
import { createComment, setThreadResolved } from '$lib/api/content-comments';
import { addReleaseItem } from '$lib/api/content-releases';
import { createTranslation, translationInput, updateTranslation, type TranslationStatus } from '$lib/api/localization';
import { createAssignment, isTransitionAction, transitionAssignment } from '$lib/api/review';
import { listPeople } from '$lib/server/people';
import { loadComments, loadLocalization, loadReleases, loadReview } from '$lib/server/entry-panels';

/*
 * Entries live in the admin store (sys_content_entries) and are served by the
 * admin API. The v1 content routes read the schema engine's per-schema tables,
 * a store the admin never writes, so every load and action below targets the
 * admin endpoints and normalizes the rows into the shape the editor expects.
 */

/** An entry as the admin store answers it. */
type StoredEntry = {
	id: string;
	created_at: string;
	updated_at: string;
	title?: unknown;
	body?: unknown;
	meta?: unknown;
	status?: string;
	/** Absent for an entry of no tenant. */
	tenant_id?: string;
};

/**
 * Fetch the entry from the admin store and normalize it to the editor shape.
 * A refusal throws the client's error, so the load can tell an entry that is
 * not there from an engine that did not answer. The form holds the schema's
 * fields, which live in the body, so meta stays out of it: a meta key named
 * like a field would otherwise replace that field's value, and the next save
 * would write it into the body.
 */
async function getEntry(client: HttpClient, id: string, fields: Promise<SchemaField[]>) {
	const e = await client.get<StoredEntry>(`/api/admin/content/${encodeURIComponent(id)}`);
	const exact = exactParse(e) as StoredEntry | undefined;
	const body = withExactIntegers(
		await fields,
		e.body && typeof e.body === 'object' ? (e.body as Record<string, unknown>) : {},
		exact?.body,
	);
	return {
		id: e.id,
		tenant_id: e.tenant_id ?? '',
		created_at: e.created_at,
		updated_at: e.updated_at,
		data: {
			...body,
			...(e.title !== undefined ? { title: e.title } : {}),
			_status: e.status ?? 'published',
		} as Record<string, unknown>,
	};
}

/** A revision in the shape the history panel renders. */
type EditorRevision = {
	id: string;
	revision_num: number;
	created_at: string;
	created_by: string;
	data: Record<string, unknown>;
};

/**
 * Normalize one revision row into the editor shape.
 *
 * A revision row carries title, body, meta and status as separate columns, the
 * same way an entry does, and the editor reads one flat `data` object. Passed
 * through unchanged, a revision reaches the panel with no `data` at all, and
 * the panel's own summary calls Object.keys on it, which throws during
 * hydration and takes the whole page down.
 */
function toEditorRevision(
	rev: Record<string, unknown>,
	fields: readonly SchemaField[] = [],
	exact?: Record<string, unknown>,
): EditorRevision {
	const body =
		rev.body && typeof rev.body === 'object'
			? withExactIntegers(fields, rev.body as Record<string, unknown>, exact?.body)
			: rev.body;
	const meta = rev.meta;
	return {
		id: String(rev.id ?? ''),
		revision_num: Number(rev.revision_num ?? 0),
		created_at: String(rev.created_at ?? ''),
		created_by: String(rev.created_by ?? ''),
		data: {
			...(body && typeof body === 'object' ? (body as Record<string, unknown>) : {}),
			...(rev.title !== undefined ? { title: rev.title } : {}),
			...(meta && typeof meta === 'object' ? (meta as Record<string, unknown>) : {}),
			_status: rev.status ?? 'published',
		},
	};
}

/**
 * The revision list as the history panel reads it. `hiddenOlder` counts the
 * revisions the plugin left out because they are older than the window this
 * install reads, and `windowDays` is that window, null when the install reads
 * every revision.
 */
type RevisionList = {
	revisions: EditorRevision[];
	hiddenOlder: number;
	windowDays: number | null;
	/** How many revisions the plugin says the entry has in the window, which can exceed the rows read. */
	total: number;
	/** The read failed, so the empty list says nothing about the entry's history. */
	failed: boolean;
	/**
	 * Whether the entry's type keeps history. Null when the plugin did not
	 * say, which an engine older than the setting never does.
	 */
	historyEnabled: boolean | null;
};

const REVISIONS_FAILED: RevisionList = {
	revisions: [],
	hiddenOlder: 0,
	windowDays: null,
	total: 0,
	failed: true,
	historyEnabled: null,
};

/** The revisions as the endpoint answers them: the envelope, or a bare array from an older engine. */
type RevisionBody =
	| Record<string, unknown>[]
	| {
			data?: Record<string, unknown>[];
			total_count?: unknown;
			hidden_older?: unknown;
			window_days?: unknown;
			history_enabled?: unknown;
	  }
	| null;

/**
 * The most rows one read asks for, which is the engine's page ceiling. Left
 * unnamed, the plugin answers its default of 50, newest first, and the older
 * ones could not be listed or restored from the panel.
 */
const REVISION_LIMIT = 500;

/**
 * Fetch the entry's revisions.
 *
 * The endpoint answers with the paginated envelope every admin list uses, so
 * the rows are under `data`. Handed straight through, the page would receive
 * the envelope where it expects the array: `revisions.length` would be
 * undefined, and the History control is rendered only when that is above
 * zero. Beside the page it says how many older revisions it left out.
 */
async function listRevisions(client: HttpClient, id: string, fields: Promise<SchemaField[]>): Promise<RevisionList> {
	try {
		const body = await client.get<RevisionBody>(
			`/api/admin/content/${encodeURIComponent(id)}/revisions?limit=${REVISION_LIMIT}&offset=0`,
		);
		const rows = (Array.isArray(body) ? body : (body?.data ?? [])) as Record<string, unknown>[];
		const exact = exactParse(body) as RevisionBody | undefined;
		const exactRows = (Array.isArray(exact) ? exact : (exact?.data ?? [])) as Record<string, unknown>[];
		const known = await fields;
		const hidden = Array.isArray(body) ? 0 : Number(body?.hidden_older ?? 0);
		const days = Array.isArray(body) ? null : body?.window_days;
		const counted = Array.isArray(body) ? NaN : Number(body?.total_count);
		const enabled = Array.isArray(body) ? undefined : body?.history_enabled;
		return {
			revisions: rows.map((row, i) => toEditorRevision(row, known, exactRows[i])),
			total: Number.isInteger(counted) && counted > rows.length ? counted : rows.length,
			hiddenOlder: Number.isInteger(hidden) && hidden > 0 ? hidden : 0,
			windowDays: typeof days === 'number' && days > 0 ? days : null,
			failed: false,
			historyEnabled: typeof enabled === 'boolean' ? enabled : null,
		};
	} catch {
		return REVISIONS_FAILED;
	}
}

export const load: PageServerLoad = async (event) => {
	const { params, parent } = event;
	const client = authedClient(event);
	const { plugins, user } = await parent();
	// One read of the directory serves the mention list and the review picker.
	const people = listPeople(client);

	const schema = getSchema(params.schema, client);
	// The entry and its revisions read integer fields exactly, which takes the
	// schema. A schema that cannot be read is reported below, and the reads
	// then keep their plain values.
	const fields = schema.then((s) => s.fields ?? [], () => [] as SchemaField[]);
	const entry = getEntry(client, params.id, fields);
	// Caught where it starts: when the entry read fails the load throws before
	// the comments ever read the tenant, and a rejection nobody holds by then
	// is an unhandled one. The entry's own failure is reported below.
	const tenant = entry.then((e) => e.tenant_id).catch(() => '');

	const [schemaDef, item, revisionList, localization, review, comments, releases] = await Promise.all([
		schema.catch((err: unknown): Schema => readError(err, `Content type "${params.schema}" not found`)),
		entry.catch((err: unknown) => readError(err, 'Entry not found')),
		listRevisions(client, params.id, fields),
		loadLocalization(client, params.id, runs(plugins, PLUGIN.localization)),
		loadReview(client, params.id, runs(plugins, PLUGIN.review), user).then(async (r) =>
			r ? { ...r, people: await people } : null,
		),
		loadComments(client, params.id, people, tenant).catch(() => null),
		loadReleases(client, params.id).catch(() => null),
	]);

	const relations = await readRelationChoices(client, schemaDef.fields ?? []);

	// Published library files, for a media field's picker. Read only when
	// the schema has one. A read that fails is null, so the picker says the
	// library could not be read instead of claiming nothing is published.
	const mediaChoices: MediaChoice[] | null = schemaDef.fields.some((f) => f.field_type === 'media')
		? await listMediaChoices(client).catch(() => null)
		: [];

	const { revisions, hiddenOlder, windowDays, total: revisionTotal, failed: revisionsFailed, historyEnabled } =
		revisionList;
	return {
		schemaDef,
		item,
		relations,
		revisions,
		revisionTotal,
		revisionsFailed,
		revisionWindow: { hiddenOlder, windowDays },
		historyEnabled,
		// The history settings take an admin, so only an admin is pointed there.
		canManageHistory: (user?.roles ?? []).some((role) => role === 'admin' || role === 'super_admin'),
		localization,
		review,
		mediaChoices,
		comments,
		releases,
	};
};

/** Moves the entry to `status`, and returns `failed` when the engine refuses. */
async function setStatus(event: RequestEvent, status: 'published' | 'draft', failed: string) {
	await requireUser(event);
	const { params } = event;
	const client = authedClient(event);
	try {
		await client.put(`/api/admin/content/${encodeURIComponent(params.id)}`, { status });
	} catch (err) {
		return actionFailure(err, failed);
	}
	redirect(303, `/admin/content/${params.schema}/${params.id}`);
}

export const actions: Actions = {
	// Named, not default: SvelteKit rejects a default action on a page that also
	// declares named ones.
	save: async (event) => {
		await requireUser(event);
		const { request, params } = event;
		const client = authedClient(event);
		const form = await request.formData();
		const raw = form.get('data') as string;
		const m2mRaw = form.get('m2m_relations') as string | null;

		let links: Record<string, string[]> | null = null;
		try {
			const data = stripProtectedFields(JSON.parse(raw) as Record<string, unknown>);
			links = m2mRaw ? (JSON.parse(m2mRaw) as Record<string, string[]>) : null;
			// title is written twice on purpose. It is a column on the entry, and
			// the load overlays that column on top of body, so a title only in
			// body never reads back. It is also a field of the schema, and the
			// engine validates body against that schema, so a title only in the
			// column fails the required check and the whole write is refused.
			const { title } = data;
			await client.put(`/api/admin/content/${encodeURIComponent(params.id)}`, {
				...(typeof title === 'string' ? { title } : {}),
				body: data,
			});
		} catch (err) {
			// The fields the form shows are the schema's own, so a refusal names
			// them against the schema rather than against what the form sent.
			if (err instanceof ApiError && err.status === 422) {
				const schemaDef = await getSchema(params.schema, client).catch(() => null);
				const shown = (schemaDef?.fields ?? []).filter((f) => !f.system).map((f) => f.name);
				const refused = fieldRefusalOf(err, shown);
				if (refused) return fail(422, refused);
			}
			return actionFailure(err, 'Could not save the entry. Try again.');
		}

		// The entry is saved by now, so a refused link is reported as such
		// rather than as a failed save or a finished one.
		if (links) {
			const failed = await setEntryRelations(event, params.id, links);
			if (failed) return fail(400, { error: `Entry saved. ${failed}` });
		}
		redirect(303, `/admin/content/${params.schema}`);
	},

	publish: (event) => setStatus(event, 'published', 'Could not publish the entry. Try again.'),

	unpublish: (event) => setStatus(event, 'draft', 'Could not unpublish the entry. Try again.'),

	/**
	 * Write one locale's translation. The panel says whether the locale
	 * already holds a row, and the plugin has one route for each case: a PUT
	 * on a locale with no row answers 404, a POST on one that exists answers
	 * a conflict. A save keeps the row's status unless the form sets one, so
	 * editing an outdated translation leaves it outdated until it is marked.
	 */
	saveTranslation: async (event) => {
		await requireUser(event);
		const { request, params } = event;
		const client = authedClient(event);
		const form = await request.formData();
		const locale = String(form.get('locale') ?? '').trim();
		const exists = form.get('exists') === 'true';
		const status = form.get('translation_status');
		if (!locale) {
			return fail(400, { error: 'Choose a locale first.', translationLocale: locale });
		}
		try {
			const values = JSON.parse(String(form.get('data') ?? '{}')) as Record<string, unknown>;
			const input = {
				...translationInput(values),
				...(status === 'draft' || status === 'translated' || status === 'outdated'
					? { translation_status: status as TranslationStatus }
					: {}),
			};
			if (exists) {
				await updateTranslation(client, params.id, locale, input);
			} else {
				// The localization plugin refuses a new translation with no title,
				// so a title left empty saves the source title as it is now. The
				// panel says so beside the empty box.
				if (!input.title?.trim()) {
					const source = await client.get<{ title?: string }>(`/api/admin/content/${encodeURIComponent(params.id)}`);
					if (source?.title) input.title = source.title;
				}
				await createTranslation(client, params.id, locale, input);
			}
		} catch (err) {
			// A 402 is the locale ceiling or a license refusal, which carries
			// numbers and a link a bare relayed code would drop.
			const failed = actionFailure(err, 'Could not save the translation. Try again.');
			return fail(failed.status, { ...failed.data, translationLocale: locale });
		}
		redirect(303, `/admin/content/${params.schema}/${params.id}`);
	},

	/** Set one locale's translation to `translated` without touching its text. */
	markTranslated: async (event) => {
		await requireUser(event);
		const { request, params } = event;
		const client = authedClient(event);
		const form = await request.formData();
		const locale = String(form.get('locale') ?? '').trim();
		if (!locale) {
			return fail(400, { error: 'Choose a locale first.', translationLocale: locale });
		}
		try {
			await updateTranslation(client, params.id, locale, { translation_status: 'translated' });
		} catch (err) {
			const failed = actionFailure(err, 'Could not mark the translation as translated. Try again.');
			return fail(failed.status, { ...failed.data, translationLocale: locale });
		}
		redirect(303, `/admin/content/${params.schema}/${params.id}`);
	},

	/**
	 * Apply one transition to the entry's assignment. The engine's 403 is
	 * relayed with its status, so the bar can say the refusal is a permission
	 * rule or a stage role rather than a failed write. The bar offers every
	 * action the status takes and never guesses at the rules up front.
	 */
	reviewTransition: async (event) => {
		await requireUser(event);
		const { request, params } = event;
		const client = authedClient(event);
		const form = await request.formData();
		const assignmentId = String(form.get('assignment_id') ?? '').trim();
		const action = String(form.get('action') ?? '').trim();
		const comment = String(form.get('comment') ?? '').trim();
		if (!assignmentId || !isTransitionAction(action)) {
			return fail(400, { error: 'Choose an action first.', review: true, reviewStatus: 400 });
		}
		try {
			await transitionAssignment(client, assignmentId, action, comment);
		} catch (err) {
			const status = err instanceof ApiError ? err.status : 400;
			return fail(status === 403 ? 403 : 400, {
				error: actionError(err, 'Could not move the review. Try again.'),
				review: true,
				reviewStatus: status,
			});
		}
		redirect(303, `/admin/content/${params.schema}/${params.id}`);
	},

	/**
	 * Start the entry through a definition. The first assignee is the
	 * primary, and the others are sent beside it, which a quorum stage needs:
	 * the plugin refuses a start that names fewer assignees than a stage's
	 * quorum, and the bar shows that refusal.
	 */
	reviewStart: async (event) => {
		await requireUser(event);
		const { request, params } = event;
		const client = authedClient(event);
		const form = await request.formData();
		const definitionId = String(form.get('definition_id') ?? '').trim();
		const assigneeId = String(form.get('assignee_id') ?? '').trim();
		if (!definitionId || !assigneeId) {
			return fail(400, { error: 'Choose a definition and an assignee first.', review: true, reviewStatus: 400 });
		}
		// The picker posts one field per account and the typed fallback one
		// field of ids, by line or by comma. Both read the same way.
		const others = form
			.getAll('other_assignees')
			.flatMap((v) => String(v).split(/[\n,]/))
			.map((s) => s.trim())
			.filter((s) => s && s !== assigneeId);
		const assigneeIds = [assigneeId, ...new Set(others)];
		try {
			await createAssignment(client, {
				entry_id: params.id,
				definition_id: definitionId,
				assignee_id: assigneeId,
				assignee_ids: assigneeIds,
			});
		} catch (err) {
			const status = err instanceof ApiError ? err.status : 400;
			return fail(status === 403 ? 403 : 400, {
				error: actionError(err, 'Could not start the review. Try again.'),
				review: true,
				reviewStatus: status,
			});
		}
		redirect(303, `/admin/content/${params.schema}/${params.id}`);
	},

	/** Start a thread, or reply to one when the form names its first comment. */
	comment: async (event) => {
		await requireUser(event);
		const { request, params } = event;
		const form = await request.formData();
		const body = String(form.get('body') ?? '').trim();
		const parentId = String(form.get('parent_id') ?? '').trim();
		const mentions = form.getAll('mentions').map(String).filter(Boolean);
		if (!body) return fail(400, { error: 'Write the comment first.', comments: true });
		try {
			await createComment(authedClient(event), params.id, {
				body,
				mentions,
				...(parentId ? { parent_id: parentId } : {}),
			});
		} catch (err) {
			const failed = actionFailure(err, 'Could not post the comment. Try again.');
			return fail(failed.status, { ...failed.data, comments: true });
		}
		return { commented: true };
	},

	resolveThread: async (event) => {
		await requireUser(event);
		const { request, params } = event;
		const form = await request.formData();
		const commentId = String(form.get('comment_id') ?? '').trim();
		const resolved = String(form.get('resolved') ?? '') === 'true';
		if (!commentId) return fail(400, { error: 'This form is missing its thread. Reload the page and try again.', comments: true });
		try {
			await setThreadResolved(authedClient(event), params.id, commentId, resolved);
		} catch (err) {
			const failed = actionFailure(err, 'Could not update the thread. Try again.');
			return fail(failed.status, { ...failed.data, comments: true });
		}
		return { threadResolved: resolved };
	},

	addToRelease: async (event) => {
		await requireUser(event);
		const { request, params } = event;
		const form = await request.formData();
		const releaseId = String(form.get('release_id') ?? '').trim();
		const action = String(form.get('action') ?? '');
		if (!releaseId) return fail(400, { error: 'Choose a release first.', release: true });
		if (action !== 'publish' && action !== 'unpublish') {
			return fail(400, { error: 'Choose whether the release publishes or unpublishes this entry.', release: true });
		}
		try {
			await addReleaseItem(authedClient(event), releaseId, params.id, action);
		} catch (err) {
			const failed = actionFailure(err, 'Could not add the entry to the release. Try again.');
			return fail(failed.status, { ...failed.data, release: true });
		}
		return { addedToRelease: releaseId };
	},

	restore: async (event) => {
		await requireUser(event);
		const { request, params } = event;
		const client = authedClient(event);
		const data = await request.formData();
		// The rollback route names the revision by its sequence number under the
		// key `to_revision`. The row's uuid is not a number, and any other key
		// is one nothing reads, so either would refuse every restore.
		const toRevision = Number(data.get('rev_num') ?? 0);
		if (!Number.isInteger(toRevision) || toRevision <= 0) {
			return fail(400, { error: 'Choose a revision first.' });
		}
		try {
			await client.post(`/api/admin/content/${encodeURIComponent(params.id)}/rollback`, {
				to_revision: toRevision,
			});
		} catch (err) {
			// A revision older than the window this install reads answers 402,
			// and the history panel renders it.
			const failed = actionFailure(err, 'Could not restore the revision. Try again.');
			return fail(failed.status, { ...failed.data, revision: true });
		}
		redirect(303, `/admin/content/${params.schema}/${params.id}`);
	},

	/**
	 * Open one revision by number. The history panel offers the revision just
	 * older than the oldest it lists, and the plugin answers 402 when that one
	 * is outside the window this install reads.
	 */
	openRevision: async (event) => {
		await requireUser(event);
		const { request, params } = event;
		const form = await request.formData();
		const num = Number(form.get('rev_num') ?? 0);
		if (!Number.isInteger(num) || num <= 0) {
			return fail(400, { error: 'Choose a revision first.', revision: true });
		}
		const client = authedClient(event);
		let raw: Record<string, unknown>;
		try {
			raw = await client.get<Record<string, unknown>>(
				`/api/admin/content/${encodeURIComponent(params.id)}/revisions/${num}`,
			);
		} catch (err) {
			const failed = actionFailure(err, 'Could not open the revision. Try again.');
			return fail(failed.status, { ...failed.data, revision: true });
		}
		// Without the schema the revision still opens, with its plain values.
		const fields = await getSchema(params.schema, client).then((s) => s.fields ?? [], () => []);
		return { openedRevision: toEditorRevision(raw, fields, exactParse(raw) as Record<string, unknown> | undefined) };
	},
};