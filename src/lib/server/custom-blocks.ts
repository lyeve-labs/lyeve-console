import type { HttpClient } from '@lyeve-labs/client';
import type { Block, EntryRow, ResolvedBlock } from '$lib/api/customization';
import { rowsOf, type ListEnvelope } from '$lib/api/list';
import { UNTITLED } from '$lib/utils/new-entry';

async function contentRows(client: HttpClient, b: Block): Promise<EntryRow[] | null> {
	const params = new URLSearchParams({ schema: b.schema ?? '', limit: String(b.limit ?? 5), offset: '0' });
	if (b.status) params.set('status', b.status);
	try {
		const rows = rowsOf(await client.get<ListEnvelope<Partial<EntryRow>> | Partial<EntryRow>[]>(`/api/admin/content?${params}`));
		return rows.map((r) => ({
			id: String(r.id ?? ''),
			title: r.title || UNTITLED,
			status: r.status ?? '',
			updated_at: r.updated_at ?? '',
		}));
	} catch {
		return null;
	}
}

async function schemaRows(client: HttpClient, schema: string): Promise<number | null> {
	try {
		const res = await client.get<{ rows?: number }>(`/api/admin/schemas/${encodeURIComponent(schema)}/stats`);
		return typeof res.rows === 'number' ? res.rows : null;
	} catch {
		return null;
	}
}

/**
 * Reads what each block of a custom page shows, with the viewer's own
 * session: a block never shows an entry the viewer could not open.
 */
export async function resolveBlocks(client: HttpClient, blocks: Block[]): Promise<ResolvedBlock[]> {
	return Promise.all(
		blocks.map(async (b): Promise<ResolvedBlock> => {
			if (b.type === 'content') return { ...b, type: 'content', entries: await contentRows(client, b) };
			if (b.type === 'stats') {
				const counts = await Promise.all(
					(b.schemas ?? []).map(async (schema) => ({ schema, rows: await schemaRows(client, schema) })),
				);
				return { ...b, type: 'stats', counts };
			}
			return b as ResolvedBlock;
		}),
	);
}
