// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ImportRowsDrawer from './ImportRowsDrawer.svelte';
import type { ImportJob } from '#lib/api/bulk-import.ts';

afterEach(cleanup);

function said(): string {
	return (document.body.textContent ?? '').replace(/\s+/g, ' ');
}

const job = {
	id: 'j1',
	content_type: 'article',
	source_format: 'csv',
	source_name: 'articles.csv',
	source_kind: 'url',
	mode: 'upsert',
	upsert_key: 'entry.slug',
	total_rows: 10,
	processed_rows: 10,
	errored_rows: 3,
	inserted_rows: 6,
	updated_rows: 0,
	skipped_rows: 1,
	status: 'completed_with_errors',
	dry_run: false,
	created_at: '2026-09-26T10:00:00Z',
} as ImportJob;

function read(over: Record<string, unknown> = {}) {
	return {
		ok: true,
		value: {
			job,
			rejected: [{ id: 'r1', row_index: 4, error_message: 'Title is required', error_code: 'required' }],
			rejectedTotal: 3,
			skipped: [{ id: 's1', row_index: 7, error_message: '' }],
			skippedTotal: 1,
			...over,
		},
	};
}

function setup(detail: unknown, onclose = vi.fn()) {
	render(ImportRowsDrawer, { props: { open: true, detail: detail as never, onclose } });
	return onclose;
}

describe('ImportRowsDrawer', () => {
	it('names the import and states how it ran', () => {
		setup(read());
		expect(screen.getByRole('heading', { name: 'Import of articles.csv' })).toBeTruthy();
		const text = said();
		expect(text).toContain('Web address, csv');
		expect(text).toContain('Update it');
		expect(text).toContain('Entry slug');
	});

	it('lists each rejected row by its place in the file with its reason', () => {
		setup(read());
		const table = screen.getByRole('region', { name: 'Rejected rows of this import' });
		expect(table.textContent).toContain('5');
		expect(table.textContent).toContain('Title is required');
		expect(table.textContent).toContain('(required)');
		expect(said()).toContain('Showing the first 1 of 3. Download all to see every row.');
	});

	it('offers every rejected row as a download', () => {
		setup(read());
		const link = screen.getByRole('link', { name: /Download all 3 as CSV/ });
		expect(link.getAttribute('href')).toBe('/api/admin/imports/j1/rejected');
	});

	it('says no row was rejected and offers no download for a clean import', () => {
		setup(read({ rejected: [], rejectedTotal: 0, skipped: [] }));
		expect(said()).toContain('No row was rejected.');
		expect(screen.queryByRole('link', { name: /Download all/ })).toBeNull();
		expect(screen.queryByRole('region', { name: 'Skipped rows of this import' })).toBeNull();
	});

	it('says why a skipped row with no reason was skipped', () => {
		setup(read());
		expect(screen.getByRole('region', { name: 'Skipped rows of this import' }).textContent).toContain('Skipped');
	});

	it('says an import that no longer exists is gone', () => {
		setup({ ok: false, gate: { state: 'absent' } });
		expect(said()).toContain('This import no longer exists');
	});

	it('asks the page to close from its Close button', async () => {
		const onclose = setup(read());
		const footer = screen.getAllByRole('button', { name: 'Close' }).find((b) => !b.hasAttribute('aria-label'));
		await fireEvent.click(footer as HTMLElement);
		expect(onclose).toHaveBeenCalled();
	});
});
