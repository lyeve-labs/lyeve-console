import { describe, expect, it } from 'vitest';
import {
	downloadable,
	jobProgress,
	scheduleState,
	type ExportJob,
	type ExportSchedule,
} from './data-export';

function job(over: Partial<ExportJob> = {}): ExportJob {
	return {
		id: 'j1',
		name: 'nightly',
		format: 'json',
		status: 'completed',
		filter: {},
		include_media: false,
		rows_processed: 10,
		rows_total: 10,
		file_key: 'exports/j1.json',
		file_size: 2048,
		rows_written: 10,
		created_at: '2026-09-22T10:00:00Z',
		...over,
	};
}

function schedule(over: Partial<ExportSchedule> = {}): ExportSchedule {
	return {
		id: 's1',
		name: 'nightly',
		enabled: true,
		cron_expression: '0 2 * * *',
		next_run_at: '2026-09-23T02:00:00Z',
		created_at: '2026-09-22T10:00:00Z',
		...over,
	};
}

describe('jobProgress', () => {
	// rows_total is zero until the counting query has run, so a bar drawn
	// from processed alone sits at zero and then jumps.
	it('is zero while the total is unknown', () => {
		expect(jobProgress(job({ status: 'running', rows_processed: 500, rows_total: 0 }))).toBe(0);
	});

	it('is complete for a finished job whatever the counters say', () => {
		expect(jobProgress(job({ rows_processed: 0, rows_total: 0 }))).toBe(1);
	});

	it('never exceeds one when processed overshoots the total', () => {
		expect(jobProgress(job({ status: 'running', rows_processed: 30, rows_total: 10 }))).toBe(1);
	});
});

describe('downloadable', () => {
	// The instance serves the file itself, so a job with no key wrote
	// nowhere it can serve from and the link would 404.
	it('is false for a completed job that wrote no file', () => {
		expect(downloadable(job({ file_key: undefined }))).toBe(false);
	});

	it('is false for a canceled job however far it got', () => {
		expect(downloadable(job({ status: 'canceled', rows_processed: 900 }))).toBe(false);
	});

	it('is true only for a completed job with a file', () => {
		expect(downloadable(job())).toBe(true);
	});
});

describe('scheduleState', () => {
	// A paused schedule keeps its next_run_at, so advertising it would
	// promise a run that will not happen.
	it('says paused rather than showing a next run it will not take', () => {
		expect(scheduleState(schedule({ enabled: false }))).toBe('Paused');
	});

	it('says so when it is on but has nothing planned', () => {
		expect(scheduleState(schedule({ next_run_at: null }))).toBe('Enabled, no next run planned');
	});

	it('is plain when it is on and due', () => {
		expect(scheduleState(schedule())).toBe('Enabled');
	});
});

describe('reading the plugin', () => {
	it('reads the jobs and schedules keys the plugin answers with', async () => {
		const { listJobs, listSchedules } = await import('./data-export');
		const jobs = await listJobs({ get: async () => ({ jobs: [job()], total: 12, count: 1 }) } as never, 50, 0);
		expect(jobs.data).toHaveLength(1);
		expect(jobs.total_count).toBe(12);
		const schedules = await listSchedules({ get: async () => ({ schedules: [schedule()], total: 1 }) } as never);
		expect(schedules.data[0].name).toBe('nightly');
	});
});

describe('stageText', () => {
	it('says what a running export is doing and how far it got', async () => {
		const { stageText } = await import('./data-export');
		expect(stageText(job({ status: 'running', stage: 'reading' }))).toBe('Reading entries');
		expect(stageText(job({ status: 'running', stage: 'writing', rows_processed: 1200, rows_total: 5000 }))).toBe(
			'Writing 1,200 of 5,000 entries',
		);
		expect(stageText(job({ status: 'pending', stage: 'queued' }))).toBe('Waiting to start');
	});

	it('says where a failed or canceled export stopped', async () => {
		const { stageText } = await import('./data-export');
		expect(stageText(job({ status: 'failed', stage: 'storing' }))).toBe('Failed while storing the file');
		expect(stageText(job({ status: 'canceled', stage: 'writing' }))).toBe('Canceled while writing entries');
	});
});
