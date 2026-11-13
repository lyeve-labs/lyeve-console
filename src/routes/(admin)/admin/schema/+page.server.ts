import type { Actions, PageServerLoad } from './$types';
import { fail } from '@sveltejs/kit';
import { ApiError, type Schema, type HttpClient } from '@lyeve-labs/client';
import { getSchemas, getSchemaStats } from '@lyeve-labs/client-rest';
import { authedClient, authedHeaders, loadUser, requireRole } from '$lib/server/authz';
import { actionError } from '$lib/server/action-error';
import { retryBusy } from '$lib/server/retry-busy';
import { bundleContentType, readImportForm } from '$lib/server/flow-import';
import { IMPORT_SOURCES } from './import-sources';
import { applySchemaPreset, deleteSchemaPreset, importSchemaPreset, readSchemaPresets, saveSchemaPreset, type SchemaPreset } from '$lib/api/schema-preset-catalog';
import { NO_CANVAS, parsePositions, readCanvasLayout, saveCanvasLayout, type CanvasLayout } from '$lib/api/schema-canvas-layout';
import { refusalOf, refusalText } from '$lib/api/refusal';
import { section, type Gate } from '$lib/api/gate';

/**
 * The page renders in the browser only. Its diagram editor then never
 * enters the server build, and the server answers with the page's data alone.
 */
export const ssr = false;

/** Every schema write the engine serves takes one of these. */
const WRITERS = ['admin', 'super_admin'];

/** The most a preset file may hold. The engine refuses a larger body. */
const PRESET_FILE_LIMIT = 1024 * 1024;

/**
 * One statement a save would run. `destructive` marks one the save queues
 * instead of running, because it drops data: it waits in History until a
 * super admin applies it.
 */
export type DryRunStatement = { description: string; sql: string; down_sql?: string; destructive?: boolean };

/** One statement the engine recorded for a table, as GET .../history answers it. */
export type HistoryEntry = {
	version: number;
	description: string;
	up_sql: string;
	down_sql?: string;
	state: 'applied' | 'pending' | 'failed' | 'canceled';
	applied_at?: string;
	applied_by?: string;
	/** The tenant whose save wrote the entry. Absent when the engine does not record it. */
	tenant?: string;
	canceled_at?: string;
	created_at: string;
};

/** The import plan the engine answers before anything is applied. */
export type ImportPlan = {
	schemas: { name: string; action: 'create' | 'update' | 'unchanged'; ddl?: string[]; dependencies?: string[]; missing?: string[] }[];
	second_pass?: string[];
};


/**
 * How many stats calls run at once. One per schema all together would open as
 * many requests as a tenant has schemas before the page could paint.
 */
const STATS_CONCURRENCY = 8;

async function countRows(schemas: Schema[], client: HttpClient): Promise<Record<string, number>> {
	const out: Record<string, number> = {};
	let next = 0;
	async function worker() {
		while (next < schemas.length) {
			const s = schemas[next++];
			try {
				out[s.name] = (await getSchemaStats(s.name, client)).rows;
			} catch {
				// A count that could not be read is left out rather than shown as 0.
			}
		}
	}
	await Promise.all(Array.from({ length: Math.min(STATS_CONCURRENCY, schemas.length) }, worker));
	return out;
}

export const load: PageServerLoad = async (event) => {
	const user = await loadUser(event);
	const client = authedClient(event);
	const canWrite = (user?.roles ?? []).some((r: string) => WRITERS.includes(r));
	const isSuperAdmin = (user?.roles ?? []).includes('super_admin');

	// A failed read is said as one, not drawn as an instance with no schemas:
	// the empty state offers to create the first one, and a table the engine
	// could not list is not a table that is not there.
	const read = await section(getSchemas(client), 'Could not load content types.');
	if (!read.ok) {
		return {
			schemas: [] as Schema[],
			rowCounts: Promise.resolve({} as Record<string, number>),
			presets: [] as SchemaPreset[],
			presetsGate: null as Gate | null,
			canSavePresets: false,
			canvas: NO_CANVAS as CanvasLayout,
			// The canvas draws the schemas, so it says the same failure rather
			// than a license that leaves it out.
			canvasGate: read.gate as Gate | null,
			canWrite,
			isSuperAdmin,
			loadGate: read.gate as Gate | null,
		};
	}
	const schemas = read.value;

	// The presets and the canvas layout are served to an admin only, and the
	// page offers neither to another role. Reading them for an editor would
	// only collect a refusal.
	//
	// The presets are an offer, not the page: an install that has none, or
	// cannot list them, still edits the schemas it has. The refusal is kept so
	// the picker can say why it is empty rather than claim there are none.
	let presets: SchemaPreset[] = [];
	let presetsGate: Gate | null = null;
	let canSavePresets = false;
	if (canWrite) {
		const offered = await section(readSchemaPresets(client), 'Could not load presets.');
		if (offered.ok) ({ presets, canSave: canSavePresets } = offered.value);
		else presetsGate = offered.gate;
	}

	// Streamed: the list paints with the definitions, and the counts arrive
	// after it. Nothing on the page waits on them but the row figures.
	const rowCounts = countRows(schemas, client);

	// The plugin says whether this install draws the canvas, with the layout
	// it saved. A read that fails keeps its gate, so an outage or a refusal is
	// never drawn as a license that leaves the canvas out. The layout route
	// admits an admin only, so another role is told so without asking.
	let canvas: CanvasLayout = NO_CANVAS;
	let canvasGate: Gate | null = { state: 'forbidden' };
	if (canWrite) {
		const layout = await section(readCanvasLayout(client), 'Could not load the canvas layout.');
		if (layout.ok) {
			canvas = layout.value;
			canvasGate = null;
		} else {
			canvasGate = layout.gate;
		}
	}

	return {
		schemas,
		rowCounts,
		presets,
		presetsGate,
		canSavePresets,
		canvas,
		canvasGate,
		canWrite,
		isSuperAdmin,
		loadGate: null as Gate | null,
	};
};

function parseSchema(raw: FormDataEntryValue | null): Schema | null {
	try {
		const s = JSON.parse(String(raw ?? '')) as Schema;
		return s && typeof s.name === 'string' && Array.isArray(s.fields) ? s : null;
	} catch {
		return null;
	}
}

function parseRenames(raw: FormDataEntryValue | null): { from: string; to: string }[] {
	try {
		const list = JSON.parse(String(raw ?? '[]')) as unknown;
		if (!Array.isArray(list)) return [];
		return list.filter(
			(r): r is { from: string; to: string } =>
				!!r && typeof r.from === 'string' && typeof r.to === 'string' && r.from !== '' && r.to !== '' && r.from !== r.to,
		);
	} catch {
		return [];
	}
}

/** The status to answer a failed write with: the engine's, when it is a refusal of the request. */
const statusOf = (err: unknown) => (err instanceof ApiError && err.status >= 400 && err.status < 600 ? err.status : 400);

const path = (...parts: string[]) => parts.map(encodeURIComponent).join('/');

/**
 * The code the engine refuses a write with when the content type is no longer
 * at the version the write names: someone saved it after the builder opened it.
 */
const VERSION_MISMATCH = 'SCHEMA_VERSION_MISMATCH';

/** The code the engine refuses a create with when a content type of that name exists. */
const ALREADY_EXISTS = 'SCHEMA_EXISTS';

const refusedAs = (err: unknown, code: string) =>
	err instanceof ApiError && err.status === 412 && (err.body as { code?: unknown } | undefined)?.code === code;

/** What the builder says when the schema changed after the reader opened it. */
const CHANGED_SINCE_OPENED = 'Someone changed this content type after you opened it. Reload it to see the latest version, then make your change again.';

/** The condition a write is sent on: only the definition at `version`. None when the read named no version. */
const onlyAt = (version: string): RequestInit | undefined => (version ? { headers: { 'If-Match': `"${version}"` } } : undefined);

/** The condition a new content type is sent on: create it, never replace one of that name. */
const createOnly: RequestInit = { headers: { 'If-None-Match': '*' } };

export const actions: Actions = {
	/**
	 * Saves one schema. Renamed fields go through the engine's rename route
	 * first, because the definition alone is diffed by name and a renamed field
	 * would otherwise land as a new column beside a dropped one.
	 *
	 * Every write names the version of the definition the builder opened, and
	 * each rename answers the version it stored, which the next write names. A
	 * content type someone changed since it was opened is then refused rather
	 * than overwritten with what the builder held. A new content type is sent
	 * as a create only, so it never replaces one that already has its name.
	 */
	save: async (event) => {
		await requireRole(event, WRITERS);
		const data = await event.request.formData();
		const schema = parseSchema(data.get('schema'));
		if (!schema) return fail(400, { scope: 'save' as const, error: 'This form is missing its content type. Reload the page and try again.' });
		const original = String(data.get('original') ?? '');
		if (original && original !== schema.name) {
			return fail(400, { scope: 'save' as const, error: 'To change the machine name of a saved content type, use Rename.' });
		}
		const client = authedClient(event);

		let version = String(data.get('version') ?? '');
		const renamed: { from: string; to: string }[] = [];
		const said = () => renamed.map((r) => `${r.from} to ${r.to}`).join(', ');
		if (original) {
			for (const r of parseRenames(data.get('renames'))) {
				try {
					const answer = await retryBusy(() =>
						client.put<{ version?: string }>(
							`/api/admin/schemas/${path(original, 'fields', r.from, 'rename')}`,
							{ new_name: r.to },
							onlyAt(version),
						),
					);
					renamed.push(r);
					if (answer?.version) version = answer.version;
				} catch (err) {
					const done = renamed.length ? ` These fields were renamed: ${said()}.` : '';
					const stale = refusedAs(err, VERSION_MISMATCH);
					return fail(statusOf(err), {
						scope: 'save' as const,
						error: `${stale ? CHANGED_SINCE_OPENED : actionError(err, `Could not rename the field ${r.from}. Try again.`)}${done}`,
						renamed,
						version,
						stale,
					});
				}
			}
		}

		try {
			const saved = await retryBusy(() => client.post<Schema>('/api/admin/schemas', schema, original ? onlyAt(version) : createOnly));
			return { scope: 'save' as const, saved };
		} catch (err) {
			const done = renamed.length ? ` These fields were renamed: ${said()}.` : '';
			const stale = refusedAs(err, VERSION_MISMATCH);
			const message = refusedAs(err, ALREADY_EXISTS)
				? `A content type named ${schema.name} already exists. Open it from the list, or give this one another machine name.`
				: stale
					? CHANGED_SINCE_OPENED
					: actionError(err, 'Could not save the content type. Try again.');
			return fail(statusOf(err), {
				scope: 'save' as const,
				error: `${message}${done}`,
				renamed,
				version,
				stale,
			});
		}
	},

	/** The DDL a save would run, without running it. */
	preview: async (event) => {
		await requireRole(event, WRITERS);
		const data = await event.request.formData();
		const schema = parseSchema(data.get('schema'));
		if (!schema || !schema.name) return fail(400, { scope: 'preview' as const, error: 'Name the table before previewing it.' });
		const intent = String(data.get('intent') ?? 'look');
		// A save runs the renames through their own route before the definition,
		// so the preview is asked about the definition with those fields under
		// their old names. Asked about the new names it reads each rename as an
		// added column and a dropped one, which is not what the save does.
		const back = new Map(parseRenames(data.get('renames')).map((r) => [r.to, r.from]));
		const asDiffed = back.size
			? { ...schema, fields: schema.fields.map((f) => (back.has(f.name) ? { ...f, name: back.get(f.name) as string } : f)) }
			: schema;
		try {
			const r = await retryBusy(() =>
				authedClient(event).post<{ statements: DryRunStatement[] }>(`/api/admin/schemas/${path(schema.name)}/preview-ddl`, asDiffed),
			);
			return { scope: 'preview' as const, intent, statements: r.statements ?? [] };
		} catch (err) {
			return fail(statusOf(err), { scope: 'preview' as const, intent, error: actionError(err, 'Could not preview the DDL. Try again.') });
		}
	},

	delete: async (event) => {
		await requireRole(event, WRITERS);
		const name = String((await event.request.formData()).get('name') ?? '');
		if (!name) return fail(400, { scope: 'delete' as const, error: 'Choose a content type first.' });
		try {
			await retryBusy(() => authedClient(event).delete(`/api/admin/schemas/${path(name)}`));
			return { scope: 'delete' as const, deleted: name };
		} catch (err) {
			return fail(statusOf(err), { scope: 'delete' as const, error: actionError(err, 'Could not delete the content type. Try again.') });
		}
	},

	/** Moves the table and every row in it to a new machine name. */
	rename: async (event) => {
		await requireRole(event, WRITERS);
		const data = await event.request.formData();
		const from = String(data.get('from') ?? '');
		const to = String(data.get('to') ?? '').trim();
		if (!from || !to) return fail(400, { scope: 'rename' as const, error: 'Enter the new machine name.' });
		try {
			const saved = await retryBusy(() =>
				authedClient(event).put<Schema>(`/api/admin/schemas/${path(from, 'rename')}`, { new_name: to }),
			);
			return { scope: 'rename' as const, from, saved };
		} catch (err) {
			return fail(statusOf(err), { scope: 'rename' as const, error: actionError(err, 'Could not rename the content type. Try again.') });
		}
	},

	/** What each save ran against the table and what is still queued. */
	history: async (event) => {
		// The engine holds this to super_admin: the table behind a name is shared
		// by every tenant that defines it, so its history is theirs too.
		await requireRole(event, ['super_admin']);
		const name = String((await event.request.formData()).get('name') ?? '');
		if (!name) return fail(400, { scope: 'history' as const, error: 'Choose a content type first.' });
		try {
			const r = await authedClient(event).get<{ entries: HistoryEntry[]; pending: number; limit: number }>(
				`/api/admin/schemas/${path(name)}/history`,
			);
			return { scope: 'history' as const, name, entries: r.entries ?? [], pending: r.pending ?? 0, limit: r.limit ?? 200 };
		} catch (err) {
			if (err instanceof ApiError && err.status === 404) {
				return fail(404, { scope: 'history' as const, name, error: `There is no saved content type named ${name}, so it has no history.` });
			}
			return fail(statusOf(err), { scope: 'history' as const, name, error: actionError(err, 'Try again in a moment.') });
		}
	},

	/** Runs the drops a save queued for this one table. */
	applyPending: async (event) => {
		await requireRole(event, ['super_admin']);
		const name = String((await event.request.formData()).get('name') ?? '');
		if (!name) return fail(400, { scope: 'applyPending' as const, error: 'Choose a content type first.' });
		try {
			const r = await retryBusy(() =>
				authedClient(event).post<{ applied: number; canceled?: number }>(`/api/admin/schemas/${path(name)}/apply-pending`, {}),
			);
			return { scope: 'applyPending' as const, name, applied: r.applied ?? 0, canceled: r.canceled ?? 0 };
		} catch (err) {
			return fail(statusOf(err), { scope: 'applyPending' as const, name, error: actionError(err, 'Could not apply the queued changes. Try again.') });
		}
	},

	/**
	 * Imports content types, in two steps. Without `apply` the engine answers
	 * the plan: which schemas it would create or change and the DDL each one
	 * runs. With it, the plan runs.
	 */
	import: async (event) => {
		await requireRole(event, ['super_admin']);
		const data = await event.request.formData();
		const body = await readImportForm(data);
		if (!body) return fail(400, { scope: 'import' as const, error: 'Choose a file or paste the definitions.' });
		const source = String(data.get('source') ?? 'lyeve');
		if (!IMPORT_SOURCES.some((s) => s.value === source)) {
			return fail(400, { scope: 'import' as const, error: 'Choose where the definitions come from.' });
		}
		const apply = data.get('apply') === 'true';
		const query = new URLSearchParams({ from: source, ...(apply ? { apply: 'true' } : {}) });
		const payload = 'file' in body ? body.file : body.content;
		const type = 'file' in body ? await bundleContentType(body.file) : body.format === 'json' ? 'application/json' : 'application/yaml';

		let res: Response;
		try {
			res = await event.fetch(`/api/admin/schemas/import?${query}`, {
				method: 'POST',
				headers: { ...authedHeaders(event), 'Content-Type': type },
				body: payload,
			});
		} catch {
			return fail(502, { scope: 'import' as const, error: 'Could not import the definitions. Try again.' });
		}
		const reply = (await res.json().catch(() => ({}))) as {
			error?: string;
			applied?: boolean;
			plan?: ImportPlan;
			renamed?: Record<string, string>;
			notes?: { schema: string; field?: string; message: string }[];
		};
		if (!res.ok) {
			// 4xx carries the engine's reason about the file, which is what the
			// operator has to change. Anything else is said in our own words.
			const relay = res.status >= 400 && res.status < 500 && reply.error ? reply.error : '';
			return fail(res.status, {
				scope: 'import' as const,
				error: relay || 'Could not import the definitions. Try again.',
				plan: reply.plan ?? null,
			});
		}
		return {
			scope: 'import' as const,
			applied: reply.applied === true,
			plan: reply.plan ?? { schemas: [] },
			renamed: reply.renamed ?? {},
			notes: reply.notes ?? [],
		};
	},

	preset: async (event) => {
		await requireRole(event, WRITERS);
		const client = authedClient(event);
		const data = await event.request.formData();
		const id = String(data.get('id') ?? '').trim();
		if (!id) return fail(400, { action: 'preset' as const, error: 'Choose a preset.', preset: '' });

		try {
			const result = await applySchemaPreset(client, id);
			return { preset: id, created: result.created ?? [] };
		} catch (err) {
			// 409 is the one refusal that names something the operator can act
			// on: a schema of that name is already here. The plugin's sentence
			// says which, so it is relayed beside the preset it belongs to.
			if (err instanceof ApiError && err.status === 409) {
				return fail(409, { action: 'preset' as const, error: actionError(err, 'A content type this preset creates already exists.'), preset: id });
			}
			if (err instanceof ApiError && err.status === 404) {
				return fail(404, { action: 'preset' as const, error: 'This preset is not included in this build.', preset: id });
			}
			return fail(400, { action: 'preset' as const, error: actionError(err, 'Could not create the content types from this preset. Try again.'), preset: id });
		}
	},

	savePreset: async (event) => {
		await requireRole(event, WRITERS);
		const client = authedClient(event);
		const data = await event.request.formData();
		const url = String(data.get('url') ?? '').trim();
		const file = data.get('file');
		let document = String(data.get('document') ?? '').trim();
		if (!document && file instanceof File && file.size > 0) document = (await file.text()).trim();
		if (!url && !document) return fail(400, { saveError: 'Enter a URL, choose a file or paste a preset.' });
		if (url && document) return fail(400, { saveError: 'Enter a URL or a document, not both.' });
		try {
			const saved = await saveSchemaPreset(client, url ? { url } : { document });
			return { savedPreset: saved.id };
		} catch (err) {
			const refused = refusalOf(err);
			if (refused) return fail(402, { saveError: refusalText(refused), refused });
			if (err instanceof ApiError && err.status === 409) {
				return fail(409, { saveError: 'A built-in preset already uses that id. Choose another id.' });
			}
			if (err instanceof ApiError && err.status === 502) {
				return fail(502, { saveError: 'The URL did not return a preset document.' });
			}
			return fail(400, { saveError: actionError(err, 'Could not save the preset. Try again.') });
		}
	},

	/**
	 * Applies a preset file once without saving it. The file is read here and
	 * sent as text, so the engine takes JSON and YAML alike. A refusal is
	 * about the file and lands on its field. A 5xx or a dropped connection
	 * may follow a write that landed, so that sentence claims nothing.
	 */
	importPreset: async (event) => {
		await requireRole(event, WRITERS);
		const client = authedClient(event);
		const file = (await event.request.formData()).get('file');
		if (!(file instanceof File) || file.size === 0) return fail(400, { importError: 'Choose a file.', importField: 'file' });
		if (file.size > PRESET_FILE_LIMIT) return fail(413, { importError: 'Choose a file of 1 MB or less.', importField: 'file' });
		try {
			const result = await importSchemaPreset(client, await file.text());
			return { importedPreset: result.created ?? [] };
		} catch (err) {
			if (err instanceof ApiError && err.status < 500) {
				return fail(err.status, { importError: actionError(err, 'Could not import the preset. Try again.'), importField: 'file' });
			}
			return fail(502, { importError: 'Could not import the preset. Check whether its content types were created, then try again.', importField: '' });
		}
	},

	// The canvas saves after every gesture that moves a node. The page sends
	// the whole map, and the plugin replaces what it holds with it.
	saveLayout: async (event) => {
		await requireRole(event, WRITERS);
		const client = authedClient(event);
		let positions;
		try {
			positions = parsePositions(JSON.parse(String((await event.request.formData()).get('positions') ?? '{}')));
		} catch {
			return fail(400, { layoutError: 'Could not save the layout. Reload the page and try again.' });
		}
		try {
			await saveCanvasLayout(client, positions);
			return { layoutSaved: true };
		} catch (err) {
			const refused = refusalOf(err);
			if (refused) return fail(402, { layoutError: refusalText(refused), refused });
			return fail(400, { layoutError: actionError(err, 'Could not save the layout. Try again.') });
		}
	},

	deletePreset: async (event) => {
		await requireRole(event, WRITERS);
		const client = authedClient(event);
		const id = String((await event.request.formData()).get('id') ?? '').trim();
		if (!id) return fail(400, { action: 'deletePreset' as const, error: 'Choose a preset.', preset: '' });
		try {
			await deleteSchemaPreset(client, id);
			return { deletedPreset: id };
		} catch (err) {
			return fail(400, { action: 'deletePreset' as const, error: actionError(err, 'Could not delete the preset. Try again.'), preset: id });
		}
	},
};
