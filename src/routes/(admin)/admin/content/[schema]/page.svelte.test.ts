// @vitest-environment jsdom
import { render, screen, cleanup, fireEvent } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const nav = vi.hoisted(() => ({
	goto: vi.fn(async (_url: string, _opts?: Record<string, unknown>) => {}),
}));
vi.mock('$app/navigation', () => nav);
vi.mock('$app/forms', () => ({ enhance: () => ({ destroy: () => {} }) }));

import ContentListPage from './+page.svelte';
import type { PageData } from './$types';

afterEach(cleanup);

function items(count: number, from = 0) {
	return Array.from({ length: count }, (_, i) => ({
		id: `entry-${from + i}-0000-0000-0000`,
		created_at: '2026-01-01T00:00:00Z',
		updated_at: '2026-01-02T00:00:00Z',
		data: { title: `Entry ${from + i}`, _status: 'published' } as Record<string, unknown>,
	}));
}

/**
 * The page reads none of the layout data (user, entitlements), so the fixture
 * carries only what this page renders and is asserted against PageData once.
 */
function data(overrides: Record<string, unknown> = {}): PageData {
	// A test names its rows as an array. The load hands the page a read that
	// succeeded, or the gate of one that failed.
	const { items: rows, ...rest } = overrides;
	const read = Array.isArray(rows) ? { ok: true, value: rows } : (rows ?? { ok: true, value: items(100) });
	return {
		schemas: { ok: true, value: [{ name: 'posts', display_name: 'Posts' }] },
		schemaDef: {
			name: 'posts',
			display_name: 'Posts',
			fields: [{ name: 'title', field_type: 'string', system: false }],
			with_draft_publish: false,
			with_updated_at: false,
		},
		activeSchema: 'posts',
		status: null,
		limit: 100,
		offset: 0,
		total: 4000,
		...rest,
		items: read,
	} as unknown as PageData;
}

// The length of the page is not the size of the collection. The count comes
// from the envelope total, stated once by Pagination.
describe('content listing states the collection total', () => {
	it('names the way back to Content', () => {
		// Three rows, because the header is the subject. A hundred rows made this
		// the slowest first render in the file, and it timed out on a busy machine.
		render(ContentListPage, { props: { data: data({ items: items(3) }), form: null } });

		// The sidebar cannot name this page: it marks Content, and Content is
		// the collection index rather than this page.
		// The shell's back link leads the row and the breadcrumb follows it, so
		// Content is named once, as the way back. The trail starts after it.
		const links = screen.getAllByRole('link', { name: 'Content' });
		expect(links).toHaveLength(1);
		const [back] = links;
		expect(back.getAttribute('data-testid')).toBe('page-back');
		expect(back.getAttribute('href')).toBe('/admin/content');
		const crumb = document.querySelector('nav[aria-label]');
		expect(crumb, 'the breadcrumb is missing').not.toBeNull();
		expect(crumb?.textContent).toContain('Posts');
		expect(crumb?.textContent).not.toContain('Content');
	});

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('gives the entry name, the only way into an entry, a touch-sized target', () => {
		render(ContentListPage, { props: { data: data({ items: items(1) }), form: null } });
		const link = document.querySelector('td[data-cell="truncate"] a') as HTMLAnchorElement;
		expect(link.className).toContain('hit-area');
		expect(link.className).toContain('relative');
	});

	it('reports the total, not the size of the page on screen', () => {
		render(ContentListPage, { props: { data: data(), form: null } });

		// Grouped, because the pager sits under a table that groups its own
		// figures and a screen that prints the same kind of number two ways
		// reads as two different measurements.
		expect(screen.getByText('1 to 100 of 4,000')).toBeTruthy();
	});

	it('states the count in exactly one place', () => {
		render(ContentListPage, { props: { data: data(), form: null } });

		expect(screen.queryByText(/\d+\s+entries/)).toBeNull();
	});

	it('offers a page link per page of the collection, not just prev and next', () => {
		render(ContentListPage, { props: { data: data(), form: null } });

		expect(screen.getByRole('link', { name: '40' })).toBeTruthy();
		expect(screen.getByRole('link', { name: 'Next page' })).toBeTruthy();
	});

	it('disables the previous link on the first page', () => {
		const { container } = render(ContentListPage, { props: { data: data(), form: null } });

		const prev = container.querySelector('[aria-label="Previous page"]') as HTMLButtonElement;
		expect(prev.tagName).toBe('BUTTON');
		expect(prev.disabled).toBe(true);
	});
});

// An offset arrives in the URL and need not sit on a page boundary.
describe('content listing derives the page from the offset', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('floors an offset that is not a multiple of the limit onto its page', () => {
		render(ContentListPage, {
			props: { data: data({ offset: 150, items: items(100, 150) }), form: null },
		});

		const current = screen.getByRole('link', { current: 'page' });
		expect(current.textContent?.trim()).toBe('2');
	});

	it('marks the last page current at the final offset', () => {
		render(ContentListPage, {
			props: { data: data({ offset: 3900, items: items(100, 3900) }), form: null },
		});

		const current = screen.getByRole('link', { current: 'page' });
		expect(current.textContent?.trim()).toBe('40');
	});

	it('links each page by querystring, so a page turn works before the page hydrates', () => {
		render(ContentListPage, {
			props: { data: data({ offset: 150, items: items(100, 150) }), form: null },
		});

		const target = new URL(screen.getByRole('link', { name: '3' }).getAttribute('href') ?? '', 'http://localhost');
		expect(target.pathname).toBe('/admin/content/posts');
		expect(target.searchParams.get('offset')).toBe('200');
		expect(target.searchParams.get('limit')).toBe('100');
	});
});

describe('content listing with no entries', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('shows the empty state and no pager', () => {
		render(ContentListPage, { props: { data: data({ items: [], total: 0 }), form: null } });

		expect(screen.getByText('No entries yet')).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Next page' })).toBeNull();
	});
});

// The table heads a column ACTIONS. Whatever is under it has to be under it
// for everyone, not only for a pointer that happens to cross the row.
describe('the actions column holds its control', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('renders the row action for every row', () => {
		render(ContentListPage, { props: { data: data({ items: items(3) }), form: null } });

		for (const n of [0, 1, 2]) {
			expect(screen.getByRole('button', { name: `Delete Entry ${n}` })).toBeTruthy();
		}
	});

	it('does not hide the row action until the row is hovered', () => {
		// A control in the document but painted at zero opacity leaves the
		// column reading as empty under a heading that promises an action. The
		// class is the subject here because the class is what would hide it.
		render(ContentListPage, { props: { data: data({ items: items(1) }), form: null } });

		const action = screen.getByRole('button', { name: 'Delete Entry 0' });
		expect(action.className).not.toContain('opacity-0');
	});

	it('heads no column the body leaves empty', () => {
		const { container } = render(ContentListPage, {
			props: { data: data({ items: items(1) }), form: null },
		});

		const headers = [...container.querySelectorAll('thead th')];
		const cells = [...container.querySelectorAll('tbody tr')][0].querySelectorAll('td');
		expect(cells).toHaveLength(headers.length);

		const actions = headers.findIndex((th) => th.textContent?.trim() === 'Actions');
		expect(actions).toBeGreaterThan(-1);
		expect(cells[actions].querySelector('button')).toBeTruthy();
	});
});

describe('content listing row links', () => {
	it('carry the page they were opened from so the entry can hand it back', () => {
		const { container } = render(ContentListPage, {
			props: { data: data({ offset: 200, items: items(100, 200) }), form: null },
		});
		const link = container.querySelector('tbody a[href^="/admin/content/posts/entry-200"]');
		expect(link?.getAttribute('href')).toBe('/admin/content/posts/entry-200-0000-0000-0000?limit=100&offset=200');
	});

	it('stay a clean path on the first page', () => {
		const { container } = render(ContentListPage, { props: { data: data(), form: null } });
		const link = container.querySelector('tbody a[href^="/admin/content/posts/entry-0"]');
		expect(link?.getAttribute('href')).toBe('/admin/content/posts/entry-0-0000-0000-0000');
	});
});

describe('content listing reads', () => {
	it('says the entries could not be read instead of calling the collection empty', () => {
		render(ContentListPage, {
			props: { data: data({ items: { ok: false, gate: { state: 'unavailable' } }, total: 0 }), form: null },
		});

		expect(screen.getByText(/entries did not load/)).toBeTruthy();
		expect(screen.queryByText('No entries yet')).toBeNull();
		expect(screen.queryByRole('link', { name: /New entry/ })).toBeNull();
	});

	it('tells a role the listing refuses that it cannot open the entries', () => {
		render(ContentListPage, {
			props: { data: data({ items: { ok: false, gate: { state: 'forbidden' } }, total: 0 }), form: null },
		});

		expect(screen.getByText(/Your role cannot open entries/)).toBeTruthy();
		expect(screen.queryByText('No entries yet')).toBeNull();
	});

	it('says the picker is missing when the collections could not be read', () => {
		render(ContentListPage, {
			props: { data: data({ schemas: { ok: false, gate: { state: 'unavailable' } } }), form: null },
		});

		expect(screen.getByText(/Could not load the other content types/)).toBeTruthy();
	});
});

describe('content listing status filter', () => {
	const drafted = (overrides: Record<string, unknown> = {}) =>
		data({
			schemaDef: {
				name: 'posts',
				display_name: 'Posts',
				fields: [{ name: 'title', field_type: 'string', system: false }],
				with_draft_publish: true,
			},
			...overrides,
		});

	it('links each status and marks the current one', () => {
		render(ContentListPage, { props: { data: drafted({ status: 'draft' }), form: null } });

		const draft = screen.getByRole('link', { name: 'Draft' });
		expect(draft.getAttribute('href')).toBe('/admin/content/posts?limit=100&status=draft');
		expect(draft.getAttribute('aria-current')).toBe('page');
		expect(screen.getByRole('link', { name: 'All' }).getAttribute('href')).toBe('/admin/content/posts?limit=100');
	});

	it('keeps the status on a page link', () => {
		render(ContentListPage, { props: { data: drafted({ status: 'published' }), form: null } });

		expect(screen.getByRole('link', { name: '2' }).getAttribute('href')).toContain('status=published');
	});

	it('names the empty subset and offers every entry back', () => {
		render(ContentListPage, { props: { data: drafted({ status: 'archived', items: [], total: 0 }), form: null } });

		expect(screen.getByText('No archived entries')).toBeTruthy();
		expect(screen.queryByText('No entries yet')).toBeNull();
	});

	it('offers no status filter on a collection without draft and publish', () => {
		render(ContentListPage, { props: { data: data(), form: null } });

		expect(screen.queryByRole('link', { name: 'Draft' })).toBeNull();
	});
});
