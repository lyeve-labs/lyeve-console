import type { authedClient } from '$lib/server/authz';
import { listPeople } from '$lib/server/people';
import { couldNotLoad } from '$lib/outage';
import { getDefinition, listDefinitions, type ReviewDefinition, type ReviewLimits, type ReviewStage } from '$lib/api/review';

/** A definition and its stages. Stages are null when their read failed, which is never a definition with none. */
export type DefinitionRow = { definition: ReviewDefinition; stages: ReviewStage[] | null };

/** The roles that may read and write the definitions. */
export const OPERATORS = ['admin', 'super_admin'];

export const DEFINITIONS_FAILED = couldNotLoad('review definitions');

/**
 * The definitions with their stages. The list route answers the definition
 * rows alone and the stages come one definition at a time. A tenant holds a
 * handful, so the reads run together.
 */
export async function loadDefinitions(
	client: ReturnType<typeof authedClient>,
): Promise<{ rows: DefinitionRow[]; limits: ReviewLimits | null }> {
	const { items, limits } = await listDefinitions(client, 100, 0);
	const rows = await Promise.all(
		items.map((definition) =>
			getDefinition(client, definition.id).catch((): DefinitionRow => ({ definition, stages: null })),
		),
	);
	return { rows, limits };
}

/**
 * Each account's email by its id. The directory is an operator's to read, so
 * another reviewer sees their own email and the ids of everyone else.
 */
export async function loadPeople(
	client: ReturnType<typeof authedClient>,
	user: { id: string; email?: string },
	operator: boolean,
): Promise<Record<string, string>> {
	const people = operator ? await listPeople(client) : [];
	return Object.fromEntries([
		...people.map((p) => [p.id, p.email] as const),
		...(user.email ? [[user.id, user.email] as const] : []),
	]);
}
