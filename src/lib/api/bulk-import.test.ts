import { describe, expect, it } from 'vitest';
import { ApiError } from '@lyeve-labs/client';
import {
	OUTCOME_LABELS,
	cancelable,
	outcome,
	outcomeTone,
	previewImport,
	startImport,
	progress,
	rejectionRate,
	rollbackable,
	written,
	type ImportJob,
} from './bulk-import';

function job(over: Partial<ImportJob> = {}): ImportJob {
	return {
		id: 'j1',
		content_type: 'articles',
		source_format: 'csv',
		source_name: 'articles.csv',
		total_rows: 100,
		processed_rows: 100,
		errored_rows: 0,
		inserted_rows: 100,
		updated_rows: 0,
		skipped_rows: 0,
		status: 'completed',
		dry_run: false,
		created_at: '2026-09-22T10:00:00Z',
		finished_at: '2026-09-22T10:05:00Z',
		...over,
	};
}

describe('what actually happened', () => {
	// A job completes successfully having skipped every row it could not
	// parse, so 'completed' beside four thousand errored rows is a job that
	// imported nothing and reported success.
	it('separates a clean run from one that rejected rows', () => {
		expect(outcome(job())).toBe('clean');
		expect(outcome(job({ errored_rows: 20, inserted_rows: 80 }))).toBe('partial');
		expect(outcomeTone('partial')).toBe('warn');
	});

	it('calls out a job that finished having written nothing', () => {
		const nothing = job({ errored_rows: 100, inserted_rows: 0, updated_rows: 0 });
		expect(outcome(nothing)).toBe('nothing');
		expect(outcomeTone('nothing')).toBe('danger');
		expect(OUTCOME_LABELS.nothing).toContain('nothing imported');
	});

	it('does not judge a job that has not finished', () => {
		expect(outcome(job({ status: 'running', errored_rows: 5 }))).toBe('running');
		expect(outcome(job({ status: 'pending' }))).toBe('running');
		expect(outcome(job({ status: 'canceled' }))).toBe('stopped');
		expect(outcome(job({ status: 'failed' }))).toBe('failed');
	});

	it('counts written rows as inserted plus updated, not processed', () => {
		expect(written(job({ inserted_rows: 60, updated_rows: 20, processed_rows: 100 }))).toBe(80);
	});
});

describe('the controls a job offers', () => {
	// A dry run wrote nothing, so a rollback of one is a no-op dressed as a
	// repair.
	it('never offers to roll back a dry run', () => {
		expect(rollbackable(job({ dry_run: true }))).toBe(false);
		expect(rollbackable(job())).toBe(true);
	});

	it('offers no rollback where nothing was written', () => {
		expect(rollbackable(job({ inserted_rows: 0, updated_rows: 0 }))).toBe(false);
		expect(rollbackable(job({ status: 'running' }))).toBe(false);
	});

	it('offers cancellation only while a job can still stop', () => {
		expect(cancelable(job({ status: 'running' }))).toBe(true);
		expect(cancelable(job({ status: 'pending' }))).toBe(true);
		expect(cancelable(job())).toBe(false);
	});
});

describe('progress', () => {
	// total_rows is zero until the file has been counted, so a bar drawn from
	// processed alone sits at zero and then jumps.
	it('is complete once the job is, whatever the counters say', () => {
		expect(progress(job({ total_rows: 0, processed_rows: 0 }))).toBe(1);
		expect(progress(job({ status: 'running', total_rows: 0, processed_rows: 40 }))).toBe(0);
		expect(progress(job({ status: 'running', total_rows: 100, processed_rows: 40 }))).toBe(0.4);
	});

	it('reports a rejection rate only once rows have been read', () => {
		expect(rejectionRate(job({ processed_rows: 100, errored_rows: 25 }))).toBe(25);
		expect(rejectionRate(job({ processed_rows: 0 }))).toBeNull();
	});
});

describe('reading the plugin', () => {
	it('reads the history from the jobs key the plugin answers with', async () => {
		const { listJobs } = await import('./bulk-import');
		const client = { get: async () => ({ jobs: [job()], total_count: 7 }) } as never;
		const page = await listJobs(client, 25, 0);
		expect(page.data).toHaveLength(1);
		expect(page.total_count).toBe(7);
	});

	it('reads a job\'s rows one level down in the envelope', async () => {
		const { listRows } = await import('./bulk-import');
		const client = {
			get: async () => ({ data: { rows: [{ id: 'r', row_index: 4, status: 'errored' }], total_count: 9 } }),
		} as never;
		const got = await listRows(client, 'j1', 'errored', 100);
		expect(got.rows[0].row_index).toBe(4);
		expect(got.total).toBe(9);
	});
});

describe('outcomes after the fact', () => {
	it('names a rollback rather than calling it stopped', () => {
		expect(outcome(job({ status: 'rolled_back' }))).toBe('rolled_back');
		expect(OUTCOME_LABELS.rolled_back).toBe('Rolled back');
	});

	it('offers a rollback on a job that created entries, rejected rows or not', () => {
		expect(rollbackable(job({ status: 'completed_with_errors', errored_rows: 3 }))).toBe(true);
		expect(rollbackable(job({ inserted_rows: 0, updated_rows: 5 }))).toBe(false);
	});
});

describe('mapping', () => {
	it('offers the entry columns first, then the fields the schema writes', async () => {
		const { mappingTargets } = await import('./bulk-import');
		const targets = mappingTargets([
			{ name: 'id', field_type: 'uid', system: true },
			{ name: 'views', field_type: 'number' },
			{ name: 'featured', field_type: 'boolean' },
			{ name: 'tags', field_type: 'json' },
		]);
		expect(targets.map((t) => t.value)).toEqual(['entry.slug', 'entry.title', 'entry.status', 'views', 'featured', 'tags']);
		expect(targets.map((t) => t.dataType).slice(3)).toEqual(['number', 'boolean', 'json']);
	});

	it('coerces an integer field as an integer and a decimal field as a decimal', async () => {
		const { dataTypeFor } = await import('./bulk-import');
		expect(['integer', 'int', 'bigint'].map(dataTypeFor)).toEqual(['integer', 'integer', 'integer']);
		expect(dataTypeFor('decimal')).toBe('decimal');
		expect(dataTypeFor('number')).toBe('number');
		expect(dataTypeFor('float')).toBe('float');
	});

	it('guesses by name, ignoring case and separators, and leaves the rest unmapped', async () => {
		const { mappingTargets, suggestMapping } = await import('./bulk-import');
		const targets = mappingTargets([{ name: 'page_views', field_type: 'number' }, { name: 'summary' }]);
		const chosen = suggestMapping(['Slug', 'Name', 'Page Views', 'Other'], targets);
		expect(chosen).toEqual({
			'entry.slug': 'Slug',
			'entry.title': 'Name',
			'entry.status': '',
			page_views: 'Page Views',
			summary: '',
		});
	});

	it('reads the format from a file name', async () => {
		const { formatFromName } = await import('./bulk-import');
		expect(formatFromName('Export.JSONL')).toBe('ndjson');
		expect(formatFromName('a.yml')).toBe('yaml');
		expect(formatFromName('notes.txt')).toBeNull();
	});
});

describe('a refused import call', () => {
	function answer(status: number, body: unknown): typeof fetch {
		return (async () =>
			new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;
	}

	async function refusal(status: number, body: unknown): Promise<ApiError> {
		try {
			await previewImport(answer(status, body), { source_url: 'https://example.com/a.csv' });
		} catch (err) {
			return err as ApiError;
		}
		throw new Error('the call did not fail');
	}

	it('shows a refusal written for the operator as it was sent', async () => {
		expect((await refusal(400, { error: 'source_url must be http or https', code: 'bad_request' })).message).toBe('source_url must be http or https');
	});

	// The engine's refusals carry a code. A 4xx body without one, such as a
	// proxy's, is not a sentence written for the operator.
	it('says it in its own words when a refusal carries no code', async () => {
		const err = await refusal(413, { error: 'client intended to send too large body' });
		expect(err.message).toBe('The file is larger than the 50 MB an import takes. Split it and import the parts.');
		expect((await refusal(400, { error: 'bad request from upstream' })).message).toBe('The request was refused.');
	});

	// The engine's 413 names the route's request limit, the base64 encoding
	// of the file plus its envelope, which is not the file size the drawer
	// states.
	it('names the file limit the drawer states when the engine refuses the size', async () => {
		const err = await refusal(413, { error: 'Request body exceeds the 70953644 byte limit.', code: 'payload_too_large' });
		expect(err.message).toBe('The file is larger than the 50 MB an import takes. Split it and import the parts.');
	});

	// A 5xx body can carry driver detail, and the outage sentence is the one
	// that tells the operator what to do.
	it('keeps the body of an outage off the page and says the engine did not answer', async () => {
		const err = await refusal(503, { error: 'dial tcp 10.0.0.4:5432: connection refused' });
		expect(err.message).not.toContain('10.0.0.4');
		expect(err.message).toBe('The engine is unavailable, so nothing was imported. Try again in a moment.');
	});

	// The engine answers a start once it has stored the job and imports the
	// rows after that, so its own 5xx means no job was made. A proxy's 502 or
	// 504 can arrive after the job was made, so it claims only what is known.
	describe('on a start', () => {
		const UNCONFIRMED = 'Could not confirm whether the import started. Check the entries before you try again.';
		async function started(res: Response): Promise<ApiError> {
			try {
				await startImport((async () => res) as unknown as typeof fetch, { source_url: 'https://example.com/a.csv', content_type: 'posts', field_mappings: [], mode: 'insert' } as never);
			} catch (err) {
				return err as ApiError;
			}
			throw new Error('the call did not fail');
		}

		it('claims nothing about a proxy page or an uncoded 5xx', async () => {
			const timeout = await started(new Response('<html>504 Gateway Time-out</html>', { status: 504 }));
			expect(timeout.message).toBe(UNCONFIRMED);
			const gateway = await started(new Response(JSON.stringify({ error: 'Bad Gateway' }), { status: 502 }));
			expect(gateway.message).toBe(UNCONFIRMED);
		});

		it('says nothing was imported when the engine itself answered the 5xx', async () => {
			const err = await started(new Response(JSON.stringify({ error: 'failed to create import job', code: 'service_unavailable' }), { status: 503 }));
			expect(err.message).toBe('The engine is unavailable, so nothing was imported. Try again in a moment.');
		});
	});

	it('says nothing was imported by a preview, which imports nothing, whoever answered', async () => {
		const res = new Response('<html>504 Gateway Time-out</html>', { status: 504 });
		const err = (await previewImport((async () => res) as unknown as typeof fetch, { source_url: 'https://example.com/a.csv' }).catch((e: unknown) => e)) as ApiError;
		expect(err.message).toBe('The engine is unavailable, so nothing was imported. Try again in a moment.');
	});

	it('keeps the body of any other engine failure off the page', async () => {
		const err = await refusal(500, { error: 'pq: relation "import_jobs" does not exist' });
		expect(err.message).toBe('Could not complete the request. Nothing was imported. Try again.');
	});
});
