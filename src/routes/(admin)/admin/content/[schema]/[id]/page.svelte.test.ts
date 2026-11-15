// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PageData } from './$types';

vi.mock('$app/state', () => ({ page: { url: new URL('http://localhost/admin/content/article/e1') } }));
vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));

import EntryPage from './+page.svelte';

afterEach(cleanup);

function data(overrides: Record<string, unknown> = {}): PageData {
	return {
		schemaDef: {
			name: 'article',
			display_name: 'Articles',
			fields: [{ name: 'title', field_type: 'text', required: false, unique: false, indexed: false }],
		},
		item: { id: 'e1', created_at: '2026-09-19T10:00:00Z', updated_at: '2026-09-19T10:00:00Z', data: { title: 'One' } },
		relations: {},
		revisions: [],
		localization: null,
		review: null,
		...overrides,
	} as unknown as PageData;
}

const localization = {
	locales: { default_locale: 'en', enabled_locales: ['en', 'fr'], fallback_chain: [] },
	translations: [{ locale: 'fr', title: 'Un', body: { title: 'Un' }, translation_status: 'outdated' }],
	unavailable: false,
};

describe('content entry editor, translations', () => {
	it('shows no Translations panel when the load carried none', () => {
		render(EntryPage, { props: { data: data(), form: null } });
		expect(screen.queryByTestId('translations-panel')).toBeNull();
	});

	it('renders the panel, with its beta badge, when the plugin is entitled', () => {
		render(EntryPage, { props: { data: data({ localization }), form: null } });
		expect(screen.getByTestId('translations-panel')).toBeTruthy();
		expect(screen.getByText('Beta')).toBeTruthy();
		expect(screen.getByRole('tab', { name: 'fr, outdated' })).toBeTruthy();
	});

	it('shows a translation refusal in the panel and not on the entry form', () => {
		render(EntryPage, {
			props: {
				data: data({ localization }),
				form: { error: 'Failed to save the translation.', translationLocale: 'fr' } as never,
			},
		});
		const panel = screen.getByTestId('translations-panel');
		expect(panel.textContent).toContain('Failed to save the translation.');
		expect(screen.getAllByText('Failed to save the translation.')).toHaveLength(1);
	});
});

const review = {
	assignment: {
		id: 'a1',
		entry_id: 'e1',
		definition_id: 'd1',
		current_stage_id: 's1',
		assignee_id: 'u1',
		assigned_by: 'u2',
		assigned_at: '2026-09-19T10:00:00Z',
		status: 'pending_review',
		due_at: '2099-01-01T00:00:00Z',
		overdue_at: null,
		overdue: false,
		created_at: '',
		updated_at: '',
	},
	stages: [{ stage_id: 's1', stage_name: 'Copy edit', sla_duration_seconds: 3600, entry_time: '', exit_time: null, exceeded: false, over_seconds: 0 }],
	definitions: [],
	userId: 'u1',
	unavailable: false,
	forbidden: false,
};

describe('content entry editor, review bar', () => {
	it('shows no review bar when the plugin is not in the build', () => {
		render(EntryPage, { props: { data: data(), form: null } });
		expect(screen.queryByTestId('review-bar')).toBeNull();
	});

	it('renders the bar with the stage and the actions when the plugin is present', () => {
		render(EntryPage, { props: { data: data({ review }), form: null } });
		expect(screen.getByTestId('review-bar')).toBeTruthy();
		expect(screen.getByTestId('review-stage').textContent).toContain('Copy edit');
		expect(screen.getByRole('button', { name: 'Approve' })).toBeTruthy();
	});

	it('keeps a review refusal in the bar and off the entry form', () => {
		render(EntryPage, {
			props: {
				data: data({ review }),
				form: { error: 'permission denied: activate on review:editorial', review: true, reviewStatus: 403 } as never,
			},
		});
		expect(screen.getByTestId('review-bar').textContent).toContain('permission denied: activate on review:editorial');
		expect(screen.getAllByText('permission denied: activate on review:editorial')).toHaveLength(1);
		expect(screen.getByText('Not allowed')).toBeTruthy();
	});
});

const revision = (num: number) => ({
	id: `r${num}`,
	revision_num: num,
	created_at: '2026-10-01T10:00:00Z',
	created_by: 'u1',
	data: { title: 'One' },
});

describe('content entry editor, revision history', () => {
	it('ends the history with the older revisions the plugin left out, and offers the next one', async () => {
		render(EntryPage, {
			props: {
				data: data({ revisions: [revision(9), revision(8)], revisionWindow: { hiddenOlder: 7, windowDays: 30 } }),
				form: null,
			},
		});
		await fireEvent.click(screen.getByRole('button', { name: /history/i }));
		const older = screen.getByTestId('older-hidden');
		expect(older.textContent).toContain('7 older revisions');
		expect(older.textContent).toContain('the last 30 days');
		const open = older.querySelector('input[name="rev_num"]') as HTMLInputElement;
		expect(open.value).toBe('7');
		expect(open.max).toBe('7');
	});

	it('shows no such row when the install reads every revision', async () => {
		render(EntryPage, {
			props: { data: data({ revisions: [revision(2)], revisionWindow: { hiddenOlder: 0, windowDays: null } }), form: null },
		});
		await fireEvent.click(screen.getByRole('button', { name: /history/i }));
		expect(screen.queryByTestId('older-hidden')).toBeNull();
	});

	it('renders a refused open in the history panel with the license notice, and not on the entry form', () => {
		render(EntryPage, {
			props: {
				data: data({ revisions: [revision(9)], revisionWindow: { hiddenOlder: 3, windowDays: 30 } }),
				form: {
					error: 'refused',
					revision: true,
					refused: { kind: 'feature', feature: 'example-feature', plugin: 'content', upgradeUrl: '' },
				} as never,
			},
		});
		const panel = screen.getByTestId('revision-history');
		expect(panel.querySelector('[data-testid="refusal-notice"]')).not.toBeNull();
		expect(screen.getAllByTestId('refusal-notice')).toHaveLength(1);
	});

	it('shows a revision the plugin opened, with a way to restore it', () => {
		render(EntryPage, {
			props: {
				data: data({ revisions: [revision(9)], revisionWindow: { hiddenOlder: 0, windowDays: null } }),
				form: { openedRevision: revision(4) } as never,
			},
		});
		const opened = screen.getByTestId('opened-revision');
		expect(opened.textContent).toContain('Revision 4');
		expect((opened.querySelector('input[name="rev_num"]') as HTMLInputElement).value).toBe('4');
		// The button text is text-sm, so its icon takes the text-sm rung.
		expect(opened.querySelector('button svg')?.getAttribute('width')).toBe('14');
	});
});

describe('content entry editor, a schema refusal', () => {
	it('shows the message the plugin gave beside the field it refused', () => {
		const { container } = render(EntryPage, {
			props: {
				data: data(),
				form: { error: 'The entry was not saved. Check the highlighted fields.', fieldErrors: { title: 'must be at least 3 characters' } } as never,
			},
		});
		expect(container.querySelector('[data-field-name="title"]')?.textContent).toContain('must be at least 3 characters');
	});
});

describe('content entry editor, revision count', () => {
	it('labels the history with the total and offers the next older revision past the listed ones', async () => {
		const revisions = [
			{ id: 'r600', revision_num: 600, created_at: '2026-09-19T10:00:00Z', data: { title: 'One' } },
			{ id: 'r599', revision_num: 599, created_at: '2026-09-18T10:00:00Z', data: { title: 'One' } },
		];
		render(EntryPage, { props: { data: data({ revisions, revisionTotal: 600 }), form: null } });
		const toggle = screen.getByRole('button', { name: /History \(600\)/ });
		await fireEvent.click(toggle);
		expect(screen.getByText(/Showing the newest 2 of 600 revisions/)).toBeTruthy();
		const open = screen.getByLabelText('Revision number') as HTMLInputElement;
		expect(open.name).toBe('rev_num');
		expect(open.closest('form')?.getAttribute('action')).toBe('?/openRevision');
		expect([open.value, open.min, open.max]).toEqual(['598', '1', '598']);
	});

	it('takes any older revision by number, and keeps the opener after one is open', async () => {
		const revisions = [
			{ id: 'r600', revision_num: 600, created_at: '2026-09-19T10:00:00Z', data: { title: 'One' } },
			{ id: 'r599', revision_num: 599, created_at: '2026-09-18T10:00:00Z', data: { title: 'One' } },
		];
		render(EntryPage, {
			props: { data: data({ revisions, revisionTotal: 600 }), form: { openedRevision: revision(42) } as never },
		});
		expect(screen.getByTestId('opened-revision').textContent).toContain('Revision 42');
		const open = screen.getByLabelText('Revision number') as HTMLInputElement;
		await fireEvent.input(open, { target: { value: '1' } });
		expect(open.value).toBe('1');
		expect(open.checkValidity()).toBe(true);
		const sent = new FormData(open.closest('form') as HTMLFormElement);
		expect(sent.get('rev_num')).toBe('1');
	});
});

describe('content entry editor, history off', () => {
	it('says history is off for the type and points an administrator at the settings', () => {
		render(EntryPage, { props: { data: data({ historyEnabled: false, canManageHistory: true }), form: null } });
		const off = screen.getByTestId('history-off');
		expect(off.textContent).toContain('History is off for this type.');
		expect(screen.getByRole('link', { name: 'Turn it on in settings' }).getAttribute('href')).toBe(
			'/admin/settings/content-history',
		);
		expect(screen.queryByRole('button', { name: /history/i })).toBeNull();
	});

	it('offers no settings link to a role that cannot change them', () => {
		render(EntryPage, { props: { data: data({ historyEnabled: false, canManageHistory: false }), form: null } });
		expect(screen.getByTestId('history-off').textContent).toContain('History is off for this type.');
		expect(screen.queryByRole('link', { name: 'Turn it on in settings' })).toBeNull();
	});

	it('keeps the stored versions when history was turned off after they were written', () => {
		render(EntryPage, {
			props: { data: data({ historyEnabled: false, canManageHistory: true, revisions: [revision(2)], revisionTotal: 1 }), form: null },
		});
		expect(screen.queryByTestId('history-off')).toBeNull();
		expect(screen.getByRole('button', { name: /history \(1\)/i })).toBeTruthy();
	});

	it('reads an engine that does not say as one that keeps history, as before', () => {
		render(EntryPage, { props: { data: data({ historyEnabled: null, canManageHistory: true }), form: null } });
		expect(screen.queryByTestId('history-off')).toBeNull();
	});

	it('does not call history off when the list could not be read', () => {
		render(EntryPage, {
			props: { data: data({ historyEnabled: null, revisionsFailed: true, canManageHistory: true }), form: null },
		});
		expect(screen.queryByTestId('history-off')).toBeNull();
		expect(screen.getByText('Could not load the revision history. Reload the page to try again.')).toBeTruthy();
	});
});

describe('content entry editor, many_to_many links', () => {
	const fields = [
		{ name: 'tags', field_type: 'relation', relation_type: 'many_to_many', relation_to: 'tag' },
		{ name: 'topics', field_type: 'relation', relation_type: 'many_to_many', relation_to: 'topic' },
	];
	const relations = {
		tag: { items: [{ id: 't1', title: 'Alpha' }, { id: 't2', title: 'Beta' }], total: 2, failed: false },
		topic: { items: [{ id: 'p1', title: 'Gamma' }], total: 1, failed: false },
	};

	function linkedData(linksFailed: string[]) {
		return data({
			schemaDef: { name: 'article', display_name: 'Articles', fields },
			item: { id: 'e1', created_at: '', updated_at: '', data: { tags: ['t1'] } },
			relations,
			linksFailed,
		});
	}

	it('posts the links it loaded, and leaves out a field whose links could not be read', () => {
		const { container } = render(EntryPage, { props: { data: linkedData(['topics']), form: null } });

		const posted = container.querySelector('input[name="m2m_relations"]') as HTMLInputElement;
		expect(JSON.parse(posted.value)).toEqual({ tags: ['t1'] });
		expect(
			screen.getByText('Could not load the linked entries. Reload the page to try again. Saving leaves the links as they are.'),
		).toBeTruthy();
	});

	it('posts every many_to_many field when each one loaded', () => {
		const { container } = render(EntryPage, { props: { data: linkedData([]), form: null } });

		const posted = container.querySelector('input[name="m2m_relations"]') as HTMLInputElement;
		expect(JSON.parse(posted.value)).toEqual({ tags: ['t1'], topics: [] });
		expect(screen.queryByText(/Could not load the linked entries/)).toBeNull();
	});
});

describe('content entry editor under the reader\'s access rules', () => {
	const article = {
		name: 'article',
		display_name: 'Articles',
		with_draft_publish: true,
		fields: [
			{ name: 'title', field_type: 'text' },
			{ name: 'summary', field_type: 'text' },
		],
	};
	const revisions = [{ id: 'r1', revision_num: 1, created_at: '2026-09-19T10:00:00Z', created_by: 'u1', data: { title: 'One' } }];

	it('shows the entry read-only, with no write, when the rules do not allow an update', async () => {
		const { container } = render(EntryPage, {
			props: {
				data: data({
					schemaDef: article,
					access: { hidden: [], actions: ['read'] },
					item: { ...data().item, data: { title: 'One', summary: 'Short', _status: 'draft' } },
					revisions,
					releases: { open: [], holding: [], failed: false },
				}),
				form: null,
			},
		});

		expect(screen.getByText('Your role can view entries of Articles but cannot change them.')).toBeTruthy();
		expect(screen.getByTestId('entry-read-only').textContent).toContain('Short');
		expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
		expect(screen.queryByRole('button', { name: /publish/i })).toBeNull();
		expect(container.querySelector('form[action="?/save"]')).toBeNull();
		expect(container.querySelector('input[id="field-summary"]')).toBeNull();

		await fireEvent.click(screen.getByRole('button', { name: /History/ }));
		await fireEvent.click(screen.getByRole('button', { name: /summary|title/ }));
		expect(screen.queryByRole('button', { name: /Restore/ })).toBeNull();
	});

	it('keeps the form, Save and Publish when the rules allow an update', () => {
		render(EntryPage, {
			props: {
				data: data({
					schemaDef: article,
					access: { hidden: [], actions: ['read', 'update'] },
					item: { ...data().item, data: { title: 'One', _status: 'draft' } },
				}),
				form: null,
			},
		});

		expect(screen.queryByText('Your role can view entries of Articles but cannot change them.')).toBeNull();
		expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
		expect(screen.getByRole('button', { name: /Publish/ })).toBeTruthy();
	});

	it('draws no input for a field the rules hide', () => {
		const shown = { ...article, fields: [article.fields[0]] };
		const { container } = render(EntryPage, {
			props: {
				data: data({ schemaDef: shown, access: { hidden: ['summary'], actions: ['read', 'update'] } }),
				form: null,
			},
		});

		expect(screen.queryByText('Summary')).toBeNull();
		expect(container.querySelector('#field-summary')).toBeNull();
		const posted = JSON.parse((container.querySelector('input[name="data"]') as HTMLInputElement).value);
		expect(posted).not.toHaveProperty('summary');
	});
});
