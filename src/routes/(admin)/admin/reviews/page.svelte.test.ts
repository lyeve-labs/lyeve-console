// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PageData } from './$types';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import ReviewsPage from './+page.svelte';

afterEach(cleanup);

const definition = {
	definition: {
		id: 'd1',
		name: 'Editorial',
		slug: 'editorial',
		content_schema: 'article',
		publish_on_approve: true,
		created_at: '',
		updated_at: '',
	},
	stages: [
		{ id: 's1', definition_id: 'd1', name: 'Copy edit', position: 1, required_role: 'editor', sla_duration_seconds: 3600 },
		{ id: 's2', definition_id: 'd1', name: 'Sign-off', position: 2, required_role: '', sla_duration_seconds: 0 },
	],
};

const assignment = {
	id: 'a1',
	entry_id: 'e1e1e1e1-0000-0000-0000-000000000000',
	definition_id: 'd1',
	current_stage_id: 's2',
	assignee_id: '22222222-2222-2222-2222-222222222222',
	assigned_by: '',
	assigned_at: '',
	status: 'in_review',
	due_at: '2020-01-01T00:00:00Z',
	overdue_at: null,
	overdue: true,
	assignee_ids: [],
	approvals: [],
	required_approvals: 1,
	created_at: '',
	updated_at: '',
};

/** A test names each read's rows as an array. The load hands the page a read that succeeded, or the gate of one that failed. */
function read(value: unknown) {
	return Array.isArray(value) ? { ok: true, value } : value;
}

function data(overrides: Record<string, unknown> = {}): PageData {
	const merged: Record<string, unknown> = {
		operator: true,
		definitions: [definition],
		assignments: [assignment],
		total: 1,
		offset: 0,
		limit: 50,
		status: '',
		entries: {},
		entriesNamed: true,
		people: {},
		...overrides,
	};
	for (const key of ['definitions', 'assignments']) merged[key] = read(merged[key]);
	return merged as unknown as PageData;
}

describe('reviews page', () => {
	it('opens on the Assignments tab under the Beta badge', () => {
		render(ReviewsPage, { props: { data: data() } });
		expect(screen.getByText('Beta')).toBeTruthy();
		expect(screen.getByRole('tab', { name: 'Assignments' }).getAttribute('aria-selected')).toBe('true');
	});

	it('lists an assignment with its stage, status, overdue due date and a link to the entry', () => {
		render(ReviewsPage, { props: { data: data() } });
		const row = screen.getByTestId('assignment-row');
		expect(row.getAttribute('data-status')).toBe('in_review');
		expect(row.textContent).toContain('Sign-off');
		expect(row.textContent).toContain('Editorial');
		expect(row.textContent).toContain('Overdue');
		const link = row.querySelector('a') as HTMLAnchorElement;
		expect(link.getAttribute('href')).toBe('/admin/content/article/e1e1e1e1-0000-0000-0000-000000000000');
	});

	it('names the entry by its title and the assignee by their email', () => {
		render(ReviewsPage, {
			props: {
				data: data({
					entries: { [assignment.entry_id]: 'Spring launch notes' },
					people: { [assignment.assignee_id]: 'mira.costa@example.com' },
				}),
			},
		});
		const row = screen.getByTestId('assignment-row');
		expect((row.querySelector('a') as HTMLAnchorElement).textContent).toBe('Spring launch notes');
		expect(row.textContent).toContain('mira.costa@example.com');
		expect(row.textContent).not.toContain('e1e1e1e1');
		expect(row.textContent).not.toContain('22222222');
	});

	it('falls back to the short ids when the page could not read the names', () => {
		render(ReviewsPage, { props: { data: data() } });
		const row = screen.getByTestId('assignment-row');
		expect(row.textContent).toContain('e1e1e1e1');
		expect(row.textContent).toContain('22222222');
	});

	it('counts the assignments in the pager, not the definitions', () => {
		const second = { ...assignment, id: 'a2' };
		render(ReviewsPage, { props: { data: data({ assignments: [assignment, second], total: 2 }) } });
		const section = screen.getByRole('region', { name: 'Assignments' });
		expect(section.textContent).toContain('assignments 1 to 2 of 2');
		expect(section.textContent).not.toContain('definitions 1');
	});

	it('shows the approvals a quorum stage holds and the other assignees', () => {
		const quorum = {
			...assignment,
			assignee_ids: [assignment.assignee_id, '33333333-3333-3333-3333-333333333333', '44444444-4444-4444-4444-444444444444'],
			approvals: ['33333333-3333-3333-3333-333333333333'],
			required_approvals: 2,
		};
		render(ReviewsPage, { props: { data: data({ assignments: [quorum] }) } });
		const row = screen.getByTestId('assignment-row');
		expect(row.textContent).toContain('1 of 2 approvals');
		expect(row.textContent).toContain('and 2 more');
	});

	it('shows no approval count on a single-approval stage', () => {
		render(ReviewsPage, { props: { data: data() } });
		expect(screen.getByTestId('assignment-row').textContent).not.toContain('approvals');
	});

	it('filters by status through links the engine reads', () => {
		render(ReviewsPage, { props: { data: data() } });
		const group = screen.getByRole('group', { name: 'Status' });
		const hrefs = Array.from(group.querySelectorAll('a')).map((a) => a.getAttribute('href'));
		expect(hrefs).toContain('/admin/reviews?status=changes_requested');
		expect(hrefs).toContain('/admin/reviews');
	});

	it('hides the definitions from a reviewer who is not an operator', () => {
		render(ReviewsPage, { props: { data: data({ operator: false, definitions: [] }) } });
		expect(screen.queryByRole('tab', { name: 'Definitions' })).toBeNull();
		expect(screen.queryByRole('button', { name: /New definition/ })).toBeNull();
		expect(screen.getByTestId('assignment-row')).toBeTruthy();
	});

	it('lists an editor reviewer\'s queue by entry id and says why there are no titles', () => {
		render(ReviewsPage, {
			props: { data: data({ operator: false, definitions: [], entriesNamed: false }) },
		});
		expect(screen.getByText(/Entries, definitions and stages are shown by ID/)).toBeTruthy();
		const row = screen.getByTestId('assignment-row');
		expect(row.textContent).toContain('e1e1e1e1');
		expect(row.querySelector('a')).toBeNull();
	});

	it('names the read that failed in its own section, never the first-run state', () => {
		render(ReviewsPage, {
			props: { data: data({ assignments: { ok: false, gate: { state: 'unavailable' } } }) },
		});
		expect(screen.getByText(/review assignments did not load/)).toBeTruthy();
		expect(screen.queryByText('Nothing under review')).toBeNull();
	});

	// The names come from the definitions, so an unread list says why the
	// rows show ids rather than leaving the reader to guess.
	it('says the definition and stage names could not be read', () => {
		render(ReviewsPage, {
			props: { data: data({ definitions: { ok: false, gate: { state: 'error', message: 'x' } } }) },
		});
		expect(screen.getByText('Could not load the definition and stage names. Reload the page to try again.')).toBeTruthy();
		expect(screen.getByTestId('assignment-row').textContent).toContain('s2');
	});

	it('says when the rules refuse the assignment list', () => {
		render(ReviewsPage, { props: { data: data({ assignments: { ok: false, gate: { state: 'forbidden' } } }) } });
		expect(screen.getByText('You cannot see reviews')).toBeTruthy();
	});
});
