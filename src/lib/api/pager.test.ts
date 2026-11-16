// @vitest-environment jsdom
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { Pagination } from '@lyeve-labs/ui-kit';
import { pageHref } from './list';

afterEach(cleanup);

function step(container: HTMLElement, label: string): HTMLElement | null {
	return container.querySelector(`[aria-label="${label}"]`);
}

/*
 * The pager these four list pages render, with the props they render it with.
 * `count` is the rows on screen, which lets a page say "51 to 100" without a
 * total. The cases below are the behavior this console needs from it.
 */
const uncounted = {
	page: 1,
	perPage: 50,
	count: 50,
	hasNext: true,
	noun: 'files',
	href: pageHref('/admin/media', 50),
};

describe('the pager the admin lists render', () => {
	// A click that lands before the page hydrates reaches no handler at all. An
	// href works from the server-rendered document.
	it('pages by link, so it works before the page hydrates', () => {
		const { container } = render(Pagination, { props: uncounted });

		const next = step(container, 'Next page');
		expect(next?.tagName).toBe('A');
		expect(next?.getAttribute('href')).toBe('/admin/media?limit=50&offset=50');
	});

	it('offers no previous page on the first one', () => {
		const { container } = render(Pagination, { props: uncounted });

		expect(step(container, 'Previous page')?.hasAttribute('href')).toBe(false);
	});

	it('never asks for a negative offset', () => {
		const { container } = render(Pagination, { props: { ...uncounted, page: 2 } });

		expect(step(container, 'Previous page')?.getAttribute('href')).toBe(
			'/admin/media?limit=50&offset=0'
		);
	});

	// A pager that states a total it did not measure is worse than one that
	// states none: these loaders only know the total when the endpoint said. The
	// rows on screen are the other way to end a sentence, and the only one an
	// uncounted list has.
	it('states the range without a total when the endpoint stated none', () => {
		const { container } = render(Pagination, { props: { ...uncounted, page: 2 } });

		expect(container.textContent).toContain('Files 51 to 100');
		expect(container.textContent).not.toContain(' of ');
	});

	// The last page is short and no total says how short, so the range has to
	// end where the rows do. Reading the page size instead would have claimed
	// fifty rows on a page holding twelve.
	it('ends the range where a short last page ends', () => {
		const { container } = render(Pagination, {
			props: { ...uncounted, page: 3, count: 12, hasNext: false },
		});

		expect(container.textContent).toContain('Files 101 to 112');
	});

	it('states the total when there is one', () => {
		const { container } = render(Pagination, { props: { ...uncounted, page: 2, total: 4210 } });

		expect(container.textContent).toContain('Files 51 to 100 of 4,210');
	});

	it('carries a search across a page change', () => {
		const { container } = render(Pagination, {
			props: {
				...uncounted,
				noun: 'collections',
				href: pageHref('/admin/content', 50, { q: 'zebra' }),
			},
		});

		expect(step(container, 'Next page')?.getAttribute('href')).toContain('q=zebra');
	});

	/*
	 * A tenant whose whole collection fits on one page is told how much of it
	 * there is and that it is all of it. There is nowhere to step to, so the
	 * pager offers no controls.
	 */
	it('states the count and offers no step when the list fits on one page', () => {
		const { container } = render(Pagination, {
			props: { ...uncounted, count: 4, hasNext: false },
		});

		expect(container.textContent).toContain('Files 1 to 4');
		expect(step(container, 'Next page')).toBeNull();
		expect(step(container, 'Previous page')).toBeNull();
	});

	// Tables group their own counts, so an ungrouped "of 12345" beside them
	// would print the same kind of number two ways on one screen.
	it('groups every figure in the range sentence', () => {
		const { container } = render(Pagination, {
			props: {
				page: 85,
				perPage: 50,
				count: 50,
				total: 12345,
				hasNext: true,
				noun: 'rows',
				href: pageHref('/admin/x', 50),
			},
		});

		expect(container.textContent).toContain('Rows 4,201 to 4,250 of 12,345');
	});
});
