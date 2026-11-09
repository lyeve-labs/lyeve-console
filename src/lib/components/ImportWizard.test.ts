// @vitest-environment jsdom
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ImportWizard from './ImportWizard.svelte';

const nav = vi.hoisted(() => ({ goto: vi.fn(async () => {}), invalidateAll: vi.fn(async () => {}) }));
vi.mock('$app/navigation', () => nav);

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

const schemas = [{ name: 'order', fields: [{ name: 'placed_at', field_type: 'datetime' }] }];

const template = {
	id: 't1',
	name: 'Orders',
	content_type: 'order',
	field_mappings: [{ source_field: 'Placed', target_field: 'placed_at' }],
	created_at: '2026-10-01T00:00:00Z',
	updated_at: '2026-10-01T00:00:00Z',
};

describe('the import wizard', () => {
	it('says why no content type is offered when the list was not read', () => {
		render(ImportWizard, { props: { open: true, schemas: null, onstarted: vi.fn() } });
		expect(document.body.textContent).toContain('Could not load the content types');
	});

	it('says the saved mappings could not be read rather than offering none', () => {
		render(ImportWizard, { props: { open: true, schemas, templatesFailed: true, onstarted: vi.fn() } });
		expect(document.body.textContent).toContain('Could not load the mapping templates. Reload the page to try again.');
	});

	it('says there is no content type yet when the tenant has none', () => {
		render(ImportWizard, { props: { open: true, schemas: [], onstarted: vi.fn() } });
		expect(document.body.textContent).toContain('No content types yet');
	});

	it('takes a workbook and states the column and cell limits before the upload', () => {
		render(ImportWizard, { props: { open: true, schemas, onstarted: vi.fn() } });
		const text = document.body.textContent ?? '';
		expect(text).toContain('an Excel workbook (XLSX)');
		expect(text).toContain('1,024 columns');
		expect(text).toContain('cells (columns times rows)');
		expect((document.getElementById('import-file') as HTMLInputElement).accept).toContain('.xlsx');
	});

	it('accepts by extension alone, the names the format is read from', () => {
		render(ImportWizard, { props: { open: true, schemas, onstarted: vi.fn() } });
		expect((document.getElementById('import-file') as HTMLInputElement).accept).toBe(
			'.csv,.json,.ndjson,.jsonl,.yaml,.yml,.xlsx',
		);
	});

	it('names the accepted formats in a short line instead of the raw extension list', () => {
		render(ImportWizard, { props: { open: true, schemas, onstarted: vi.fn() } });
		const text = document.body.textContent ?? '';
		expect(text).toContain('CSV, JSON, NDJSON, JSONL, YAML, or XLSX');
		expect(text).not.toContain('.csv,.json');
	});

	it('writes the chosen file size in the unit the rest of the admin uses', async () => {
		render(ImportWizard, { props: { open: true, schemas, onstarted: vi.fn() } });
		const input = document.getElementById('import-file') as HTMLInputElement;
		const picked = new File([new Uint8Array(3 * 1024 * 1024)], 'orders.csv', { type: 'text/csv' });
		Object.defineProperty(input, 'files', { value: [picked] });
		await fireEvent.change(input);
		await waitFor(() => expect(document.body.textContent).toContain('orders.csv, 3.0 MB'));
		expect(document.body.textContent).not.toContain('3,072 KB');
	});

	it('offers the saved templates on the first step', () => {
		render(ImportWizard, { props: { open: true, schemas, templates: [template], onstarted: vi.fn() } });
		expect(screen.getByText('Mapping template')).toBeTruthy();
	});

	it('asks for no template when none is saved', () => {
		render(ImportWizard, { props: { open: true, schemas, onstarted: vi.fn() } });
		expect(screen.queryByText('Mapping template')).toBeNull();
	});

	it('offers every sheet of a workbook and reads the one chosen', async () => {
		const sent: Record<string, unknown>[] = [];
		const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
			const body = JSON.parse(String(init.body)) as Record<string, unknown>;
			sent.push(body);
			const columns = body.sheet === 'Returns' ? ['Returned'] : ['Placed'];
			return new Response(
				JSON.stringify({
					source_format: 'xlsx',
					source_name: 'orders.xlsx',
					columns,
					rows: [],
					total_rows: 0,
					errors: [],
					export: false,
					schemas: {},
					sheets: ['Orders', 'Returns'],
				}),
				{ status: 200, headers: { 'content-type': 'application/json' } },
			);
		});
		vi.stubGlobal('fetch', fetchMock);
		render(ImportWizard, { props: { open: true, schemas, onstarted: vi.fn() } });

		await fireEvent.click(screen.getByRole('radio', { name: 'From a web address' }));
		await fireEvent.input(document.getElementById('import-url') as HTMLInputElement, {
			target: { value: 'https://example.com/orders.xlsx' },
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Read the file' }));
		await waitFor(() => expect(document.body.textContent).toContain('The workbook has 2 sheets'));
		expect(sent[0].sheet).toBeUndefined();

		await fireEvent.click(document.getElementById('import-sheet-read') as HTMLElement);
		await fireEvent.click(screen.getByRole('option', { name: 'Returns' }));
		await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
		expect(sent[1].sheet).toBe('Returns');
	});

	it('offers no sheet choice for a workbook of one sheet', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(
						JSON.stringify({
							source_format: 'xlsx',
							source_name: 'orders.xlsx',
							columns: ['Placed'],
							rows: [],
							total_rows: 0,
							errors: [],
							export: false,
							schemas: {},
							sheets: ['Orders'],
						}),
						{ status: 200, headers: { 'content-type': 'application/json' } },
					),
			),
		);
		render(ImportWizard, { props: { open: true, schemas, onstarted: vi.fn() } });
		await fireEvent.click(screen.getByRole('radio', { name: 'From a web address' }));
		await fireEvent.input(document.getElementById('import-url') as HTMLInputElement, {
			target: { value: 'https://example.com/orders.xlsx' },
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Read the file' }));
		await waitFor(() => expect(document.body.textContent).toContain('orders.xlsx'));
		expect(document.getElementById('import-sheet-read')).toBeNull();
	});

	it('says what to do about a sheet past the column bound, by its code', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(
						JSON.stringify({ error: 'failed to parse file: reworded', code: 'bulk_import.too_many_columns' }),
						{ status: 400, headers: { 'content-type': 'application/json' } },
					),
			),
		);
		render(ImportWizard, { props: { open: true, schemas, onstarted: vi.fn() } });
		await fireEvent.click(screen.getByRole('radio', { name: 'From a web address' }));
		await fireEvent.input(document.getElementById('import-url') as HTMLInputElement, {
			target: { value: 'https://example.com/orders.xlsx' },
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Read the file' }));
		await waitFor(() => expect(document.body.textContent).toContain('Delete the columns the import does not need'));
	});
});

describe('a wizard request that the engine did not answer in its own words', () => {
	async function readWith(answer: () => Promise<Response>) {
		vi.stubGlobal('fetch', vi.fn(answer));
		render(ImportWizard, { props: { open: true, schemas, onstarted: vi.fn() } });
		await fireEvent.click(screen.getByRole('radio', { name: 'From a web address' }));
		await fireEvent.input(document.getElementById('import-url') as HTMLInputElement, {
			target: { value: 'https://example.com/orders.csv' },
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Read the file' }));
	}

	// The browser's own words for a request that never arrived are not the console's.
	it('says the request did not reach the engine instead of printing the transport error', async () => {
		await readWith(async () => {
			throw new TypeError('Failed to fetch');
		});
		await waitFor(() => expect(document.body.textContent).toContain('The engine is unavailable, so nothing was imported. Try again in a moment.'));
		expect(document.body.textContent).not.toContain('Failed to fetch');
	});

	// The engine stores the job before it answers a start, so a start whose
	// connection dropped may already be importing. Saying nothing was imported
	// would invite a second, duplicate import.
	it('claims no outcome for a start whose request did not come back', async () => {
		const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string) => {
				if (url.endsWith('/preview')) {
					return json({ source_format: 'csv', source_name: 'orders.csv', columns: ['placed_at'], rows: [], total_rows: 1, errors: [], export: false, schemas: {} });
				}
				if (url.endsWith('/validate')) return json({ total_rows: 1, valid_rows: 1, error_rows: 0, errors: [] });
				throw new TypeError('network error');
			}),
		);
		render(ImportWizard, { props: { open: true, schemas, onstarted: vi.fn() } });
		await fireEvent.click(screen.getByRole('radio', { name: 'From a web address' }));
		await fireEvent.input(document.getElementById('import-url') as HTMLInputElement, {
			target: { value: 'https://example.com/orders.csv' },
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Read the file' }));
		await fireEvent.click(await screen.findByRole('button', { name: 'Dry run' }));
		await fireEvent.click(await screen.findByRole('button', { name: 'Import 1 row' }));
		await waitFor(() => expect(document.body.textContent).toContain('Could not confirm whether the import started. Check the entries before you try again.'));
		expect(document.body.textContent).not.toContain('Nothing was imported');
		expect(document.body.textContent).not.toContain('network error');
	});

	it('reads out a dry run that every row passes', async () => {
		const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string) => {
				if (url.endsWith('/preview')) {
					return json({ source_format: 'csv', source_name: 'orders.csv', columns: ['placed_at'], rows: [], total_rows: 1, errors: [], export: false, schemas: {} });
				}
				return json({ total_rows: 1, valid_rows: 1, error_rows: 0, errors: [] });
			}),
		);
		render(ImportWizard, { props: { open: true, schemas, onstarted: vi.fn() } });
		await fireEvent.click(screen.getByRole('radio', { name: 'From a web address' }));
		await fireEvent.input(document.getElementById('import-url') as HTMLInputElement, {
			target: { value: 'https://example.com/orders.csv' },
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Read the file' }));
		await fireEvent.click(await screen.findByRole('button', { name: 'Dry run' }));
		const region = (await screen.findByText(/Every row passes\./)).closest('[aria-live="polite"]');
		expect(region?.getAttribute('aria-atomic')).toBe('true');
		expect(region?.textContent).toContain('Every row passes.');
	});

	// The console renews the engine's short token only on a request its own
	// server handles, so a request sent straight to the engine can carry one
	// that lapsed on a live session. Rerunning the loads renews it, and the
	// chosen file and mapping stay where they are.
	it('renews the session and reads the file again after a 401', async () => {
		nav.goto.mockClear();
		nav.invalidateAll.mockClear();
		const statuses = [401];
		const answer = vi.fn(async () => {
			const status = statuses.shift() ?? 400;
			return new Response(JSON.stringify(status === 401 ? { error: 'unauthorized', code: 'unauthorized' } : { error: 'The file has no header row.', code: 'bad_request' }), { status, headers: { 'content-type': 'application/json' } });
		});
		await readWith(answer);
		await waitFor(() => expect(document.body.textContent).toContain('The file has no header row.'));
		expect(answer).toHaveBeenCalledTimes(2);
		expect(nav.invalidateAll).toHaveBeenCalledTimes(1);
		expect(nav.goto).not.toHaveBeenCalled();
	});

	it('keeps the engine words of a 5xx and a code-less 4xx off the screen', async () => {
		await readWith(async () => new Response(JSON.stringify({ error: 'pq: relation "sys_jobs" does not exist', code: 'internal' }), { status: 500, headers: { 'content-type': 'application/json' } }));
		await waitFor(() => expect(document.body.textContent).toContain('Could not complete the request. Try again.'));
		expect(document.body.textContent).not.toContain('pq:');
		cleanup();
		await readWith(async () => new Response(JSON.stringify({ error: 'Request Entity Too Large' }), { status: 413, headers: { 'content-type': 'application/json' } }));
		await waitFor(() => expect(document.body.textContent).toContain('Could not complete the request. Try again.'));
		expect(document.body.textContent).not.toContain('Request Entity Too Large');
	});

	it('says to sign in again when the renewed request is refused too, and keeps the wizard open', async () => {
		nav.goto.mockClear();
		await readWith(async () => new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { 'content-type': 'application/json' } }));
		await waitFor(() => expect(document.body.textContent).toContain('Your session ended. Sign in again in another tab, then try again here.'));
		expect(nav.goto).not.toHaveBeenCalled();
		expect(document.body.textContent).not.toContain('unauthorized');
		expect((document.getElementById('import-url') as HTMLInputElement).value).toBe('https://example.com/orders.csv');
	});
});
