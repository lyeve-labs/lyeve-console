import type { Actions, PageServerLoad } from './$types';
import { fail } from '@sveltejs/kit';
import { ApiError } from '@lyeve-labs/client';
import { getSchemas } from '@lyeve-labs/client-rest';
import { authedClient, requireRole } from '$lib/server/authz';
import { actionFailure } from '$lib/server/action-error';
import { section } from '$lib/api/gate';
import {
	HISTORY_MODES,
	MAX_KEEP_DAYS,
	MAX_KEEP_VERSIONS,
	deleteTypeHistory,
	pruneHistory,
	readHistorySettings,
	readHistoryUsage,
	readsOlderVersions,
	saveHistorySettings,
	type HistoryMode,
	type HistorySettings,
} from '$lib/api/content-history';
import { asked } from '$lib/server/asked';

/** The roles the plugin lets change history settings. */
const EDITORS = ['admin', 'super_admin'];

export const load: PageServerLoad = async (event) => {
	const client = authedClient(event);
	const { entitlements } = await event.parent();
	const [settings, usage, schemas] = await Promise.all([
		section(
			readHistorySettings(client),
			'Could not load content history settings.',
		),
		section(readHistoryUsage(client), 'Could not load content history storage.'),
		section(
			getSchemas(client).then((rows) => rows.map((s) => ({ name: s.name, label: s.display_name || s.name }))),
			'Could not load content types.',
		),
	]);
	return { settings, usage, schemas, readsOlder: readsOlderVersions(entitlements) };
};

/** A whole number from 0 to `max`, or null for anything else. */
function wholeUpTo(raw: string, max: number): number | null {
	const text = raw.trim();
	if (!/^\d+$/.test(text)) return null;
	const n = Number(text);
	return n <= max ? n : null;
}

/**
 * The changes the form posted. A control the environment fixes posts nothing,
 * so its field stays out of the write and the plugin never answers 409 for a
 * value the reader could not change.
 */
function readChanges(form: FormData): { changes: Partial<HistorySettings>; fields: Record<string, string> } {
	const changes: Partial<HistorySettings> = {};
	const fields: Record<string, string> = {};

	const mode = form.get('history_mode');
	if (mode !== null) {
		const known = HISTORY_MODES.find((m) => m === mode);
		if (known) changes.history_mode = known as HistoryMode;
		else fields.history_mode = 'Choose Off, All types or Selected types.';
	}
	if (form.get('schemas_sent') !== null) {
		changes.schemas = form.getAll('schemas').map(String).filter(Boolean);
		if (changes.history_mode === 'selected' && changes.schemas.length === 0) {
			fields.schemas = 'Choose at least one content type, or keep history for all types.';
		}
	}
	const numbers: [keyof HistorySettings & ('keep_days' | 'keep_versions' | 'activity_keep_days'), number, string][] = [
		['keep_days', MAX_KEEP_DAYS, `Enter a whole number of days from 1 to ${MAX_KEEP_DAYS}.`],
		['keep_versions', MAX_KEEP_VERSIONS, `Enter a whole number of versions from 1 to ${MAX_KEEP_VERSIONS}.`],
		['activity_keep_days', MAX_KEEP_DAYS, `Enter a whole number of days from 1 to ${MAX_KEEP_DAYS}.`],
	];
	for (const [key, max, message] of numbers) {
		const raw = form.get(key);
		if (raw === null) continue;
		const n = wholeUpTo(String(raw), max);
		if (n === null) fields[key] = message;
		else changes[key] = n;
	}
	const activity = form.get('activity');
	if (activity !== null) {
		if (activity === 'on' || activity === 'off') changes.activity_enabled = activity === 'on';
		else fields.activity_enabled = 'Choose On or Off.';
	}
	return { changes, fields };
}

export const actions: Actions = {
	save: async (event) => {
		await requireRole(event, EDITORS);
		const { changes, fields } = readChanges(await event.request.formData());
		if (Object.keys(fields).length > 0) return fail(400, { action: 'save', error: 'Check the highlighted fields.', fields });
		// Nothing changed, so nothing is written.
		if (Object.keys(changes).length === 0) return { action: 'save', saved: true };
		try {
			await saveHistorySettings(authedClient(event), changes);
			return { action: 'save', saved: true };
		} catch (err) {
			// The environment changed after the page was read and now fixes a
			// field this form still offered.
			if (err instanceof ApiError && err.status === 409) {
				return fail(409, {
					action: 'save',
					error: 'An environment variable now sets one of the settings you changed. Nothing was saved. Reload the page to see the current values.',
				});
			}
			const failed = actionFailure(err, 'Could not save content history settings. Try again.');
			return fail(failed.status, { action: 'save', ...failed.data });
		}
	},

	prune: async (event) => {
		await requireRole(event, EDITORS);
		try {
			const pruned = await pruneHistory(authedClient(event));
			return { action: 'prune', pruned };
		} catch (err) {
			const failed = actionFailure(err, 'Could not run retention. Nothing was removed. Try again.');
			return fail(failed.status, { action: 'prune', ...failed.data });
		}
	},

	deleteType: asked(
		{
			question: 'Delete every version of this content type?',
			detail: 'The entries stay as they are. Their stored versions cannot be recovered.',
			label: 'Delete',
		},
		async (event) => {
			await requireRole(event, EDITORS);
			const schema = String((await event.request.formData()).get('schema') ?? '').trim();
			if (!schema) return fail(400, { action: 'deleteType', error: 'Choose a content type first.' });
			try {
				const { commits, held } = await deleteTypeHistory(authedClient(event), schema);
				return { action: 'deleteType', deleted: schema, commits, held };
			} catch (err) {
				const failed = actionFailure(err, 'Could not delete the history. Nothing was removed. Try again.');
				return fail(failed.status, { action: 'deleteType', ...failed.data });
			}
		},
	),
};
