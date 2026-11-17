// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReviewAssignment, StageSLA } from '$lib/api/review';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));

import ReviewBar from './ReviewBar.svelte';

afterEach(cleanup);

const USER = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';

function assignment(overrides: Partial<ReviewAssignment> = {}): ReviewAssignment {
	return {
		id: 'a1',
		entry_id: 'e1',
		definition_id: 'd1',
		current_stage_id: 's2',
		assignee_id: USER,
		assigned_by: OTHER,
		assigned_at: '2026-09-19T10:00:00Z',
		status: 'in_review',
		due_at: '2099-01-01T00:00:00Z',
		overdue_at: null,
		overdue: false,
		escalated_role: '',
		escalated_at: null,
		assignee_ids: [],
		approvals: [],
		required_approvals: 1,
		created_at: '2026-09-19T10:00:00Z',
		updated_at: '2026-09-19T10:00:00Z',
		...overrides,
	};
}

const stages: StageSLA[] = [
	{ stage_id: 's1', stage_name: 'Copy edit', sla_duration_seconds: 3600, entry_time: '2026-09-19T10:00:00Z', exit_time: '2026-09-19T11:00:00Z', exceeded: false, over_seconds: 0 },
	{ stage_id: 's2', stage_name: 'Sign-off', sla_duration_seconds: 7200, entry_time: '2026-09-19T11:00:00Z', exit_time: null, exceeded: false, over_seconds: 0 },
];

function buttons(): string[] {
	return Array.from(screen.getByTestId('review-actions').querySelectorAll('button')).map((b) => b.textContent?.trim() ?? '');
}

describe('ReviewBar', () => {
	it('names the stage, the assignee as you, the due date and the stage actions', () => {
		render(ReviewBar, { props: { entryId: 'e1', assignment: assignment(), stages, userId: USER } });
		expect(screen.getByTestId('review-stage').textContent).toMatch(/2 of 2:\s*Sign-off/);
		expect(screen.getByTestId('review-assignee').textContent).toBe('You');
		expect(screen.getByTestId('review-due').getAttribute('data-overdue')).toBe('false');
		expect(screen.getByText('In review')).toBeTruthy();
		expect(buttons()).toEqual(['Approve', 'Request changes', 'Reject']);
		expect(screen.getByRole('textbox', { name: 'Comment' })).toBeTruthy();
		expect((document.querySelector('input[name="assignment_id"]') as HTMLInputElement).value).toBe('a1');
	});

	it('highlights a due date that has passed even before the scheduled check marks it', () => {
		render(ReviewBar, {
			props: { entryId: 'e1', assignment: assignment({ due_at: '2020-01-01T00:00:00Z' }), stages },
		});
		expect(screen.getByTestId('review-due').getAttribute('data-overdue')).toBe('true');
		expect(screen.getByText('Overdue')).toBeTruthy();
	});

	it('offers publish on an approved assignment and unpublish on a published one, with no due date', () => {
		render(ReviewBar, {
			props: { entryId: 'e1', assignment: assignment({ status: 'approved', due_at: null }), stages },
		});
		expect(buttons()).toEqual(['Publish']);
		expect(screen.getByTestId('review-due').textContent).toContain('No SLA');
		cleanup();
		render(ReviewBar, { props: { entryId: 'e1', assignment: assignment({ status: 'published' }), stages } });
		expect(buttons()).toEqual(['Unpublish']);
	});

	it('renders the refusal inline, named as a permission when it was a 403', () => {
		render(ReviewBar, {
			props: {
				entryId: 'e1',
				assignment: assignment(),
				stages,
				error: 'permission denied: stage requires role editor',
				errorStatus: 403,
			},
		});
		expect(screen.getByText('Not allowed')).toBeTruthy();
		expect(screen.getByText('permission denied: stage requires role editor')).toBeTruthy();
		// The actions stay: the bar hides nothing up front, the engine decides.
		expect(buttons()).toEqual(['Approve', 'Request changes', 'Reject']);
	});

	it('says when the caller may not read the review at all', () => {
		render(ReviewBar, { props: { entryId: 'e1', assignment: null, stages: [], forbidden: true } });
		expect(screen.getByText("You cannot see this entry's review")).toBeTruthy();
		expect(screen.queryByTestId('review-actions')).toBeNull();
	});

	it('lets an operator start a review from a definition when the entry has none', () => {
		render(ReviewBar, {
			props: {
				entryId: 'e1',
				assignment: null,
				stages: [],
				userId: USER,
				definitions: [
					{ id: 'd1', name: 'Editorial', slug: 'editorial', content_schema: 'article', publish_on_approve: true, created_at: '', updated_at: '' },
				],
			},
		});
		expect(screen.getByTestId('review-none').textContent).toBe('Not under review.');
		expect(screen.getByRole('form', { name: 'Start a review' })).toBeTruthy();
		expect((screen.getByRole('textbox', { name: /Assignee/ }) as HTMLInputElement).value).toBe(USER);
	});

	it('posts each write with the list query the entry page carries', () => {
		const definitions = [
			{ id: 'd1', name: 'Editorial', slug: 'editorial', content_schema: 'article', publish_on_approve: true, created_at: '', updated_at: '' },
		];
		render(ReviewBar, { props: { entryId: 'e1', assignment: null, stages: [], definitions, listQuery: '?q=launch' } });
		expect(screen.getByRole('form', { name: 'Start a review' }).getAttribute('action')).toBe('?q=launch&/reviewStart');
		cleanup();
		render(ReviewBar, { props: { entryId: 'e1', assignment: assignment(), stages, userId: USER, listQuery: '?q=launch' } });
		expect(document.querySelector('form[action$="/reviewTransition"]')?.getAttribute('action')).toBe('?q=launch&/reviewTransition');
	});

	it('shows no start form to a caller with no definitions', () => {
		render(ReviewBar, { props: { entryId: 'e1', assignment: null, stages: [] } });
		expect(screen.getByTestId('review-none')).toBeTruthy();
		expect(screen.queryByRole('form', { name: 'Start a review' })).toBeNull();
	});

	it('reports a plugin that did not answer', () => {
		render(ReviewBar, { props: { entryId: 'e1', assignment: null, stages: [], unavailable: true } });
		expect(screen.getByText('Could not load the review')).toBeTruthy();
	});
});

describe('ReviewBar, several assignees', () => {
	it('names every assignee, the primary first', () => {
		render(ReviewBar, {
			props: { entryId: 'e1', assignment: assignment({ assignee_ids: [USER, OTHER] }), stages, userId: USER },
		});
		expect(screen.getByText('Assignees')).toBeTruthy();
		expect(screen.getByTestId('review-assignee').textContent).toMatch(/^You, 2222/);
	});

	it('counts the approvals a quorum stage holds against what it needs', () => {
		render(ReviewBar, {
			props: {
				entryId: 'e1',
				assignment: assignment({ assignee_ids: [USER, OTHER], approvals: [USER] }),
				stages,
				userId: USER,
				approvalsNeeded: 2,
			},
		});
		const line = screen.getByTestId('review-approvals').textContent ?? '';
		expect(line).toContain('1 of 2 approvals');
		expect(line).toContain('You have approved it.');
	});

	it('shows no approval count on a single-approval stage', () => {
		render(ReviewBar, { props: { entryId: 'e1', assignment: assignment(), stages, approvalsNeeded: 1 } });
		expect(screen.queryByTestId('review-approvals')).toBeNull();
	});

	it('says when a breach escalated the stage to a role', () => {
		render(ReviewBar, { props: { entryId: 'e1', assignment: assignment({ escalated_role: 'legal-lead' }), stages } });
		expect(screen.getByTestId('review-escalated').textContent).toContain('Escalated to legal-lead');
	});

	it('takes more assignees when a review starts', () => {
		render(ReviewBar, {
			props: {
				entryId: 'e1',
				assignment: null,
				stages: [],
				userId: USER,
				definitions: [
					{ id: 'd1', name: 'Legal', slug: 'legal', content_schema: 'article', publish_on_approve: true, created_at: '', updated_at: '' },
				],
			},
		});
		expect(document.querySelector('textarea[name="other_assignees"]')).not.toBeNull();
	});
});

describe('ReviewBar, picking the assignees', () => {
	const people = [
		{ id: USER, email: 'me@example.com' },
		{ id: OTHER, email: 'mira.costa@example.com' },
	];
	const definitions = [
		{ id: 'd1', name: 'Legal', slug: 'legal', content_schema: 'article', publish_on_approve: true, created_at: '', updated_at: '' },
	];

	it('offers the accounts by email and starts on the signed-in user', () => {
		render(ReviewBar, { props: { entryId: 'e1', assignment: null, stages: [], userId: USER, definitions, people } });
		expect(screen.queryByRole('textbox', { name: /Assignee/ })).toBeNull();
		expect((document.querySelector('input[name="assignee_id"]') as HTMLInputElement).value).toBe(USER);
		expect(screen.getByTestId('review-bar').textContent).toContain('me@example.com (you)');
		expect(document.querySelector('textarea[name="other_assignees"]')).toBeNull();
	});

	it('posts each further assignee it picks as its own field', async () => {
		render(ReviewBar, { props: { entryId: 'e1', assignment: null, stages: [], userId: USER, definitions, people } });
		const more = screen.getAllByRole('combobox').find((c) => c.getAttribute('aria-labelledby')?.startsWith('review-other-assignees'));
		await fireEvent.click(more as HTMLElement);
		await fireEvent.click(screen.getByRole('option', { name: /mira\.costa@example\.com/ }));
		const posted = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="other_assignees"]')).map((i) => i.value);
		expect(posted).toEqual([OTHER]);
	});

	it('names an assignee by email', () => {
		render(ReviewBar, {
			props: { entryId: 'e1', assignment: assignment({ assignee_ids: [USER, OTHER] }), stages, userId: USER, people },
		});
		expect(screen.getByTestId('review-assignee').textContent).toBe('You, mira.costa@example.com');
	});
});

describe('ReviewBar with no definitions to offer', () => {
	it('says the definitions could not be read instead of hiding the start form', () => {
		render(ReviewBar, { props: { entryId: 'e1', assignment: null, stages: [], definitionsFailed: true } });
		expect(screen.getByText(/Could not load the review definitions/)).toBeTruthy();
	});

	it('says nothing more for a reader who may not start a review', () => {
		render(ReviewBar, { props: { entryId: 'e1', assignment: null, stages: [] } });
		expect(screen.queryByText(/could not be read/)).toBeNull();
	});
});
