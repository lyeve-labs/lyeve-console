// @vitest-environment jsdom
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import ContentIndex from './+page.svelte';

afterEach(cleanup);

function data(overrides: Record<string, unknown> = {}) {
	return {
		schemas: {
			ok: true,
			value: [
				{ name: 'post', display_name: 'Post', fields: [{ name: 'title', type: 'string' }], with_draft_publish: true },
				{ name: 'tag', display_name: 'Tag', fields: [] },
			],
		},
		stats: { post: { rows: 12, last_updated: '2026-09-13T08:00:00Z' }, tag: { rows: 0, last_updated: null } },
		query: '',
		sort: 'name',
		dir: 'asc',
		filter: 'all',
		limit: 50,
		offset: 0,
		total: 2,
		hasMore: false,
		...overrides,
	} as never;
}

/*
 * The chips are links, so the subset lives in the URL beside the sort and
 * survives a reload and a page turn. A chip carries its name only, so no
 * chip changes width as the reader moves between them. The heading counts
 * the chosen one.
 */
describe('content index chips', () => {
	it('offers every filter, keeps the order, and marks the current one', () => {
		const { container } = render(ContentIndex, { props: { data: data({ sort: 'rows', dir: 'desc' }) } });

		const chips = [...container.querySelectorAll('nav a')];
		expect(chips.map((a) => a.getAttribute('href'))).toEqual([
			'/admin/content?limit=50&sort=rows&dir=desc',
			'/admin/content?limit=50&sort=rows&dir=desc&filter=with-rows',
			'/admin/content?limit=50&sort=rows&dir=desc&filter=empty',
			'/admin/content?limit=50&sort=rows&dir=desc&filter=draft-publish',
			'/admin/content?limit=50&sort=rows&dir=desc&filter=localized',
			'/admin/content?limit=50&sort=rows&dir=desc&filter=soft-delete',
		]);
		expect(chips[0].getAttribute('aria-current')).toBe('page');
		expect(chips.map((a) => a.textContent?.trim())).toEqual(['All', 'With rows', 'Empty', 'Draft and publish', 'Localized', 'Soft delete']);
	});

	it('carries the filter through a sort link, a page link and the search form', () => {
		const { container } = render(ContentIndex, {
			props: { data: data({ filter: 'draft-publish', total: 60, hasMore: true }) },
		});

		const sort = container.querySelector('th a[href*="sort=rows"]');
		expect(sort?.getAttribute('href')).toContain('filter=draft-publish');
		const next = [...container.querySelectorAll('a')].find((a) => a.getAttribute('href')?.includes('offset=50'));
		expect(next?.getAttribute('href')).toContain('filter=draft-publish');
		expect(container.querySelector('input[name="filter"]')?.getAttribute('value')).toBe('draft-publish');
	});

	it('names the empty subset and offers the whole set back', () => {
		const { container } = render(ContentIndex, {
			props: { data: data({ schemas: { ok: true, value: [] }, total: 0, filter: 'localized' }) },
		});

		const text = container.textContent ?? '';
		expect(text).toContain('No localized content type');
		expect(container.querySelector('a[href="/admin/content"]')?.textContent).toContain('Show every content type');
	});

	it('offers to hide the empty collections it counted on the page', () => {
		const { container } = render(ContentIndex, { props: { data: data() } });

		const text = container.textContent ?? '';
		expect(text).toContain('1 of 2 on this page has no entries.');
		expect(container.querySelector('a[href*="filter=with-rows"]')).not.toBeNull();
	});
});

describe('content index read', () => {
	it('says the collections could not be read instead of offering a first schema', () => {
		const { container } = render(ContentIndex, {
			props: {
				data: data({
					schemas: { ok: false, gate: { state: 'error', message: 'The collections could not be read.' } },
					total: 0,
				}),
			},
		});

		const text = container.textContent ?? '';
		expect(text).toContain('The collections could not be read.');
		expect(text).not.toContain('No content types yet');
		expect(container.querySelector('table')).toBeNull();
	});

	it('names the outage when the engine did not answer', () => {
		const { container } = render(ContentIndex, {
			props: { data: data({ schemas: { ok: false, gate: { state: 'unavailable' } }, total: 0 }) },
		});

		expect(container.textContent).toContain('so content did not load');
		expect(container.textContent).not.toContain('No content types yet');
	});

	it('tells a refused role so and offers neither entries nor releases', () => {
		const { container } = render(ContentIndex, {
			props: { data: data({ schemas: { ok: false, gate: { state: 'forbidden' } }, total: 0 }) },
		});

		expect(container.textContent).toContain('Your role cannot open');
		expect(container.textContent).not.toContain('No content types yet');
		expect(container.querySelector('a[href="/admin/releases"]')).toBeNull();
		expect(container.querySelector('a[aria-label^="New entry"]')).toBeNull();
	});
});

describe('content index sort headers', () => {
	it('grows the header row to the touch target height under a finger, and only there', () => {
		const { container } = render(ContentIndex, { props: { data: data() } });
		const sorts = [...container.querySelectorAll('th a[href*="sort="]')];
		expect(sorts.length).toBeGreaterThan(0);
		for (const link of sorts) {
			const cls = link.className.split(/\s+/);
			expect(cls).toContain('-my-1');
			expect(cls).toContain('coarse:-my-0.5');
			expect(cls).toContain('hit-area');
		}
	});
});

describe('content index search', () => {
	it('searches as you type, with no Search button', () => {
		const { container } = render(ContentIndex, { props: { data: data({ query: 'po' }) } });
		const form = container.querySelector('input[name="q"]')?.closest('form') as HTMLFormElement;
		expect(form.querySelector('button[type="submit"]')).toBeNull();
		expect(form.hasAttribute('data-sveltekit-keepfocus')).toBe(true);
		expect((form.querySelector('input[name="q"]') as HTMLInputElement).value).toBe('po');
	});
});
