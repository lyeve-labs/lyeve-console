// @vitest-environment jsdom
import { render, cleanup, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/navigation', () => ({ invalidate: vi.fn(async () => {}), goto: vi.fn(async () => {}) }));
vi.mock('$app/forms', () => ({ enhance: () => ({ destroy: () => {} }) }));
vi.mock('$app/state', () => ({ page: { url: new URL('http://localhost/admin/imports') } }));

import ImportsPage from './+page.svelte';
import type { ImportJob } from '$lib/api/bulk-import';
import { outlineSkips } from '$lib/test-outline';

afterEach(cleanup);

function said(c: HTMLElement): string {
	return (c.textContent ?? '').replace(/\s+/g, ' ');
}

function job(over: Partial<ImportJob> = {}): ImportJob {
	return {
		id: 'j1',
		content_type: 'article',
		source_format: 'csv',
		source_name: 'articles.csv',
		source_kind: 'upload',
		mode: 'create',
		total_rows: 10,
		processed_rows: 10,
		errored_rows: 0,
		inserted_rows: 10,
		updated_rows: 0,
		skipped_rows: 0,
		status: 'completed',
		dry_run: false,
		created_at: '2026-09-26T10:00:00Z',
		...over,
	};
}

const props = (over: Record<string, unknown> = {}, form: unknown = null) => ({
	data: {
		jobs: [job()],
		total: 1,
		limit: 25,
		offset: 0,
		hasMore: false,
		gate: { state: 'ok' },
		installed: true,
		schemas: { ok: true, value: [{ name: 'article', fields: [{ name: 'title', field_type: 'text' }] }] },
		user: { id: 'u1', roles: ['super_admin'] },
		detail: null,
		...over,
	} as never,
	form: form as never,
});

/** Each heading level that follows one more than a level shallower, in document order. */
function skippedLevels(): string[] {
	const levels = [...document.querySelectorAll('h1, h2, h3, h4, h5, h6')].map((h) => ({ level: Number(h.tagName[1]), text: h.textContent?.trim() ?? '' }));
	return levels.filter((h, i) => i > 0 && h.level > levels[i - 1].level + 1).map((h) => `h${h.level} ${h.text}`);
}

describe('Imports', () => {
	it('opens on the History tab', () => {
		render(ImportsPage, { props: props({ jobs: [], total: 0 }) });
		expect(screen.getByRole('tab', { name: 'History' }).getAttribute('aria-selected')).toBe('true');
	});

	it('puts its sections one level under the page title', () => {
		render(ImportsPage, { props: props({ jobs: [], total: 0 }) });
		expect(document.querySelector('h1')).not.toBeNull();
		expect(skippedLevels()).toEqual([]);
	});

	it('explains the concept and names the sources before anything has run', () => {
		const { container } = render(ImportsPage, { props: props({ jobs: [], total: 0 }) });
		const text = said(container);
		expect(text).toContain('How an import works');
		expect(text).toContain('A dry run comes first');
		expect(text).toContain('File upload');
		expect(text).toContain('Web address');
		expect(text).toContain('Another LyEve engine');
		expect(text).toContain('No imports yet');
	});

	it('offers the rejected rows for download only where rows were rejected', () => {
		const clean = render(ImportsPage, { props: props() });
		expect(clean.container.querySelector('[aria-label^="Download the rows rejected"]')).toBeNull();
		cleanup();

		const partial = render(ImportsPage, {
			props: props({ jobs: [job({ status: 'completed_with_errors', errored_rows: 3, inserted_rows: 7 })] }),
		});
		const link = partial.container.querySelector('[aria-label^="Download the rows rejected"]');
		expect(link?.getAttribute('href')).toBe('/api/admin/imports/j1/rejected');
		expect(said(partial.container)).toContain('Finished with rows rejected');
	});

	it('states the rejected share against the rows it was read from', () => {
		const { container } = render(ImportsPage, {
			props: props({
				jobs: [job({ status: 'completed_with_errors', total_rows: 4, processed_rows: 4, errored_rows: 1, inserted_rows: 3 })],
			}),
		});
		expect(said(container)).toContain('25% of the 4 rows read');
	});

	it('follows a running import with its row count', () => {
		const { container } = render(ImportsPage, {
			props: props({ jobs: [job({ status: 'running', processed_rows: 400, total_rows: 1000 })] }),
		});
		expect(said(container)).toContain('400 of 1,000 rows');
		expect(said(container)).toContain('One import is running');
	});

	it('marks a dry run as having written nothing', () => {
		const { container } = render(ImportsPage, { props: props({ jobs: [job({ dry_run: true })] }) });
		expect(said(container)).toContain('Dry run, nothing written');
	});
});

describe('Imports reads that failed', () => {
	it('opens the rows panel with the reason when the job could not be read', () => {
		render(ImportsPage, {
			props: props({ detail: { ok: false, gate: { state: 'error', message: 'Could not load the rows of this import.' } } }),
		});
		expect(document.body.textContent).toContain('Could not load the rows of this import.');
	});

	it('says an import that no longer exists is gone', () => {
		render(ImportsPage, { props: props({ detail: { ok: false, gate: { state: 'absent' } } }) });
		expect(document.body.textContent).toContain('This import no longer exists');
	});
});

describe('Imports rollback by role', () => {
	const rolled = job({ status: 'completed', inserted_rows: 4 });

	it('offers a rollback to a super admin', () => {
		const { container } = render(ImportsPage, { props: props({ jobs: [rolled] }) });
		expect(container.querySelector('[aria-label^="Roll back"]')).not.toBeNull();
	});

	// The engine takes a rollback from any admin, so the admin who ran a bad
	// import can undo it.
	it('offers a rollback to an admin', () => {
		const { container } = render(ImportsPage, {
			props: props({ jobs: [rolled], user: { id: 'u2', roles: ['admin'] } }),
		});
		expect(container.querySelector('[aria-label^="Roll back"]')).not.toBeNull();
	});
});

describe('Imports controls', () => {
	it('offers the action that fills an empty history', () => {
		render(ImportsPage, { props: props({ jobs: [], total: 0 }) });
		expect(screen.getAllByRole('button', { name: /new import/i }).length).toBeGreaterThan(1);
	});
});

describe('Imports failures stay where they were made', () => {
	it('shows a failed row action on the page', () => {
		const failed = 'Could not roll back the import. Try again.';
		const { container } = render(ImportsPage, { props: props({}, { action: 'rollback', error: failed }) });
		expect(said(container)).toContain(failed);
	});
});

describe('the sources', () => {
	it('names the workbook among the formats', () => {
		const { container } = render(ImportsPage, { props: props() });
		expect(said(container)).toContain('an Excel workbook (XLSX)');
	});
});

// A heading list that jumps from h1 to h3 reads to a screen reader as a
// missing section.
describe('heading outline', () => {
	it('steps its headings down one level at a time', () => {
		const { container } = render(ImportsPage, { props: props() });
		expect(outlineSkips(container)).toEqual([]);
	});

	it('steps its headings down one level at a time with nothing in it yet', () => {
		const { container } = render(ImportsPage, { props: props({ jobs: [], total: 0 }) });
		expect(outlineSkips(container)).toEqual([]);
	});

	it('steps its headings down one level at a time while the feature is not enabled', () => {
		const { container } = render(ImportsPage, { props: props({ gate: { state: 'locked', upgradeUrl: '' } }) });
		expect(container.querySelector('[data-testid="not-enabled"]')).toBeTruthy();
		expect(outlineSkips(container)).toEqual([]);
	});
});
