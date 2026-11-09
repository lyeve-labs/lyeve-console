import { getSchemas } from '@lyeve-labs/client-rest';
import type { authedClient } from '$lib/server/authz';
import { listTemplates, type ImportSchema, type MappingTemplate } from '$lib/api/bulk-import';
import { type Gate, section, type Section } from '$lib/api/gate';
import { couldNotLoad } from '$lib/outage';

type Client = ReturnType<typeof authedClient>;

/**
 * The content types an import fills. An unread list is kept as a failure,
 * so the wizard and the template drawer say why they offer none rather than
 * offering nothing.
 */
export function readSchemas(client: Client): Promise<Section<ImportSchema[]>> {
	return section(
		getSchemas(client).then((rows) =>
			rows
				.map((s) => ({
					name: s.name,
					fields: (s.fields ?? []).map((f) => ({
						name: f.name,
						field_type: f.field_type,
						system: (f as { system?: boolean }).system,
					})),
				}))
				.sort((a, b) => a.name.localeCompare(b.name)),
		),
		couldNotLoad('content types'),
	);
}

/** The tenant's saved mappings, and whether this install may save one or name a paid transform. */
export interface TemplatesRead {
	rows: MappingTemplate[];
	/** False when the read failed, which never reads as having none. */
	read: boolean;
	licensed: boolean | null;
	/** Why the read failed, so a role refusal, a lapsed license and an outage each read as what they are. */
	gate: Gate | null;
}

export async function readTemplates(client: Client): Promise<TemplatesRead> {
	const read = await section(listTemplates(client), couldNotLoad('templates'));
	return read.ok
		? {
				rows: read.value?.templates ?? [],
				read: true,
				licensed: typeof read.value?.licensed === 'boolean' ? read.value.licensed : null,
				gate: null,
			}
		: { rows: [], read: false, licensed: null, gate: read.gate };
}
