// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));

import PagesPage from './+page.svelte';
import { outlineSkips } from '$lib/test-outline';

afterEach(cleanup);

const settings = {
	brand: { name: 'Acme', logo_url: '', favicon_url: '', accent: '', welcome: '' },
	menu: { hidden: [], pinned: [], links: [] },
	home_page: '',
};
const welcome = { slug: 'welcome', title: 'Welcome', roles: [], position: 0 };

function props(over: Record<string, unknown> = {}, form: unknown = null) {
	return {
		data: {
			gate: { state: 'ok' },
			entitled: true,
			settings,
			pages: [],
			user: { roles: ['admin'] },
			...over,
		},
		form,
	} as never;
}

describe('the pages tab', () => {
	it('opens on the Pages tab of the customization strip', () => {
		render(PagesPage, { props: props() });
		expect(screen.getByRole('tab', { name: 'Pages' }).getAttribute('aria-selected')).toBe('true');
	});

	it('gives the section a level 2 heading under the page title', () => {
		render(PagesPage, { props: props() });
		expect(screen.getByRole('heading', { name: 'Pages', level: 2 })).toBeTruthy();
	});

	it('says the engine did not answer rather than that there are no pages', () => {
		const { container } = render(PagesPage, { props: props({ gate: { state: 'unavailable' }, entitled: false }) });
		expect(container.textContent).toContain('so customization did not load');
		expect(container.textContent).not.toContain('No pages yet');
	});

	it('offers the first page from the empty pages list', () => {
		render(PagesPage, { props: props() });
		expect(screen.getAllByRole('button', { name: /new page/i })).toHaveLength(2);
	});

	it('marks the page that leads the dashboard', () => {
		render(PagesPage, { props: props({ pages: [welcome], settings: { ...settings, home_page: 'welcome' } }) });
		expect(screen.getByRole('link', { name: 'Welcome' }).parentElement?.textContent).toContain('Dashboard');
	});

	it('shows a failed page delete in the Pages card', () => {
		const failed = 'Could not delete the page. Try again.';
		render(PagesPage, { props: props({ pages: [welcome] }, { pageDeleteError: failed }) });
		const alert = screen.getByText(failed);
		const pagesHeading = screen.getByRole('heading', { name: 'Pages' });
		expect(pagesHeading.compareDocumentPosition(alert) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
	});
});

/*
 * The page drawer reads its own failure key. A drawer opened over an older
 * failure starts clean.
 */
describe('the page drawer and older failures', () => {
	const pageText = () => document.body.querySelector('form#page-form')?.textContent ?? '';

	it('shows a failed create first in the open page drawer, and not when reopened', async () => {
		const { rerender } = render(PagesPage, { props: props() });
		await fireEvent.click(screen.getAllByRole('button', { name: /new page/i })[0]);
		await rerender(props({}, { action: 'createPage', pageError: 'Check the highlighted fields.', fields: { title: 'Required' } }));
		expect(pageText()).toContain('Check the highlighted fields.');
		await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		await fireEvent.click(screen.getAllByRole('button', { name: /new page/i })[0]);
		expect(pageText()).not.toContain('Check the highlighted fields.');
	});
});

describe('heading outline', () => {
	it('steps its headings down one level at a time', () => {
		const { container } = render(PagesPage, { props: props({ pages: [welcome] }) });
		expect(outlineSkips(container)).toEqual([]);
	});

	it('steps its headings down one level at a time while the feature is not enabled', () => {
		const { container } = render(PagesPage, { props: props({ entitled: false }) });
		expect(container.querySelector('[data-testid="not-enabled"]')).toBeTruthy();
		expect(outlineSkips(container)).toEqual([]);
	});
});
