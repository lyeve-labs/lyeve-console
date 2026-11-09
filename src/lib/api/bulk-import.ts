/**
 * The bulk-import plugin's admin routes.
 *
 * A job reads rows from a file and writes content. The number that decides
 * whether it worked is not "completed": it is how many rows errored, because
 * a job finishes successfully having skipped every row it could not parse.
 * A green status beside 4,000 errored rows is the reading this screen exists
 * to prevent.
 *
 * A dry run validates without writing, and the plugin records it as a job
 * like any other. Reading a dry run's counts as content that now exists is
 * the second mistake available here, so the list marks them.
 */
import type { StatusTone } from '@lyeve-labs/ui-kit';
import { ApiError, type HttpClient } from '@lyeve-labs/client';
import type { ListEnvelope } from './list';
import { csrfHeaders } from './csrf';
import { outageFor } from '../outage';

const IMPORTS_URL = '/api/admin/imports';

export interface ImportJob {
	id: string;
	content_type: string;
	source_format: string;
	source_name: string;
	total_rows: number;
	processed_rows: number;
	errored_rows: number;
	inserted_rows: number;
	updated_rows: number;
	skipped_rows: number;
	status: string;
	dry_run: boolean;
	error_message?: string;
	started_at?: string | null;
	finished_at?: string | null;
	created_at: string;
	upsert_key?: string;
	/** The create mode leaves an entry the key finds alone, and upsert updates it. */
	mode?: ImportMode;
	/** upload or url. */
	source_kind?: 'upload' | 'url';
}

/** The plugin names its rows `jobs`, not `data`. */
export async function listJobs(
	client: HttpClient,
	limit: number,
	offset: number
): Promise<ListEnvelope<ImportJob>> {
	const res = await client.get<{ jobs?: ImportJob[] | null; total_count?: number }>(
		`${IMPORTS_URL}?limit=${limit}&offset=${offset}`
	);
	return { data: res?.jobs ?? [], total_count: res?.total_count, limit, offset };
}

export async function getJob(client: HttpClient, id: string): Promise<ImportJob> {
	return client.get<ImportJob>(`${IMPORTS_URL}/${encodeURIComponent(id)}`);
}

/** One row of a job as it was read and what became of it. */
export interface ImportRow {
	id: string;
	row_index: number;
	status: 'pending' | 'processing' | 'inserted' | 'updated' | 'skipped' | 'errored';
	source_data?: Record<string, string> | null;
	error_code?: string;
	error_message?: string;
	entry_id?: string;
}

/**
 * The rows of one job with a given outcome. The route wraps its page in the
 * engine's envelope, so the rows sit one level down.
 */
export async function listRows(
	client: HttpClient,
	id: string,
	status: string,
	limit: number
): Promise<{ rows: ImportRow[]; total: number }> {
	const res = await client.get<{ data?: { rows?: ImportRow[] | null; total_count?: number } }>(
		`${IMPORTS_URL}/${encodeURIComponent(id)}/rows?status=${encodeURIComponent(status)}&limit=${limit}&offset=0`
	);
	return { rows: res?.data?.rows ?? [], total: res?.data?.total_count ?? 0 };
}

/** Where a job's rejected rows download as CSV. */
export function rejectedHref(id: string): string {
	return `${IMPORTS_URL}/${encodeURIComponent(id)}/rejected`;
}

export const IMPORT_FORMATS = ['csv', 'json', 'ndjson', 'yaml', 'xlsx'] as const;
export type ImportFormat = (typeof IMPORT_FORMATS)[number];

export const IMPORT_FORMAT_LABELS: Readonly<Record<ImportFormat, string>> = {
	csv: 'CSV',
	json: 'JSON',
	ndjson: 'NDJSON',
	yaml: 'YAML',
	xlsx: 'XLSX',
};

/**
 * How wide and how large a CSV file or an XLSX sheet may be. Every row is
 * built as wide as the header, so the plugin refuses a wider or larger file
 * before reading its rows. Shown before the upload, so the refusal is never
 * the first a person hears of it.
 */
export const MAX_IMPORT_COLUMNS = 1024;
export const MAX_IMPORT_CELLS = 5_000_000;

/**
 * The codes the plugin gives the two bounds a file can pass. Every parse
 * failure answers 400, so the code is what says which bound it was.
 */
export const TOO_MANY_COLUMNS = 'bulk_import.too_many_columns';
export const TOO_MANY_CELLS = 'bulk_import.too_many_cells';

/**
 * What to do about a file the plugin refused to read. The plugin's sentence
 * names the limit, and this adds what a person does about it. The two bounds
 * are told by their code. The other parse failures carry none, so their
 * sentence is all there is to read.
 */
export function parseRefusalHint(message: string, code = ''): string {
	if (code === TOO_MANY_COLUMNS) {
		return 'Delete the columns the import does not need, or save them to a second file.';
	}
	if (code === TOO_MANY_CELLS) {
		return 'The limit is the header width times the rows. Remove columns the import does not need, or split the rows across files.';
	}
	if (/row count exceeds/.test(message)) return 'Split the rows across files and import each.';
	if (/no sheet named/.test(message)) return 'Check the sheet name. It is matched exactly, case included.';
	if (/not a readable XLSX/.test(message)) return 'Save it again from the spreadsheet as an Excel workbook (.xlsx).';
	return '';
}

/** The format a file name says, or null to let the engine read it. */
export function formatFromName(name: string): ImportFormat | null {
	const ext = name.toLowerCase().split('.').pop() ?? '';
	if (ext === 'xlsx') return 'xlsx';
	if (ext === 'csv') return 'csv';
	if (ext === 'json') return 'json';
	if (ext === 'ndjson' || ext === 'jsonl') return 'ndjson';
	if (ext === 'yaml' || ext === 'yml') return 'yaml';
	return null;
}

/** Where the file comes from: the bytes, or an address the engine fetches. */
export interface SourceInput {
	source_format?: ImportFormat;
	source_name?: string;
	file_data?: string;
	source_url?: string;
	/** The worksheet of an XLSX file. Empty reads the first. */
	sheet?: string;
}

/** A file described before anything is mapped. */
export interface ImportPreview {
	source_format: ImportFormat;
	source_name: string;
	columns: string[];
	rows: Record<string, string>[];
	total_rows: number;
	errors: RowError[];
	/** A LyEve data export, whose entries carry their slug, title and status. */
	export: boolean;
	/** Entries per schema, for a LyEve export. */
	schemas: Record<string, number>;
	/** Every worksheet of an XLSX workbook, in workbook order. Absent for other formats. */
	sheets?: string[];
}

export interface RowError {
	row_index: number;
	error_code?: string;
	message: string;
}

export interface FieldMapping {
	source_field: string;
	target_field: string;
	data_type?: string;
	transform?: TransformName;
	transform_options?: TransformOptions;
}

/**
 * What a mapping does to a cell before it is stored. The three text
 * transforms work on every instance. Parsing a date, splitting a cell into a list and
 * looking a value up need a license, which the plugin checks when a request
 * names one: a template saved with one keeps applying.
 */
export type TransformName = 'trim' | 'lowercase' | 'uppercase' | 'date' | 'split' | 'lookup';

export interface TransformOptions {
	/** The Go reference layout a date cell is written in, such as 02/01/2006. */
	layout?: string;
	/** How the date is stored. Empty is RFC 3339. */
	output_layout?: string;
	separator?: string;
	map?: Record<string, string>;
	/** What lookup writes for a value the map lacks. Absent refuses the row. */
	default?: string;
}

export const TRANSFORMS: readonly { value: TransformName | ''; label: string; licensed: boolean }[] = [
	{ value: '', label: 'As it is', licensed: false },
	{ value: 'trim', label: 'Trim spaces', licensed: false },
	{ value: 'lowercase', label: 'Lower case', licensed: false },
	{ value: 'uppercase', label: 'Upper case', licensed: false },
	{ value: 'date', label: 'Parse a date', licensed: true },
	{ value: 'split', label: 'Split into a list', licensed: true },
	{ value: 'lookup', label: 'Look up a value', licensed: true },
];

/** The transform a form edits: the name and its options as text. */
export interface TransformDraft {
	transform: TransformName | '';
	layout: string;
	outputLayout: string;
	separator: string;
	/** One "from = to" pair per line. */
	lookup: string;
	/** Empty refuses a row whose value the map lacks. */
	fallback: string;
}

export function emptyTransform(): TransformDraft {
	return { transform: '', layout: '', outputLayout: '', separator: ',', lookup: '', fallback: '' };
}

/** The draft a stored mapping describes. */
export function transformDraft(m: Pick<FieldMapping, 'transform' | 'transform_options'>): TransformDraft {
	const o = m.transform_options ?? {};
	return {
		transform: m.transform ?? '',
		layout: o.layout ?? '',
		outputLayout: o.output_layout ?? '',
		separator: o.separator ?? ',',
		lookup: Object.entries(o.map ?? {})
			.map(([k, v]) => `${k} = ${v}`)
			.join('\n'),
		fallback: o.default ?? '',
	};
}

/** The lookup lines as a map. A line without " = " is skipped. */
export function lookupMap(text: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const line of text.split('\n')) {
		const at = line.indexOf('=');
		if (at < 0) continue;
		const key = line.slice(0, at).trim();
		if (key) out[key] = line.slice(at + 1).trim();
	}
	return out;
}

/**
 * The transform fields of a mapping, or a message saying what is missing.
 * The plugin is the judge. This names the problem before the round trip.
 */
export function transformFields(
	d: TransformDraft,
): Pick<FieldMapping, 'transform' | 'transform_options'> | string {
	switch (d.transform) {
		case '':
			return {};
		case 'trim':
		case 'lowercase':
		case 'uppercase':
			return { transform: d.transform };
		case 'date':
			if (!d.layout.trim()) return 'A date transform needs the layout the cells are written in.';
			return {
				transform: 'date',
				transform_options: {
					layout: d.layout.trim(),
					...(d.outputLayout.trim() ? { output_layout: d.outputLayout.trim() } : {}),
				},
			};
		case 'split':
			if (!d.separator) return 'A split needs the separator between the items.';
			return { transform: 'split', transform_options: { separator: d.separator } };
		case 'lookup': {
			const map = lookupMap(d.lookup);
			const n = Object.keys(map).length;
			if (n === 0) return 'A lookup needs at least one "from = to" line.';
			if (n > 1000) return 'A lookup holds at most 1000 entries.';
			return {
				transform: 'lookup',
				transform_options: { map, ...(d.fallback !== '' ? { default: d.fallback } : {}) },
			};
		}
	}
}

export type ImportMode = 'create' | 'upsert';

export interface ImportRequest extends SourceInput {
	content_type: string;
	field_mappings: FieldMapping[];
	mode: ImportMode;
	upsert_key?: string;
	dry_run?: boolean;
	/** A saved template that supplies what the request leaves out. */
	template_id?: string;
}

/** A tenant's saved mapping: the field mappings, and the content type, key and mode they were written for. */
export interface MappingTemplate {
	id: string;
	name: string;
	content_type: string;
	upsert_key?: string;
	mode?: ImportMode | '';
	field_mappings: FieldMapping[];
	created_at: string;
	updated_at: string;
}

export interface SaveMappingTemplate {
	name: string;
	content_type: string;
	upsert_key?: string;
	mode?: ImportMode;
	field_mappings: FieldMapping[];
}

const TEMPLATES_URL = `${IMPORTS_URL}/templates`;

export async function listTemplates(
	client: HttpClient,
): Promise<{ licensed?: boolean; templates?: MappingTemplate[] | null }> {
	return client.get(TEMPLATES_URL);
}

export async function createTemplate(client: HttpClient, body: SaveMappingTemplate): Promise<MappingTemplate> {
	return client.post<MappingTemplate>(TEMPLATES_URL, body);
}

export async function updateTemplate(
	client: HttpClient,
	id: string,
	body: SaveMappingTemplate,
): Promise<MappingTemplate> {
	return client.put<MappingTemplate>(`${TEMPLATES_URL}/${encodeURIComponent(id)}`, body);
}

export async function deleteTemplate(client: HttpClient, id: string): Promise<void> {
	await client.delete(`${TEMPLATES_URL}/${encodeURIComponent(id)}`);
}

/** The transform a mapping applies, in words, or empty for none. */
export function transformLabel(m: Pick<FieldMapping, 'transform'>): string {
	if (!m.transform) return '';
	return TRANSFORMS.find((t) => t.value === m.transform)?.label ?? m.transform;
}

export interface ValidateResult {
	total_rows: number;
	valid_rows: number;
	error_rows: number;
	errors: RowError[];
}

/**
 * The three calls that carry the file go from the browser to the engine, as
 * the media upload does: an import may be fifty megabytes, and a form action
 * would pass it through this server's request body limit, which is a small
 * fraction of that. The session cookie authenticates them and the CSRF header
 * is echoed, as every cookie-authenticated write must.
 */
async function postImport<T>(fetchFn: typeof fetch, path: string, body: unknown): Promise<T> {
	const res = await fetchFn(`${IMPORTS_URL}${path}`, {
		method: 'POST',
		headers: csrfHeaders({ 'Content-Type': 'application/json' }),
		body: JSON.stringify(body),
	});
	if (!res.ok) {
		const j = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
		// The engine's refusals carry a code, and their sentence is written for
		// the operator and shown as sent. A 5xx body can carry driver detail,
		// and an uncoded 4xx is not the engine's, so the status picks the
		// sentence for both. A 413 is the console's own too: the engine names
		// the request limit, the encoded file plus its envelope, and the reader
		// knows the file limit the drawer states. An ApiError keeps
		// the body, so a license refusal renders through RefusalNotice with
		// what the plugin sent.
		const engineSaid = typeof j.code === 'string' && j.code !== '';
		const said =
			res.status < 500 && res.status !== 413 && engineSaid && j.error
				? j.error
				: importFailure(res.status, path === '', engineSaid);
		throw new ApiError(res.status, said, j);
	}
	return (await res.json()) as T;
}

/**
 * The sentence for a failed import call. The engine answers a start once it
 * has stored the job and imports the rows after that, so its own 5xx means
 * no job was made. A 5xx it did not write, such as a proxy's 502 or 504, can
 * arrive after the job was made, so a start claims only what is known.
 */
function importFailure(status: number, starts: boolean, engineSaid: boolean): string {
	if (status === 413) return 'The file is larger than the 50 MB an import takes. Split it and import the parts.';
	if (status >= 500 && starts && !engineSaid) {
		return 'Could not confirm whether the import started. Check the entries before you try again.';
	}
	if (status === 502 || status === 503 || status === 504) {
		return outageFor('nothing was imported');
	}
	if (status >= 500) return 'Could not complete the request. Nothing was imported. Try again.';
	return 'The request was refused.';
}

export function previewImport(fetchFn: typeof fetch, body: SourceInput & { content_type?: string }) {
	return postImport<ImportPreview>(fetchFn, '/preview', body);
}

export function validateImport(fetchFn: typeof fetch, body: ImportRequest) {
	// The route refuses a field it does not know, and dry_run is the start
	// route's.
	const { dry_run: _ignored, ...rest } = body;
	return postImport<ValidateResult>(fetchFn, '/validate', rest);
}

export function startImport(fetchFn: typeof fetch, body: ImportRequest) {
	return postImport<ImportJob>(fetchFn, '', body);
}

/** A mapping target: an entry column or one of the schema's fields. */
export interface MappingTarget {
	value: string;
	label: string;
	hint: string;
	dataType: string;
}

/** The entry's own columns, which every schema's entries have. */
export const ENTRY_TARGETS: readonly MappingTarget[] = [
	{ value: 'entry.slug', label: 'Entry slug', hint: "The entry's address. If not mapped, it is made from the title.", dataType: 'string' },
	{ value: 'entry.title', label: 'Entry title', hint: 'Shown in the content list. If not mapped, it is taken from a title field.', dataType: 'string' },
	{ value: 'entry.status', label: 'Entry status', hint: 'draft, published or archived. If not mapped, every entry is a draft.', dataType: 'string' },
];

/** The data type a mapping coerces a column to, from the field it fills. */
export function dataTypeFor(fieldType: string | undefined): string {
	switch ((fieldType ?? '').toLowerCase()) {
		case 'integer':
		case 'int':
		case 'bigint':
			return 'integer';
		case 'decimal':
			return 'decimal';
		case 'number':
			return 'number';
		case 'float':
		case 'double':
			return 'float';
		case 'boolean':
		case 'bool':
			return 'boolean';
		case 'json':
		case 'object':
		case 'array':
			return 'json';
		default:
			return 'string';
	}
}

/** The targets a schema offers: the entry columns, then its own fields. */
export function mappingTargets(
	fields: ReadonlyArray<{ name: string; field_type?: string; system?: boolean }>
): MappingTarget[] {
	const own = fields
		.filter((f) => !f.system)
		.map((f) => ({
			value: f.name,
			label: f.name,
			hint: f.field_type ?? '',
			dataType: dataTypeFor(f.field_type),
		}));
	return [...ENTRY_TARGETS, ...own];
}

function norm(s: string): string {
	return s.toLowerCase().replace(/[\s_-]+/g, '');
}

/**
 * A first guess at the mapping: each target takes the column with its name,
 * ignoring case, spaces, hyphens and underscores. The entry columns take
 * slug, title (or name) and status. The person corrects the rest.
 */
export function suggestMapping(columns: readonly string[], targets: readonly MappingTarget[]): Record<string, string> {
	const byNorm = new Map(columns.map((c) => [norm(c), c]));
	const out: Record<string, string> = {};
	for (const t of targets) {
		let pick = '';
		if (t.value === 'entry.slug') pick = byNorm.get('slug') ?? '';
		else if (t.value === 'entry.title') pick = byNorm.get('title') ?? byNorm.get('name') ?? '';
		else if (t.value === 'entry.status') pick = byNorm.get('status') ?? '';
		else pick = byNorm.get(norm(t.value)) ?? '';
		out[t.value] = pick;
	}
	return out;
}

/** Reads a file into the base64 the engine takes. */
export async function fileToBase64(file: File): Promise<string> {
	const bytes = new Uint8Array(await file.arrayBuffer());
	let binary = '';
	const chunk = 0x8000;
	for (let i = 0; i < bytes.length; i += chunk) {
		binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
	}
	return btoa(binary);
}

export async function cancelJob(client: HttpClient, id: string): Promise<void> {
	await client.post(`${IMPORTS_URL}/${encodeURIComponent(id)}/cancel`, {});
}

export async function rollbackJob(client: HttpClient, id: string): Promise<void> {
	await client.post(`${IMPORTS_URL}/${encodeURIComponent(id)}/rollback`, {});
}

/**
 * What actually happened, which is not the same as the status.
 *
 * A job completes successfully having skipped every row it could not parse,
 * so 'completed' beside four thousand errored rows is a job that imported
 * nothing and reported success. That reading is the reason this exists.
 */
export type ImportOutcome = 'clean' | 'partial' | 'nothing' | 'running' | 'stopped' | 'rolled_back' | 'failed';

export function outcome(job: ImportJob): ImportOutcome {
	if (job.status === 'running' || job.status === 'pending') return 'running';
	if (job.status === 'failed') return 'failed';
	if (job.status === 'rolled_back') return 'rolled_back';
	if (job.status === 'canceled') return 'stopped';
	if (job.errored_rows <= 0) return 'clean';
	return written(job) > 0 ? 'partial' : 'nothing';
}

export const OUTCOME_LABELS: Readonly<Record<ImportOutcome, string>> = {
	clean: 'Every row imported',
	partial: 'Finished with rows rejected',
	nothing: 'Finished with nothing imported',
	running: 'Running',
	stopped: 'Stopped',
	rolled_back: 'Rolled back',
	failed: 'Failed',
};

export function outcomeTone(o: ImportOutcome): StatusTone {
	if (o === 'clean') return 'success';
	if (o === 'failed' || o === 'nothing') return 'danger';
	if (o === 'partial') return 'warn';
	return 'neutral';
}

/** Rows that became content, which excludes skipped and errored ones. */
export function written(job: ImportJob): number {
	return (job.inserted_rows ?? 0) + (job.updated_rows ?? 0);
}

/**
 * How far a running job has got, as a fraction.
 *
 * `total_rows` is zero until the file has been counted, so a bar drawn from
 * processed alone sits at zero and then jumps. A finished job is complete
 * whatever the counters say.
 */
export function progress(job: ImportJob): number {
	if (job.status === 'completed' || job.status === 'completed_with_errors') return 1;
	if (job.total_rows <= 0) return 0;
	return Math.min(1, job.processed_rows / job.total_rows);
}

/**
 * Whether a job's writes can still be undone.
 *
 * A dry run wrote nothing, so there is nothing to roll back, and offering the
 * control would be offering a no-op that looks like a repair.
 */
export function rollbackable(job: ImportJob): boolean {
	return (
		!job.dry_run &&
		(job.status === 'completed' || job.status === 'completed_with_errors') &&
		(job.inserted_rows ?? 0) > 0
	);
}

export function cancelable(job: ImportJob): boolean {
	return job.status === 'running' || job.status === 'pending';
}

/** The share of rows that were rejected, as a percentage, or null if none ran. */
export function rejectionRate(job: ImportJob): number | null {
	const seen = job.processed_rows;
	if (seen <= 0) return null;
	return Math.round((job.errored_rows / seen) * 1000) / 10;
}

/** A schema as the mapping step needs it: its name and its fields. */
export interface ImportSchema {
	name: string;
	fields: { name: string; field_type?: string; system?: boolean }[];
}
