/**
 * The schema presets the schema plugin ships: a named set of content types
 * created together, offered where the schema builder has nothing yet.
 */

import type { HttpClient, SchemaField } from '@lyeve-labs/client';

const BASE = '/api/admin/schemas/presets';

export interface PresetSchema {
	name: string;
	display_name?: string;
	fields: SchemaField[];
}

export interface SchemaPreset {
	id: string;
	name: string;
	description: string;
	schemas: PresetSchema[];
	/** builtin ships with the binary. Saved is one this tenant kept. */
	source?: 'builtin' | 'saved';
	/** Where a saved preset was read from, so it can be read again. */
	source_url?: string;
	updated_at?: string;
}

export interface PresetResult {
	created: string[];
}

/**
 * The catalog and whether this instance would accept a saved preset. The
 * plugin says so itself, so the page offers the form only where it works.
 */
export async function readSchemaPresets(client: HttpClient): Promise<{ presets: SchemaPreset[]; canSave: boolean }> {
	const res = await client.get<{ presets?: SchemaPreset[]; can_save?: boolean } | null>(BASE);
	return { presets: Array.isArray(res?.presets) ? res.presets : [], canSave: res?.can_save === true };
}

/** Creates every schema the preset names. The plugin refuses when one exists. */
export function applySchemaPreset(client: HttpClient, id: string): Promise<PresetResult> {
	return client.post<PresetResult>(`${BASE}/${encodeURIComponent(id)}`, {});
}

/**
 * Creates the content types a preset document names, once, without keeping
 * the preset. The document is the text of a JSON or YAML file. The plugin
 * refuses the whole document when one of its content types exists.
 */
export function importSchemaPreset(client: HttpClient, document: string): Promise<PresetResult> {
	return client.post<PresetResult>(`${BASE}/import`, { document });
}

/** Keeps a preset read from a URL, or from a pasted JSON or YAML document. */
export function saveSchemaPreset(client: HttpClient, from: { url: string } | { document: string }): Promise<SchemaPreset> {
	return client.post<SchemaPreset>(BASE, from);
}

/** Removes a saved preset. A built-in one is refused. */
export function deleteSchemaPreset(client: HttpClient, id: string): Promise<void> {
	return client.delete<void>(`${BASE}/${encodeURIComponent(id)}`);
}
