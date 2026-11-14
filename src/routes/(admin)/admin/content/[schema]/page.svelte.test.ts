// @vitest-environment jsdom
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const nav = vi.hoisted(() => ({
	goto: vi.fn(async (_url: string, _opts?: Record<string, unknown>) => {}),
	afterNavigate: vi.fn(),
	beforeNavigate: vi.fn(),
}));
vi.mock('$app/navigation', () => nav);
vi.mock('$app/forms', () => ({ enhance: () => ({ destroy: () => {} }) }));

import ContentListPage from './+page.svelte';
import type { PageData } from './$types';
import type { Schema } from '@lyeve-labs/client';
import { readView } from '$lib/utils/entry-view';

afterEach(cleanup);

/** What the layout streams for one related content type. */
function choices(rows: [string, string][], total = rows.length, failed = false) {
	return {
		items: rows.map(([id, title]) => ({ id, schema_name: 'tag', created_at: '', updated_at: '', data: { title } })),
		total,
		failed,
	};
}

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
	const merged = {
		schemas: { ok: true, value: [{ name: 'posts', display_name: 'Posts' }] },
		schemaDef: {
			name: 'posts',
			display_name: 'Posts',
			fields: [{ name: 'title', field_type: 'text', system: false }],
			with_draft_publish: false,
			with_updated_at: false,
		},
		activeSchema: 'posts',
		status: null,
		limit: 100,
		offset: 0,
		total: 4000,
		q: '',
		...rest,
		items: read,
	} as Record<string, unknown>;
	// The view is read from a query the way the load reads it, so a fixture
	// cannot hand the page a view the load would never produce.
	const query = (merged.query as string | undefined) ?? (merged.status ? `status=${merged.status}` : '');
	merged.view ??= readView(new URLSearchParams(query), merged.schemaDef as Schema, merged.limit as number);
	return merged as unknown as PageData;
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
				fields: [{ name: 'title', field_type: 'text', system: false }],
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

describe('content listing view', () => {
	const typed = {
		name: 'posts',
		display_name: 'Posts',
		with_draft_publish: true,
		with_updated_at: true,
		fields: [
			{ name: 'title', field_type: 'text', system: false },
			{ name: 'headline', field_type: 'text', system: false },
			{ name: 'price', field_type: 'decimal', system: false },
			{ name: 'launch', field_type: 'date', system: false },
			{ name: 'body', field_type: 'json', system: false },
		],
	};
	const viewed = (query: string, overrides: Record<string, unknown> = {}) =>
		data({ schemaDef: typed, query, items: items(2), ...overrides });

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('draws a row per condition with the operators its type allows', async () => {
		render(ContentListPage, {
			props: {
				data: viewed('filters[headline][contains]=a&filters[price][gte]=5&filters[launch][lt]=2026-01-01'),
				form: null,
			},
		});

		expect(screen.getByText('Filter 1')).toBeTruthy();
		expect(screen.getByText('Filter 3')).toBeTruthy();
		const conditions = screen.getAllByRole('combobox', { name: 'Condition' });
		expect(conditions.map((c) => c.textContent?.trim())).toEqual(['contains', 'is at least', 'is before']);

		await fireEvent.click(conditions[1]);
		const numberOps = screen.getAllByRole('option').map((o) => o.textContent?.trim());
		expect(numberOps).toEqual([
			'is',
			'is not',
			'is greater than',
			'is at least',
			'is less than',
			'is at most',
			'is empty',
			'is not empty',
		]);
		await fireEvent.keyDown(conditions[1], { key: 'Escape' });

		await fireEvent.click(conditions[0]);
		const textOps = screen.getAllByRole('option').map((o) => o.textContent?.trim());
		expect(textOps).toContain('does not contain');
		expect(textOps).not.toContain('is greater than');

		// Two conditions or more choose how they combine.
		expect(screen.getByRole('radio', { name: 'Any filter' })).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Remove filter 2' })).toBeTruthy();
	});

	it('adds a row that stays on the page until it has a value', async () => {
		render(ContentListPage, { props: { data: viewed(''), form: null } });

		expect(screen.queryByText('Filter 1')).toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: 'Add filter' }));
		expect(screen.getByText('Filter 1')).toBeTruthy();
		const hidden = [...document.querySelectorAll<HTMLInputElement>('input[type="hidden"]')].map((i) => i.name);
		expect(hidden.some((n) => n.startsWith('filters['))).toBe(false);
		expect(hidden).toContain('limit');
	});

	it('sorts by a header link and marks the order with aria-sort', () => {
		render(ContentListPage, { props: { data: viewed(''), form: null } });

		const updated = screen.getByRole('link', { name: 'Updated' });
		expect(updated.closest('th')?.getAttribute('aria-sort')).toBe('descending');
		const flipped = new URL(updated.getAttribute('href') ?? '', 'http://localhost');
		expect(flipped.searchParams.get('sort')).toBe('updated_at');
		expect(flipped.searchParams.get('limit')).toBe('100');

		const entry = screen.getByRole('link', { name: 'Entry' });
		expect(entry.closest('th')?.hasAttribute('aria-sort')).toBe(false);
		expect(new URL(entry.getAttribute('href') ?? '', 'http://localhost').searchParams.get('sort')).toBe('title');
		expect(new URL(screen.getByRole('link', { name: 'Price' }).getAttribute('href') ?? '', 'http://localhost').searchParams.get('sort')).toBe('-price');
		// A json field has no order, so its header is not a link.
		expect(screen.queryByRole('link', { name: 'Body' })).toBeNull();
		expect(screen.getByRole('columnheader', { name: 'Body' })).toBeTruthy();
	});

	it('hides a column the person turned off and keeps the Entry column', () => {
		const { container } = render(ContentListPage, {
			props: { data: viewed('columns=price,created_at'), form: null },
		});

		const headers = [...container.querySelectorAll('thead th')].map((th) => th.textContent?.trim());
		expect(headers).toEqual(['Entry', 'Price', 'Created', 'Actions']);
		expect(container.querySelectorAll('tbody tr')[0].querySelectorAll('td')).toHaveLength(4);
	});

	it('carries the whole view on row and page links', () => {
		const { container } = render(ContentListPage, {
			props: {
				data: viewed('filters[price][gte]=5&sort=title&columns=price', { q: 'spring', offset: 100, items: items(2, 100) }),
				form: null,
			},
		});

		const row = new URL(
			container.querySelector('tbody a[href^="/admin/content/posts/entry-100"]')?.getAttribute('href') ?? '',
			'http://localhost',
		);
		const page = new URL(screen.getByRole('link', { name: '3' }).getAttribute('href') ?? '', 'http://localhost');
		for (const link of [row, page]) {
			expect(link.searchParams.get('filters[price][gte]')).toBe('5');
			expect(link.searchParams.get('sort')).toBe('title');
			expect(link.searchParams.get('columns')).toBe('price');
			expect(link.searchParams.get('q')).toBe('spring');
		}
		expect(row.searchParams.get('offset')).toBe('100');
		expect(page.searchParams.get('offset')).toBe('200');
	});

	it('says no entries match and offers to clear the filters', () => {
		render(ContentListPage, {
			props: { data: viewed('filters[price][gte]=5', { items: [], total: 0 }), form: null },
		});

		expect(screen.getByText('No entries match these filters')).toBeTruthy();
		expect(screen.queryByText('No entries yet')).toBeNull();
		const clear = screen.getAllByRole('link', { name: 'Clear filters' }).at(-1) as HTMLAnchorElement;
		const target = new URL(clear.getAttribute('href') ?? '', 'http://localhost');
		expect([...target.searchParams.keys()]).toEqual(['limit']);
	});
});

describe('content listing remembers its view', () => {
	let writes: string[] = [];

	beforeEach(() => {
		vi.clearAllMocks();
		writes = [];
		Object.defineProperty(document, 'cookie', {
			configurable: true,
			get: () => '',
			set: (v: string) => {
				writes.push(v);
			},
		});
	});

	afterEach(() => {
		Reflect.deleteProperty(document, 'cookie');
	});

	function navigated(href: string) {
		const [callback] = nav.afterNavigate.mock.calls.at(-1) as unknown as [(n: { to: { url: URL } }) => void];
		callback({ to: { url: new URL(href, 'http://localhost') } });
	}

	it('writes the view after a navigation that names one, without the search or the page', () => {
		render(ContentListPage, {
			props: { data: data({ query: 'sort=title&filters[title][contains]=a', q: 'spring', offset: 100 }), form: null },
		});

		navigated('/admin/content/posts?sort=title&filters[title][contains]=a&q=spring&offset=100');

		expect(writes).toHaveLength(1);
		const [pair, ...attributes] = writes[0].split('; ');
		expect(pair.startsWith('lyeve_entry_view=')).toBe(true);
		const saved = new URLSearchParams(decodeURIComponent(pair.slice('lyeve_entry_view='.length)));
		expect(saved.get('sort')).toBe('title');
		expect(saved.get('filters[title][contains]')).toBe('a');
		expect(saved.has('q')).toBe(false);
		expect(saved.has('offset')).toBe(false);
		expect(attributes).toEqual(['Path=/admin/content/posts', 'Max-Age=31536000', 'SameSite=Lax']);
	});

	it('writes nothing on the plain list a reset opens', () => {
		render(ContentListPage, { props: { data: data(), form: null } });

		navigated('/admin/content/posts');

		expect(writes).toEqual([]);
	});

	it('writes nothing when the entries of the view failed to load', () => {
		render(ContentListPage, {
			props: {
				data: data({
					query: 'limit=100&filters[title][contains]=a',
					items: { ok: false, gate: { state: 'error', message: 'Could not load entries with these filters.' } },
					total: 0,
				}),
				form: null,
			},
		});

		navigated('/admin/content/posts?limit=100&filters[title][contains]=a');

		expect(writes).toEqual([]);
	});

	it('forgets the saved view when the new one is too large to keep', () => {
		const long = 'x'.repeat(4000);
		render(ContentListPage, { props: { data: data({ query: `limit=100&filters[title][contains]=${long}` }), form: null } });

		navigated(`/admin/content/posts?limit=100&filters[title][contains]=${long}`);

		expect(writes).toEqual(['lyeve_entry_view=; Path=/admin/content/posts; Max-Age=0; SameSite=Lax']);
	});

	it('forgets the view and opens the plain list on reset', async () => {
		render(ContentListPage, { props: { data: data({ query: 'sort=title' }), form: null } });

		await fireEvent.click(screen.getByRole('button', { name: 'Reset view' }));

		expect(writes).toEqual(['lyeve_entry_view=; Path=/admin/content/posts; Max-Age=0; SameSite=Lax']);
		expect(nav.goto).toHaveBeenCalledWith('/admin/content/posts');
	});

	it('offers no reset on the default view', () => {
		render(ContentListPage, { props: { data: data(), form: null } });

		expect(screen.queryByRole('button', { name: 'Reset view' })).toBeNull();
	});
});

describe('content listing with fields named like the entry keys', () => {
	const named = {
		name: 'orders',
		display_name: 'Orders',
		with_draft_publish: true,
		with_updated_at: false,
		fields: [
			{ name: 'title', field_type: 'text', system: false },
			{ name: 'status', field_type: 'text', system: false },
			{ name: 'published_at', field_type: 'datetime', system: false },
			{ name: 'tags', field_type: 'relation', relation_type: 'has_many', relation_to: 'tag', system: false },
		],
	};
	const ordered = (query: string, overrides: Record<string, unknown> = {}) =>
		data({ schemaDef: named, activeSchema: 'orders', query, items: items(1), ...overrides });

	beforeEach(() => {
		vi.clearAllMocks();
	});

	function headers(container: HTMLElement): string[] {
		return [...container.querySelectorAll('thead th')].map((th) => th.textContent?.trim() ?? '');
	}

	it('shows both fields as columns beside the entry status', () => {
		const { container } = render(ContentListPage, { props: { data: ordered(''), form: null } });

		expect(headers(container)).toEqual(['Entry', 'Status', 'Published At', 'Tags', 'Entry status', 'Created', 'Actions']);
	});

	it('hides and shows the entry status through _status', () => {
		const hidden = render(ContentListPage, { props: { data: ordered('columns=status,created_at'), form: null } });
		expect(headers(hidden.container)).toEqual(['Entry', 'Status', 'Created', 'Actions']);
		cleanup();

		const shown = render(ContentListPage, { props: { data: ordered('columns=_status'), form: null } });
		expect(headers(shown.container)).toEqual(['Entry', 'Entry status', 'Actions']);
	});

	it('sorts the status field and gives the entry status no sort link', () => {
		const { container } = render(ContentListPage, { props: { data: ordered(''), form: null } });

		const links = screen.getAllByRole('link', { name: 'Status' });
		expect(links).toHaveLength(1);
		expect(new URL(links[0].getAttribute('href') ?? '', 'http://localhost').searchParams.get('sort')).toBe('status');
		const entryStatus = [...container.querySelectorAll('thead th')].find((th) => th.textContent?.trim() === 'Entry status');
		expect(entryStatus?.querySelector('a')).toBeNull();
	});

	it('filters the fields by name and offers the to-many relation its operators', async () => {
		render(ContentListPage, {
			props: {
				data: ordered('filters[status][eq]=open&filters[published_at][gte]=2026-01-01T00:00:00Z&filters[tags][in]=t1', {
					relationChoices: Promise.resolve({ tag: choices([['t1', 'Urgent']]) }),
				}),
				form: null,
			},
		});

		const fields = screen.getAllByRole('combobox', { name: 'Field' });
		expect(fields.map((f) => f.textContent?.trim())).toEqual(['Status', 'Published At', 'Tags']);
		const conditions = screen.getAllByRole('combobox', { name: 'Condition' });
		expect(conditions.map((c) => c.textContent?.trim())).toEqual(['is', 'is on or after', 'is any of']);

		await fireEvent.click(fields[0]);
		const offered = screen.getAllByRole('option').map((o) => o.textContent?.trim());
		// The field takes the name, so the entry's own published_at is not offered twice.
		expect(offered.filter((o) => o === 'Published At' || o === 'Published')).toEqual(['Published At']);
		await fireEvent.keyDown(fields[0], { key: 'Escape' });

		await waitFor(() => expect(screen.getByRole('button', { name: 'Remove Urgent' })).toBeTruthy());
		await fireEvent.click(conditions[2]);
		expect(screen.getAllByRole('option').map((o) => o.textContent?.trim())).toEqual([
			'is',
			'is not',
			'is any of',
			'is none of',
			'is empty',
			'is not empty',
		]);
	});
});

describe('content listing filter rows, as a person uses them', () => {
	const typed = {
		name: 'posts',
		display_name: 'Posts',
		with_draft_publish: true,
		with_updated_at: true,
		fields: [
			{ name: 'headline', field_type: 'text', system: false },
			{ name: 'price', field_type: 'decimal', system: false },
			{ name: 'tags', field_type: 'relation', relation_type: 'has_many', relation_to: 'tag', system: false },
		],
	};
	const viewed = (query: string, overrides: Record<string, unknown> = {}) =>
		data({ schemaDef: typed, query, items: items(2), total: 2, ...overrides });

	beforeEach(() => {
		vi.clearAllMocks();
	});

	function lastNavigation() {
		return nav.afterNavigate.mock.calls.at(-1) as unknown as [(n: { from: { url: URL }; to: { url: URL } }) => void];
	}

	it('keeps a row typed into when a sort link is followed before the pause', async () => {
		const first = viewed('limit=100&filters[headline][contains]=a');
		const { rerender } = render(ContentListPage, { props: { data: first, form: null } });
		const value = screen.getByRole('textbox', { name: 'Value' }) as HTMLInputElement;

		await fireEvent.input(value, { target: { value: 'ab' } });
		await rerender({ data: viewed('limit=100&filters[headline][contains]=a&sort=title'), form: null });

		expect((screen.getByRole('textbox', { name: 'Value' }) as HTMLInputElement).value).toBe('ab');
	});

	it('draws a plain Entry header when a declared title cannot be sorted', () => {
		render(ContentListPage, {
			props: {
				data: data({
					schemaDef: { ...typed, fields: [{ name: 'title', field_type: 'rich_text', system: false }, ...typed.fields] },
					items: items(1),
				}),
				form: null,
			},
		});

		expect(screen.queryByRole('link', { name: 'Entry' })).toBeNull();
		expect(screen.getByRole('columnheader', { name: 'Entry' })).toBeTruthy();
	});

	it('reads out the count once a filter has drawn its rows', async () => {
		render(ContentListPage, { props: { data: viewed('limit=100&filters[price][gte]=5'), form: null } });
		const region = screen.getByTestId('entry-count');
		expect(region.getAttribute('aria-live')).toBe('polite');
		expect(region.getAttribute('aria-atomic')).toBe('true');
		expect(region.hasAttribute('role')).toBe(false);
		expect(region.tagName).toBe('DIV');
		expect(region.textContent).toBe('');

		const [callback] = lastNavigation();
		callback({
			from: { url: new URL('http://localhost/admin/content/posts?limit=100') },
			to: { url: new URL('http://localhost/admin/content/posts?limit=100&filters[price][gte]=5') },
		});

		await waitFor(() => expect(region.textContent).toBe('2 entries.'));
	});

	it('moves focus to the row before, then to Add filter, as rows are removed', async () => {
		render(ContentListPage, {
			props: { data: viewed('limit=100&filters[headline][contains]=a&filters[price][gte]=5'), form: null },
		});

		await fireEvent.click(screen.getByRole('button', { name: 'Remove filter 2' }));
		await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Remove filter 1' })));

		await fireEvent.click(screen.getByRole('button', { name: 'Remove filter 1' }));
		await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add filter' })));
	});

	it('refuses a number it cannot send, and sends none', async () => {
		render(ContentListPage, { props: { data: viewed('limit=100&filters[price][gte]=5'), form: null } });
		const value = screen.getByRole('textbox', { name: 'Value' });

		await fireEvent.input(value, { target: { value: '1e21' } });

		expect(screen.getByText('Enter a number, such as 12 or -4.5.')).toBeTruthy();
		const hidden = [...document.querySelectorAll<HTMLInputElement>('input[type="hidden"]')].map((i) => i.name);
		expect(hidden.some((n) => n.startsWith('filters['))).toBe(false);
	});

	it('says when a relation offers only the first entries of its content type', async () => {
		render(ContentListPage, {
			props: {
				data: viewed('limit=100&filters[tags][in]=t1', {
					relationChoices: Promise.resolve({ tag: choices([['t1', 'Urgent']], 900) }),
				}),
				form: null,
			},
		});

		await waitFor(() => expect(screen.getByText('Showing the first 1 of 900 entries in tag.')).toBeTruthy());
	});

	it('asks for an ID by hand when the related content type has no entries', async () => {
		render(ContentListPage, {
			props: {
				data: viewed('limit=100&filters[tags][eq]=t1', { relationChoices: Promise.resolve({ tag: choices([], 0) }) }),
				form: null,
			},
		});

		await waitFor(() => expect(screen.getByText('tag has no entries yet. Enter an ID by hand.')).toBeTruthy());
		expect((screen.getByRole('textbox', { name: 'Value' }) as HTMLInputElement).value).toBe('t1');
		expect(screen.queryByRole('combobox', { name: 'Value' })).toBeNull();
	});

	it('takes an ID typed by hand beside a cut list of entries', async () => {
		render(ContentListPage, {
			props: {
				data: viewed('limit=100&filters[tags][eq]=t1', {
					relationChoices: Promise.resolve({ tag: choices([['t1', 'Urgent']], 900) }),
				}),
				form: null,
			},
		});

		const typed = (await waitFor(() => screen.getByRole('textbox', { name: 'Entry ID' }))) as HTMLInputElement;
		expect(screen.getByRole('combobox', { name: 'Value' })).toBeTruthy();
		await fireEvent.input(typed, { target: { value: 'old-9' } });

		const hidden = document.querySelector<HTMLInputElement>('input[type="hidden"][name="filters[tags][eq]"]');
		expect(hidden?.value).toBe('old-9');
	});

	it('adds an ID typed by hand to a cut "is any of" list', async () => {
		render(ContentListPage, {
			props: {
				data: viewed('limit=100&filters[tags][in]=t1', {
					relationChoices: Promise.resolve({ tag: choices([['t1', 'Urgent']], 900) }),
				}),
				form: null,
			},
		});

		const typed = await waitFor(() => screen.getByRole('textbox', { name: 'Entry ID' }));
		await fireEvent.input(typed, { target: { value: 'old-9' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Add ID' }));

		const sent = [...document.querySelectorAll<HTMLInputElement>('input[type="hidden"][name="filters[tags][in]"]')].map(
			(i) => i.value,
		);
		expect(sent).toEqual(['t1', 'old-9']);
	});

	it('drops a change still waiting to apply when Back is pressed', async () => {
		const submit = vi.spyOn(HTMLFormElement.prototype, 'requestSubmit').mockImplementation(() => {});
		const { rerender } = render(ContentListPage, {
			props: { data: viewed('limit=100&filters[headline][contains]=a'), form: null },
		});
		await fireEvent.input(screen.getByRole('textbox', { name: 'Value' }), { target: { value: 'ab' } });

		const [leaving] = nav.beforeNavigate.mock.calls.at(-1) as unknown as [(n: { type: string }) => void];
		leaving({ type: 'popstate' });
		await rerender({ data: viewed('limit=100&filters[headline][contains]=x'), form: null });

		expect((screen.getByRole('textbox', { name: 'Value' }) as HTMLInputElement).value).toBe('x');
		await new Promise((resolve) => setTimeout(resolve, 400));
		expect(submit).not.toHaveBeenCalled();
		submit.mockRestore();
	});

	it('reads out the same words as the screen when a status finds nothing', async () => {
		render(ContentListPage, { props: { data: viewed('limit=100&status=draft', { items: [], total: 0 }), form: null } });
		expect(screen.getByText('No draft entries')).toBeTruthy();

		const [callback] = lastNavigation();
		callback({
			from: { url: new URL('http://localhost/admin/content/posts?limit=100') },
			to: { url: new URL('http://localhost/admin/content/posts?limit=100&status=draft') },
		});

		await waitFor(() => expect(screen.getByTestId('entry-count').textContent).toBe('No draft entries.'));
	});

	it('asks for an ID by hand when the related entries could not be read', async () => {
		render(ContentListPage, {
			props: {
				data: viewed('limit=100&filters[tags][eq]=t1', {
					relationChoices: Promise.resolve({ tag: choices([], 0, true) }),
				}),
				form: null,
			},
		});

		await waitFor(() =>
			expect(
				screen.getByText('Could not load the entries in tag. Enter an ID by hand, or reload the page to try again.'),
			).toBeTruthy(),
		);
		expect((screen.getByRole('textbox', { name: 'Value' }) as HTMLInputElement).value).toBe('t1');
	});
});

describe('content listing search form', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	/**
	 * The form data a submit sends. A browser fires formdata on the form when
	 * the data is built, both for a native submit and for the FormData the
	 * router builds from a GET form. jsdom builds it without the event, so the
	 * test fires the event a browser would.
	 */
	function submitted(): FormData {
		const form = document.querySelector<HTMLFormElement>('form[method="GET"]:has(input[name="q"])');
		if (!form) throw new Error('the search form is missing');
		const formData = new FormData(form);
		form.dispatchEvent(Object.assign(new Event('formdata'), { formData }));
		return formData;
	}

	it('leaves a blank search out of the address', () => {
		render(ContentListPage, { props: { data: data({ query: 'limit=100&filters[title][contains]=a' }), form: null } });

		const sent = submitted();
		expect(sent.has('q')).toBe(false);
		expect(sent.get('filters[title][contains]')).toBe('a');
	});

	it('keeps a search that holds words', () => {
		render(ContentListPage, { props: { data: data({ q: 'spring' }), form: null } });

		expect(submitted().get('q')).toBe('spring');
	});
});

describe('content listing filter row on a phone', () => {
	it('puts the remove button on the first line of its row, beside the field', () => {
		render(ContentListPage, { props: { data: data({ query: 'limit=100&filters[title][contains]=a' }), form: null } });

		const remove = screen.getByRole('button', { name: 'Remove filter 1' });
		const field = screen.getByRole('combobox', { name: 'Field' }).closest('[data-field]');
		for (const cell of [remove, field]) expect(cell?.className).toContain('row-start-1');
		expect(remove.className).toContain('col-start-2');
		expect(field?.className).toContain('col-start-1');
		// The condition and the value take a line each under them.
		expect(screen.getByRole('combobox', { name: 'Condition' }).closest('[data-field]')?.className).toContain('col-span-2');
		expect(document.querySelector('[data-slot="value"]')?.className).toContain('col-span-2');
	});
});
