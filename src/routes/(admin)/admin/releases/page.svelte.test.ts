// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));

import ReleasesPage from './+page.svelte';

afterEach(cleanup);

const release = {
	id: 'r1',
	name: 'Spring launch',
	description: '',
	status: 'failed',
	failure_reason: 'entry e9 was deleted',
	created_by: 'u1',
	updated_by: 'u1',
	created_at: '2026-10-01T00:00:00Z',
	updated_at: '2026-10-02T00:00:00Z',
	item_count: 4,
};

function props(over: Record<string, unknown> = {}, form: unknown = null) {
	return {
		data: { releases: [release], total: 1, limit: 50, offset: 0, status: '', gate: { state: 'ok' }, ...over },
		form,
	} as never;
}

const createForm = () => document.body.querySelector('form#release-form') as HTMLFormElement | null;

describe('the releases list', () => {
	it('lists each release with its status in words, its entries and why it failed', () => {
		render(ReleasesPage, { props: props() });
		expect(screen.getByRole('link', { name: 'Spring launch' }).getAttribute('href')).toBe('/admin/releases/r1');
		const row = screen.getByRole('link', { name: 'Spring launch' }).closest('tr') as HTMLElement;
		expect(row.textContent).toContain('Failed');
		expect(row.textContent).toContain('4');
		expect(row.textContent).toContain('entry e9 was deleted');
		expect(row.textContent).toContain('Not scheduled');
	});

	it('offers the first release from an empty list', () => {
		render(ReleasesPage, { props: props({ releases: [], total: 0 }) });
		expect(screen.getByText('No releases yet')).toBeTruthy();
		expect(screen.getAllByRole('button', { name: /new release/i })).toHaveLength(2);
	});

	it('says a filtered list matched nothing and offers to clear the filter, without a create offer of its own', () => {
		render(ReleasesPage, { props: props({ releases: [], total: 0, status: 'scheduled' }) });
		expect(screen.getByText('No releases match these filters')).toBeTruthy();
		expect(screen.getByRole('link', { name: 'Clear filters' }).getAttribute('href')).toBe('/admin/releases');
		expect(screen.getAllByRole('button', { name: /new release/i })).toHaveLength(1);
	});

	it('filters by status through links somebody can keep', () => {
		render(ReleasesPage, { props: props({ status: 'draft' }) });
		const draft = screen.getByRole('link', { name: 'Draft' });
		expect(draft.getAttribute('href')).toBe('/admin/releases?status=draft');
		expect(draft.getAttribute('aria-current')).toBeTruthy();
	});

	it('pages past the first fifty', () => {
		const { container } = render(ReleasesPage, { props: props({ total: 120, limit: 50 }) });
		const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? '');
		expect(hrefs.some((h) => h.includes('offset=50'))).toBe(true);
	});
});

describe('a releases read that failed', () => {
	it('says so and offers no create', () => {
		const { container } = render(ReleasesPage, { props: props({ releases: [], total: 0, gate: { state: 'unavailable' } }) });
		expect(container.textContent).not.toContain('No releases yet');
		expect(screen.queryByRole('button', { name: /new release/i })).toBeNull();
	});
});

describe('creating a release', () => {
	it('posts the name and description to the create action', async () => {
		render(ReleasesPage, { props: props() });
		await fireEvent.click(screen.getByRole('button', { name: /new release/i }));
		const form = createForm() as HTMLFormElement;
		expect(form.getAttribute('action')).toBe('?/create');
		await fireEvent.input(screen.getByLabelText(/Name/), { target: { value: 'Autumn' } });
		await fireEvent.input(screen.getByLabelText(/Description/), { target: { value: 'Fall catalog' } });
		const sent = new FormData(form);
		expect([sent.get('name'), sent.get('description')]).toEqual(['Autumn', 'Fall catalog']);
	});

	it('offers nothing to create until the release has a name', async () => {
		render(ReleasesPage, { props: props() });
		await fireEvent.click(screen.getByRole('button', { name: /new release/i }));
		expect((screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement).disabled).toBe(true);
	});

	it('shows a refused create inside the open drawer, first in its form', async () => {
		const { rerender } = render(ReleasesPage, { props: props() });
		await fireEvent.click(screen.getByRole('button', { name: /new release/i }));
		await rerender(props({}, { error: 'a release named Autumn exists' }));
		expect((createForm() as HTMLFormElement).firstElementChild?.textContent).toContain('a release named Autumn exists');
	});
});

describe('the release name link', () => {
	// The name is the only way to open a release, and its link is one line of text tall.
	it('gives the link that opens a release a touch hit area', () => {
		render(ReleasesPage, { props: props() });
		const link = screen.getByRole('link', { name: 'Spring launch' });
		expect(link.className.split(/\s+/)).toEqual(expect.arrayContaining(['relative', 'hit-area']));
	});
});
