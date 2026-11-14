/*
 * The loaders of the content entry editor's side panels: translations,
 * review, comments and releases. Each returns null when its panel does not
 * render.
 */

import { ApiError, type HttpClient } from '@lyeve-labs/client';
import { listComments, type EntryComment } from '$lib/api/content-comments';
import { editable, listReleases, type Release } from '$lib/api/content-releases';
import { rowsOf } from '$lib/api/list';
import { getLocales, listTranslations, type LocalePreferences, type Translation } from '$lib/api/localization';
import {
	getAssignmentByEntry,
	getStageSLA,
	listDefinitions,
	type ReviewAssignment,
	type ReviewDefinition,
	type StageSLA,
} from '$lib/api/review';
import { listTenantPeople, type Person } from '$lib/server/people';

/**
 * What the Translations panel renders, or null when it does not render.
 *
 * The panel exists only while the localization plugin runs: without it the
 * routes are refused and a panel over them would be a row of refusals. A
 * plugin that runs but is not answering is `unavailable`, which the panel
 * says in one line rather than hiding.
 */
type EntryLocalization = {
	locales: LocalePreferences;
	translations: Translation[];
	unavailable: boolean;
};

export async function loadLocalization(
	client: HttpClient,
	entryId: string,
	running: boolean,
): Promise<EntryLocalization | null> {
	if (!running) return null;
	try {
		const [locales, translations] = await Promise.all([
			getLocales(client),
			listTranslations(client, entryId),
		]);
		return { locales, translations, unavailable: false };
	} catch {
		return {
			locales: { default_locale: '', enabled_locales: [], fallback_chain: [] },
			translations: [],
			unavailable: true,
		};
	}
}

/**
 * What the review bar renders, or null when the review plugin does not run.
 *
 * Without it the routes are 404 and a bar over them would offer actions that
 * cannot land. The assignment read is a 404 for an entry under no review and a 403
 * for a caller the permission rules refuse, and the two are told apart: one
 * is a bar that can start a review, the other is a bar that says so.
 */
export type EntryReview = {
	assignment: ReviewAssignment | null;
	stages: StageSLA[];
	definitions: ReviewDefinition[];
	/** Approvals the current stage needs before it moves, 1 for a single approval. */
	approvalsNeeded: number;
	userId: string;
	/** The accounts a review can be handed to. Empty for a caller who may not list them. */
	people: Person[];
	unavailable: boolean;
	forbidden: boolean;
	/** The definitions read failed, so the bar cannot offer to start a review. */
	definitionsFailed: boolean;
};

const REVIEW_NONE = (userId: string): EntryReview => ({
	assignment: null,
	stages: [],
	definitions: [],
	approvalsNeeded: 1,
	userId,
	people: [],
	unavailable: false,
	forbidden: false,
	definitionsFailed: false,
});

export async function loadReview(
	client: HttpClient,
	entryId: string,
	running: boolean,
	user: { id: string; roles: string[] },
): Promise<EntryReview | null> {
	if (!running) return null;
	const base = REVIEW_NONE(user.id);
	// Definitions are admin-only. An assignment is started from the bar, so
	// the list is read for a caller who may start one and left empty for the
	// rest, whose bar shows the review and its actions alone.
	const canStart = user.roles.includes('admin') || user.roles.includes('super_admin');
	const definitions = canStart
		? listDefinitions(client).then(
				(r) => ({ items: r.items, failed: false }),
				() => ({ items: [] as ReviewDefinition[], failed: true }),
			)
		: Promise.resolve({ items: [] as ReviewDefinition[], failed: false });
	try {
		// The entry's read carries the assignees, the approvals and the quorum
		// of the current stage, so the bar's counts come from one read.
		const assignment = await getAssignmentByEntry(client, entryId);
		const stages = await getStageSLA(client, assignment.id).catch((): StageSLA[] => []);
		return {
			...base,
			assignment,
			approvalsNeeded: assignment.required_approvals,
			stages,
			definitions: (await definitions).items,
		};
	} catch (err) {
		if (err instanceof ApiError && err.status === 404) {
			const read = await definitions;
			return { ...base, definitions: read.items, definitionsFailed: read.failed };
		}
		if (err instanceof ApiError && err.status === 403) {
			return { ...base, forbidden: true };
		}
		return { ...base, unavailable: true };
	}
}

/**
 * The entry's editorial threads, or null when the build serves none. A read
 * that failed is said so, never drawn as an entry nobody has commented on.
 */
type EntryComments = {
	threads: EntryComment[];
	/** Every account the directory names, so an author reads by email. */
	people: { id: string; email: string }[];
	/** The accounts a comment can mention. */
	mentionable: { id: string; email: string }[];
	unavailable: boolean;
};

export async function loadComments(
	client: HttpClient,
	entryId: string,
	people: Promise<Person[]>,
	tenant: Promise<string>,
	tenancy: boolean,
): Promise<EntryComments | null> {
	// Accounts to mention. A caller who may not list them comments without
	// mentions. The engine mails only accounts of the entry's own tenant and
	// refuses the comment for anyone else, so only those are offered. The
	// directory is one page of every tenant's accounts, so while the tenancy
	// plugin runs the entry's tenant is read from it instead. Without the
	// plugin the instance has one tenant, and the directory page is its own.
	const directory = async () => {
		const [all, own] = await Promise.all([people, tenant]);
		if (!tenancy) return { people: all, mentionable: all.filter((p) => p.tenant_id === own) };
		const mentionable = own ? await listTenantPeople(client, own) : [];
		const named = new Set(all.map((p) => p.id));
		return { people: [...all, ...mentionable.filter((p) => !named.has(p.id))], mentionable };
	};
	try {
		const threads = await listComments(client, entryId, 'all');
		return { threads, ...(await directory()), unavailable: false };
	} catch (err) {
		if (err instanceof ApiError && err.status === 404) return null;
		return { threads: [], ...(await directory()), unavailable: true };
	}
}

/**
 * The releases this entry can join, and the ones it is already in. Null
 * when the build serves no releases.
 */
type EntryReleases = {
	open: Pick<Release, 'id' | 'name' | 'status'>[];
	holding: string[];
	/** The releases could not be read, so the card offers none. */
	failed: boolean;
};

export async function loadReleases(client: HttpClient, entryId: string): Promise<EntryReleases | null> {
	try {
		const res = await listReleases(client, '', 100, 0);
		const open = rowsOf(res).filter(editable);
		// The list carries no items, so membership is read from each open
		// release. A release whose items could not be read is not one that
		// leaves the entry out, so one failed read leaves the card unread.
		const reads = await Promise.all(
			open.map((r) =>
				client
					.get<Release>(`/api/admin/content/releases/${encodeURIComponent(r.id)}`)
					.then((full) => ((full.items ?? []).some((it) => it.entry_id === entryId) ? r.id : null))
					.catch(() => undefined),
			),
		);
		if (reads.includes(undefined)) return { open: [], holding: [], failed: true };
		const holding = reads.filter((id): id is string => typeof id === 'string');
		return { open: open.map((r) => ({ id: r.id, name: r.name, status: r.status })), holding, failed: false };
	} catch (err) {
		if (err instanceof ApiError && err.status === 404) return null;
		return { open: [], holding: [], failed: true };
	}
}
