// @vitest-environment jsdom
import { render, cleanup, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));

import SynonymsPage from './+page.svelte';
import { outlineSkips } from '$lib/test-outline';

afterEach(cleanup);

const ok = (value: unknown) => ({ ok: true, value });

function data(overrides: Record<string, unknown> = {}) {
	return { synonyms: ok({ groups: [], total: 0 }), ...overrides };
}

const groups = [{ id: 's1', base_term: 'tv', synonyms: ['telly'] }];

describe('Synonyms page', () => {
	it('says the synonyms could not be read instead of calling them empty', () => {
		const { getByText, queryByText, queryByRole } = render(SynonymsPage, {
			props: {
				data: data({ synonyms: { ok: false, gate: { state: 'error', message: 'Could not load synonym groups.' } } }) as never,
				form: null,
			},
		});
		expect(getByText('Could not load synonym groups.')).toBeTruthy();
		expect(queryByText(/No synonym groups/)).toBeNull();
		expect(queryByRole('button', { name: /New synonym/ })).toBeNull();
	});

	it('offers the first synonym group when there are none', () => {
		const { getByText, getAllByRole } = render(SynonymsPage, { props: { data: data() as never, form: null } });
		expect(getByText('No synonym groups yet')).toBeTruthy();
		expect(getAllByRole('button', { name: /New synonym/ }).length).toBeGreaterThan(0);
	});

	it('lists each group with the terms it also matches', () => {
		render(SynonymsPage, { props: { data: data({ synonyms: ok({ groups, total: 1 }) }) as never, form: null } });
		expect(screen.getByText('telly')).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Delete the synonyms of tv' })).toBeTruthy();
		expect(screen.getByRole('tab', { name: 'Synonyms' }).getAttribute('aria-selected')).toBe('true');
	});

	it('says when more synonym groups exist than were listed', () => {
		const { getByText } = render(SynonymsPage, {
			props: { data: data({ synonyms: ok({ groups, total: 612 }) }) as never, form: null },
		});
		expect(getByText(/Showing the first 1 of 612 groups/)).toBeTruthy();
	});

	it('shows a failed delete beside the groups and not in the next New synonym drawer', () => {
		const { getByText, getAllByText } = render(SynonymsPage, {
			props: {
				data: data({ synonyms: ok({ groups, total: 1 }) }) as never,
				form: { synonymDeleteError: 'Could not delete the synonym. Try again.' } as never,
			},
		});
		expect(getByText('Could not delete the synonym. Try again.')).toBeTruthy();
		expect(getAllByText('Could not delete the synonym. Try again.')).toHaveLength(1);
	});
});

describe('heading outline', () => {
	it('steps its headings down one level at a time', () => {
		const { container } = render(SynonymsPage, { props: { data: data() as never, form: null } });
		expect(outlineSkips(container)).toEqual([]);
	});

	it('steps its headings down one level at a time while the feature is not enabled', () => {
		const { container } = render(SynonymsPage, {
			props: { data: data({ synonyms: { ok: false, gate: { state: 'locked', upgradeUrl: '' } } }) as never, form: null },
		});
		expect(container.querySelector('[data-testid="not-enabled"]')).toBeTruthy();
		expect(outlineSkips(container)).toEqual([]);
	});
});
