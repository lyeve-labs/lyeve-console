/**
 * The data-export plugin's admin routes.
 *
 * Two things live here and they are not the same: a job is one export that
 * ran, and a schedule is a cron entry that starts one. A page that mixed them
 * would make a disabled schedule look like a failed export.
 *
 * A completed job's download is served by the instance itself, so the link is
 * only good while the file is still there. The list says when a job finished
 * rather than promising the file is still downloadable.
 */
import type { HttpClient } from '@lyeve-labs/client';
import { formatCount } from '$lib/format';

export const JOBS_URL = '/api/admin/data-export/jobs';
const SCHEDULES_URL = '/api/admin/data-export/schedules';
const START_URL = '/api/admin/data-export/start';

/**
 * The most entries one export holds. The plugin applies it to a request that
 * names no limit, to keep an export from loading the whole content table.
 */
export const EXPORT_ROW_CEILING = 10_000;

export const FORMATS = ['json', 'ndjson', 'yaml', 'csv', 'markdown', 'hugo', 'template'] as const;
export type ExportFormat = (typeof FORMATS)[number];

/**
 * What each format writes, in the words the picker shows under it. The first
 * four are the ones the bulk import reads back.
 */
export const FORMAT_LABELS: Readonly<Record<ExportFormat, { label: string; hint: string }>> = {
	json: { label: 'JSON', hint: 'One document holding the entries. Imports back as it is.' },
	ndjson: { label: 'NDJSON', hint: 'One entry per line, for large exports and streaming tools. Imports back.' },
	yaml: { label: 'YAML', hint: 'The JSON document written as YAML. Imports back.' },
	csv: {
		label: 'CSV',
		hint: 'A column per field, one file per content type. Several content types download as a zip. Imports back.',
	},
	markdown: { label: 'Markdown', hint: 'Each entry as a heading and its body, for reading.' },
	hugo: { label: 'Hugo', hint: 'Markdown with TOML front matter, for a static site.' },
	template: { label: 'Custom template', hint: 'A Go text/template of your own, rendered once per entry.' },
};

/** The steps an export goes through, as the plugin names them. */
export type ExportStage = '' | 'queued' | 'reading' | 'writing' | 'packaging' | 'storing' | 'done';

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'canceled';

/** Which content an export covers. */
export interface ContentFilter {
	schemas?: string[] | null;
	statuses?: string[] | null;
	from?: string | null;
	to?: string | null;
	slug?: string;
	search?: string;
	limit?: number;
	order_by?: string;
	order_asc?: boolean;
	fields?: string[] | null;
}

/** One export that ran, as the jobs route lists it. */
export interface ExportJob {
	id: string;
	name: string;
	format: ExportFormat;
	status: JobStatus;
	filter: ContentFilter;
	include_media: boolean;
	include_schemas?: boolean;
	/** The step a running job is on, or the one a failed job stopped at. */
	stage?: ExportStage;
	rows_processed: number;
	rows_total: number;
	file_key?: string;
	file_size: number;
	download_url?: string;
	rows_written: number;
	started_at?: string | null;
	completed_at?: string | null;
	error?: string;
	created_at: string;
}

/** One recurring export. The cron entry is the plugin's, not the operator's. */
export interface ExportSchedule {
	id: string;
	name: string;
	description?: string;
	enabled: boolean;
	cron_expression: string;
	export_config?: ExportConfig;
	cron_job_id?: string | null;
	last_run_at?: string | null;
	next_run_at?: string | null;
	created_at: string;
}

/** What a schedule starts each time it runs. */
export interface ExportConfig {
	format: ExportFormat;
	filter: ContentFilter;
	template?: string;
	include_media?: boolean;
	include_schemas?: boolean;
}

/**
 * The plugin's list envelopes name the rows `jobs` and `schedules`, not
 * `data`.
 */
interface JobPage {
	jobs?: ExportJob[] | null;
	total?: number;
	count?: number;
}

interface SchedulePage {
	schedules?: ExportSchedule[] | null;
	total?: number;
	count?: number;
}

export interface Page<T> {
	data: T[];
	total_count: number;
}

export async function listJobs(
	client: HttpClient,
	limit: number,
	offset: number,
): Promise<Page<ExportJob>> {
	const res = await client.get<JobPage>(`${JOBS_URL}?limit=${limit}&offset=${offset}`);
	const data = res?.jobs ?? [];
	return { data, total_count: res?.total ?? data.length };
}

export async function listSchedules(client: HttpClient): Promise<Page<ExportSchedule>> {
	const res = await client.get<SchedulePage>(`${SCHEDULES_URL}?limit=100&offset=0`);
	const data = res?.schedules ?? [];
	return { data, total_count: res?.total ?? data.length };
}

export interface StartExport {
	name: string;
	format: ExportFormat;
	filter: ContentFilter;
	template?: string;
	include_media?: boolean;
	include_schemas?: boolean;
}

export interface CreateSchedule {
	name: string;
	cron_expression: string;
	enabled: boolean;
	export_config: ExportConfig;
}

export async function createSchedule(client: HttpClient, body: CreateSchedule): Promise<ExportSchedule> {
	return client.post<ExportSchedule>(SCHEDULES_URL, body);
}

export async function setScheduleEnabled(client: HttpClient, id: string, enabled: boolean): Promise<void> {
	await client.put(`${SCHEDULES_URL}/${encodeURIComponent(id)}`, { enabled });
}

export async function deleteSchedule(client: HttpClient, id: string): Promise<void> {
	await client.delete(`${SCHEDULES_URL}/${encodeURIComponent(id)}`);
}

/** Whether a job is still going, which is what keeps the page refreshing. */
export function active(job: ExportJob): boolean {
	return job.status === 'pending' || job.status === 'running';
}

/**
 * What a job is doing, in a sentence. The status says running for the whole
 * of a long export. The stage says whether it is still reading, writing the
 * rows, or storing the file, and the counts say how far the writing got.
 */
export function stageText(job: ExportJob): string {
	if (job.status === 'completed') return 'Finished';
	if (job.status === 'canceled') return stoppedAt(job, 'Canceled');
	if (job.status === 'failed') return stoppedAt(job, 'Failed');
	switch (job.stage) {
		case 'reading':
			return 'Reading entries';
		case 'writing':
			return job.rows_total > 0
				? `Writing ${formatCount(job.rows_processed)} of ${formatCount(job.rows_total)} entries`
				: 'Writing entries';
		case 'packaging':
			return 'Packing the files into a zip';
		case 'storing':
			return 'Storing the file';
		default:
			return job.status === 'pending' ? 'Waiting to start' : 'Starting';
	}
}

function stoppedAt(job: ExportJob, verb: string): string {
	switch (job.stage) {
		case 'reading':
			return `${verb} while reading entries`;
		case 'writing':
			return `${verb} while writing entries`;
		case 'packaging':
			return `${verb} while packing the zip`;
		case 'storing':
			return `${verb} while storing the file`;
	}
	return verb;
}

/** A schedule's timetable in words, for the expressions the picker offers. */
export const CRON_PRESETS: ReadonlyArray<{ value: string; label: string }> = [
	{ value: '@hourly', label: 'Every hour' },
	{ value: '0 2 * * *', label: 'Every day at 02:00 UTC' },
	{ value: '0 2 * * 1', label: 'Every Monday at 02:00 UTC' },
	{ value: '0 2 1 * *', label: 'On the first of each month at 02:00 UTC' },
];

export function cronLabel(expr: string): string {
	return CRON_PRESETS.find((p) => p.value === expr)?.label ?? expr;
}

export async function startExport(client: HttpClient, body: StartExport): Promise<ExportJob> {
	return client.post<ExportJob>(START_URL, body);
}

export async function cancelJob(client: HttpClient, id: string): Promise<void> {
	await client.post(`${JOBS_URL}/${encodeURIComponent(id)}/cancel`, {});
}

/**
 * How far a job got, as a fraction.
 *
 * `rows_total` is zero until the query that counts them has run, so a bar
 * drawn from processed alone sits at zero and then jumps. A job that finished
 * is complete whatever the counters say.
 */
export function jobProgress(job: ExportJob): number {
	if (job.status === 'completed') return 1;
	if (job.rows_total <= 0) return 0;
	return Math.min(1, job.rows_processed / job.rows_total);
}

/**
 * Whether the file is still there to fetch.
 *
 * A canceled or failed job has no file, and a completed one without a key
 * wrote nowhere the instance can serve from.
 */
export function downloadable(job: ExportJob): boolean {
	return job.status === 'completed' && !!job.file_key;
}

/**
 * What a schedule covers, in words.
 *
 * A cron expression is the truth but it is not a sentence, and a schedule
 * that is switched off should say so rather than advertise a next run it
 * will not take.
 */
export function scheduleState(s: ExportSchedule): string {
	if (!s.enabled) return 'Paused';
	if (!s.next_run_at) return 'Enabled, no next run planned';
	return 'Enabled';
}
