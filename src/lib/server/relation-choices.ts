/**
 * The entries a relation field offers, read from the admin listing.
 *
 * The picker is fed one page of the related collection. A collection larger
 * than that page is cut, and a picker that says nothing about it reads as the
 * whole collection. A read that failed is not a collection with no entries, so
 * each read says which of the three it was.
 */
import type { HttpClient, Schema, SchemaField } from '@lyeve-labs/client';
import { getSchema } from '@lyeve-labs/client-rest';
import type { RelationChoices } from '$lib/components/content/relation-choices';
import { entryTitle, shortId } from '$lib/utils/entry-identity';

/** The most entries a picker is fed. The listing serves no more in one page. */
export const RELATION_PAGE = 500;

type ListedRow = { id: string; title?: string; body?: Record<string, unknown> };

/**
 * The related type's fields an assistant may read, or null when it marks
 * none. A type that cannot be read counts as marking every field, so its
 * entries reach the assistant by short id.
 */
async function unmarkedFields(client: HttpClient, schema: string): Promise<SchemaField[] | null> {
	const def = await getSchema(schema, client).catch((): Schema | null => null);
	const fields = def?.fields ?? [];
	if (def && !fields.some((f) => f.no_ai || f.private)) return null;
	return fields.filter((f) => !f.no_ai && !f.private);
}

/**
 * An entry's name from the fields the type does not mark, else its short id.
 * The title and slug columns are skipped, because either can be derived from
 * a marked field, and so is a slug field the editor may have derived.
 */
function assistantLabel(row: ListedRow, fields: SchemaField[]): string {
	const data = Object.fromEntries(
		fields.filter((f) => f.name !== 'slug' && row.body && f.name in row.body).map((f) => [f.name, row.body?.[f.name]]),
	);
	return entryTitle({ id: row.id, data }, fields).label || shortId(row.id);
}

async function readOne(client: HttpClient, schema: string): Promise<RelationChoices> {
	try {
		const query = new URLSearchParams({ schema, limit: String(RELATION_PAGE), offset: '0' });
		const [body, unmarked] = await Promise.all([
			client.get<{ data?: ListedRow[]; total_count?: number }>(`/api/admin/content?${query}`),
			unmarkedFields(client, schema),
		]);
		const rows = body.data ?? [];
		const items = rows.map((e) => ({
			id: e.id,
			schema_name: schema,
			created_at: '',
			updated_at: '',
			data: { title: e.title ?? '' },
		}));
		const counted = typeof body.total_count === 'number' ? body.total_count : items.length;
		return {
			items,
			total: Math.max(counted, items.length),
			failed: false,
			...(unmarked ? { assistantLabels: Object.fromEntries(rows.map((e) => [e.id, assistantLabel(e, unmarked)])) } : {}),
		};
	} catch {
		return { items: [], total: 0, failed: true };
	}
}

/** One read per related collection the fields point at, keyed by its name. */
export async function readRelationChoices(
	client: HttpClient,
	fields: SchemaField[],
): Promise<Record<string, RelationChoices>> {
	const names = [
		...new Set(
			fields
				.filter((f) => f.field_type === 'relation' && f.relation_to)
				.map((f) => f.relation_to as string),
		),
	];
	const reads = await Promise.all(names.map((name) => readOne(client, name)));
	return Object.fromEntries(names.map((name, i) => [name, reads[i]]));
}
