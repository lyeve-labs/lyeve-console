// @vitest-environment jsdom
import { render, cleanup, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import SearchPage from './+page.svelte';
import type { Entitlements } from '$lib/entitlements';
import { outlineSkips } from '$lib/test-outline';

afterEach(cleanup);

const entitlements: Entitlements = {
	plan: 'example',
	state: 'active',
	features: ['search'],
	tenant_quota: 1,
};

const ok = (value: unknown) => ({ ok: true, value });

function data(overrides: Record<string, unknown> = {}) {
	return {
		entitlements,
		q: 'cats',
		limit: 20,
		offset: 0,
		results: ok({ results: [], total: 0 }),
		analytics: { ok: false, gate: { state: 'error', message: 'Could not load search analytics.' } },
		...overrides,
	};
}

describe('Search page results panel', () => {
	it('reports a backend failure instead of an empty result set', () => {
		const { getByText, queryByText } = render(SearchPage, {
			props: { data: data({ results: { ok: false, gate: { state: 'unavailable' } } }) as never },
		});
		expect(getByText(/search did not load/)).toBeTruthy();
		expect(queryByText('No results for "cats".')).toBeNull();
	});

	it('still reports an empty result set when the search succeeded', () => {
		const { getByText, queryByText } = render(SearchPage, {
			props: { data: data() as never },
		});
		expect(getByText('No results for "cats".')).toBeTruthy();
		expect(queryByText(/search did not load/)).toBeNull();
	});

	it('names the analytics that could not be read', () => {
		const { getByText } = render(SearchPage, { props: { data: data() as never } });
		expect(getByText('Could not load search analytics.')).toBeTruthy();
	});

	it('opens on the Search tab', () => {
		render(SearchPage, { props: { data: data() as never } });
		expect(screen.getByRole('tab', { name: 'Search' }).getAttribute('aria-selected')).toBe('true');
	});
});

describe('Search page counts', () => {
	const hit = (n: number) => ({ entry_id: `e${n}`, title: `Entry ${n}`, schema: 'blog', status: 'published', rank: 1 });

	// The plugin answers one page. The count is its total, not the rows held.
	it('states the total the plugin counted and pages to the rest', () => {
		const results = ok({ results: Array.from({ length: 20 }, (_, i) => hit(i)), total: 73 });
		const { getByRole, container } = render(SearchPage, { props: { data: data({ results }) as never } });
		expect(getByRole('heading', { level: 2, name: /73 results for "cats"/ })).toBeTruthy();
		expect(container.querySelector('a[href="/admin/search?q=cats&limit=20&offset=20"]')).toBeTruthy();
	});

	// A snippet is escaped HTML with live mark tags. Printed as text it showed
	// the tags and the entities, and rendered as HTML it would run the markup.
	it('renders a snippet match in a mark and escaped markup as text', () => {
		const snippets = { title: '&lt;img src=x onerror=alert(1)&gt; <mark>Lamp</mark> &amp; desk' };
		const results = ok({ results: [{ ...hit(1), snippets }], total: 1 });
		const { container } = render(SearchPage, { props: { data: data({ results }) as never } });
		const marks = container.querySelectorAll('mark');
		expect(marks).toHaveLength(1);
		expect(marks[0].textContent).toBe('Lamp');
		expect(container.querySelector('img')).toBeNull();
		const line = marks[0].parentElement;
		expect(line?.textContent).toContain('<img src=x onerror=alert(1)> Lamp & desk');
		expect(line?.textContent).not.toContain('&lt;');
	});
});

// A heading list that jumps from h1 to h3 reads to a screen reader as a
// missing section.
describe('heading outline', () => {
	it('steps its headings down one level at a time', () => {
		const { container } = render(SearchPage, { props: { data: data() as never } });
		expect(outlineSkips(container)).toEqual([]);
	});

	it('steps its headings down one level at a time while the feature is not enabled', () => {
		const { container } = render(SearchPage, {
			props: { data: data({ results: { ok: false, gate: { state: 'locked', upgradeUrl: '' } } }) as never },
		});
		expect(container.querySelector('[data-testid="not-enabled"]')).toBeTruthy();
		expect(outlineSkips(container)).toEqual([]);
	});
});
