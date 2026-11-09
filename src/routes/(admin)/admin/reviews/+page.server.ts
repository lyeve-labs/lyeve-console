import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { authedClient } from '$lib/server/authz';
import { PLUGIN } from '$lib/plugin-names';
import { notRunning } from '$lib/plugins';
import { section, type Section } from '$lib/api/gate';
import { pageOffset, pageNumber, pastEndOffset, withOffset } from '$lib/api/list';
import { couldNotLoad } from '$lib/outage';
import { entryTitle } from '$lib/utils/entry-identity';
import { listAssignments, REVIEW_STATUSES, type ReviewAssignment } from '$lib/api/review';
import { DEFINITIONS_FAILED, OPERATORS, loadDefinitions, loadPeople, type DefinitionRow } from './reads.server';

/** The engine's page size for the assignment list. */
const LIMIT = 50;

/** What the page renders. */
export type ReviewsPage = {
	operator: boolean;
	/**
	 * The definitions with their stages, which name each assignment's
	 * definition and stage and link its entry. Read for an operator only.
	 */
	definitions: Section<DefinitionRow[]>;
	assignments: Section<ReviewAssignment[]>;
	total: number;
	offset: number;
	limit: number;
	status: string;
	/** Each listed entry's title by its id. An entry the read missed is absent. */
	entries: Record<string, string>;
	/**
	 * Whether the titles were read at all. The content routes that hold them
	 * admit an operator only, so another reviewer's queue lists entries by id.
	 */
	entriesNamed: boolean;
	/** Each account's email by its id. An account the read missed is absent. */
	people: Record<string, string>;
};

const ASSIGNMENTS_FAILED = couldNotLoad('review assignments');

/**
 * The title each listed entry is known by. The assignment list carries only
 * the entry id, and a page holds at most LIMIT of them, so each is read once.
 * An entry the caller may not read, or one since deleted, keeps its id.
 */
async function loadEntryTitles(
	client: ReturnType<typeof authedClient>,
	ids: string[],
): Promise<Record<string, string>> {
	const named = await Promise.all(
		[...new Set(ids)].map(async (id) => {
			const entry = await client
				.get<{ title?: unknown; slug?: unknown; body?: unknown }>(`/api/admin/content/${encodeURIComponent(id)}`)
				.catch(() => null);
			if (!entry) return null;
			const data = entry.body && typeof entry.body === 'object' ? (entry.body as Record<string, unknown>) : undefined;
			const { label } = entryTitle({ id, title: entry.title, slug: entry.slug, data });
			return label ? ([id, label] as const) : null;
		}),
	);
	return Object.fromEntries(named.filter((n) => n !== null));
}

export const load: PageServerLoad = async (event) => {
	const { user, plugins } = await event.parent();
	const operator = user.roles.some((role) => OPERATORS.includes(role));
	const status = event.url.searchParams.get('status') ?? '';
	// The pager counts in pages, so an offset between two boundaries snaps
	// down onto the page that holds it.
	const offset = pageOffset(pageNumber(Math.max(0, Number(event.url.searchParams.get('offset')) || 0), LIMIT), LIMIT);
	const none: Section<never[]> = { ok: true, value: [] };
	const page: ReviewsPage = {
		operator,
		definitions: none,
		assignments: none,
		total: 0,
		offset,
		limit: LIMIT,
		status: (REVIEW_STATUSES as readonly string[]).includes(status) ? status : '',
		entries: {},
		entriesNamed: operator,
		people: {},
	};
	// The shell says why the page is unavailable while its plugin does not run.
	if (notRunning(plugins, PLUGIN.review)) return page;

	const client = authedClient(event);
	const [definitions, assignments, people] = await Promise.all([
		operator
			? section(
					loadDefinitions(client).then(({ rows }) => rows),
					DEFINITIONS_FAILED,
				)
			: Promise.resolve<Section<DefinitionRow[]>>(none),
		section(listAssignments(client, { status: page.status || undefined, limit: LIMIT, offset }), ASSIGNMENTS_FAILED),
		loadPeople(client, user, operator),
	]);

	if (assignments.ok) {
		const rows = assignments.value.items;
		const back = pastEndOffset(rows.length, LIMIT, offset, assignments.value.total);
		if (back !== null) redirect(307, withOffset(event.url, back));
		page.assignments = { ok: true, value: rows };
		page.total = Math.max(assignments.value.total, offset + rows.length);
		// Titles come from the content routes, which refuse every role but an
		// operator. Asking for them on another reader's behalf would only
		// collect a refusal per row.
		if (operator) page.entries = await loadEntryTitles(client, rows.map((a) => a.entry_id));
	} else {
		page.assignments = assignments;
	}
	page.definitions = definitions;
	page.people = people;
	return page;
};
