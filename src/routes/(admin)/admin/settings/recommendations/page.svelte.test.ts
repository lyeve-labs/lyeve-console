// @vitest-environment jsdom
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy: () => {} }) }));

import RecommendationsPage from './+page.svelte';
import type { AbStats } from '$lib/api/recommendations';
import { outlineSkips } from '$lib/test-outline';

afterEach(cleanup);

function said(c: HTMLElement): string {
	return (c.textContent ?? '').replace(/\s+/g, ' ');
}

function stats(over: Partial<AbStats> = {}): AbStats {
	return {
		recommendation_count: 900,
		random_count: 100,
		total_users: 1000,
		recommendation_pct: 90,
		random_pct: 10,
		...over,
	};
}

const props = (over: Record<string, unknown> = {}, form: unknown = null) => ({
	data: {
		stats: stats(),
		gate: { state: 'ok' },
		licensed: true,
		canRecompute: true,
		trending: { ok: true, value: [] },
		readers: { ok: true, value: [] },
		...over,
	} as never,
	form: form as never,
});

describe('the gate', () => {
	it('shows the not-enabled state when the engine refuses the routes', () => {
		const { container } = render(RecommendationsPage, {
			props: props({ gate: { state: 'locked', upgradeUrl: '' }, stats: null }),
		});
		expect(said(container)).toContain('Not enabled on this engine');
	});

	it('reports a failed read as a failure, not as nobody bucketed', () => {
		const { container } = render(RecommendationsPage, {
			props: props({ gate: { state: 'error', message: 'The split could not be read.' }, stats: null }),
		});
		expect(said(container)).toContain('could not be read');
		expect(said(container)).not.toContain('No readers assigned yet');
	});
});

describe('the trending list', () => {
	it('says a failed read failed rather than that nothing is trending', () => {
		const { container } = render(RecommendationsPage, {
			props: props({ trending: { ok: false, gate: { state: 'forbidden' } } }),
		});
		expect(said(container)).toContain('Your role cannot open trending entries');
		expect(said(container)).not.toContain('No trending entries yet');
	});
});

describe('the split', () => {
	// An even split of zero people reads as a working experiment.
	it('says nobody is bucketed rather than drawing a split of none', () => {
		const { container } = render(RecommendationsPage, {
			props: props({ stats: stats({ total_users: 0, recommendation_pct: 0, random_pct: 0 }) }),
		});
		expect(said(container)).toContain('No readers assigned yet');
	});

	// A feed request puts nobody in a group. Only the request for the
	// reader's group does, so a card that pointed at the feed sent a developer
	// to a call that never fills it.
	it('names the request that puts a reader in a group', () => {
		const { container } = render(RecommendationsPage, {
			props: props({ stats: stats({ total_users: 0, recommendation_pct: 0, random_pct: 0 }) }),
		});
		expect(said(container)).toContain('a request signed in as them asks for their group');
		expect(said(container)).not.toContain('asked for a feed');
	});

	it('explains that the control arm is what the rest is measured against', () => {
		const { container } = render(RecommendationsPage, { props: props() });
		expect(said(container)).toContain('measured against');
	});

	it('warns when the arms are too far apart to be chance', () => {
		const { container } = render(RecommendationsPage, {
			props: props({ stats: stats({ recommendation_pct: 99, random_pct: 1 }) }),
		});
		expect(said(container)).toContain('The two arms are far apart.');
	});

	it('says nothing about drift on a healthy split', () => {
		const { container } = render(RecommendationsPage, {
			props: props({ stats: stats({ recommendation_pct: 52, random_pct: 48 }) }),
		});
		expect(said(container)).not.toContain('The two arms are far apart.');
	});
});

describe('the recompute', () => {
	// A 409 means somebody pressed first. Reporting it in red sends an
	// operator looking for a fault that is not there.
	it('shows an already running recompute as information, not a failure', () => {
		const { container } = render(RecommendationsPage, {
			props: props({}, { action: 'refresh', error: 'A recompute is already running. Wait for it to finish.' }),
		});
		expect(said(container)).toContain('already running');
	});

	it('reports what a finished recompute actually did', async () => {
		const { container } = render(RecommendationsPage, {
			props: props({}, { refreshed: true, pairs: 120, trending: 30, feeds: 400, ms: 125_000 }),
		});
		await vi.waitFor(() => expect(said(container)).toContain('2m 05s'));
		expect(said(container)).toContain('120 similarity pairs');
	});

	it('hides the recompute from a role that may not run one', () => {
		const { queryByText } = render(RecommendationsPage, {
			props: props({ canRecompute: false }),
		});
		expect(queryByText('Recompute')).toBeNull();
	});
});

describe('the per-reader preview', () => {
	it('marks a control-arm pick apart from a recommendation', () => {
		const { container } = render(RecommendationsPage, {
			props: props(
				{},
				{
					previewFor: 'u1',
					feed: [
						{ id: 'f1', user_id: 'u1', content_id: 'c1', score: 0.91, source: 'similar', created_at: '2026-09-22T10:00:00Z' },
						{ id: 'f2', user_id: 'u1', content_id: 'c2', score: 0, source: 'random', created_at: '2026-09-22T10:00:00Z' },
					],
				},
			),
		});
		const text = said(container);
		expect(text).toContain('Similar to something they read');
		expect(text).toContain('Random, control arm');
	});

	it('says why a reader has an empty feed rather than showing a blank table', () => {
		const { container } = render(RecommendationsPage, {
			props: props({}, { previewFor: 'u1', feed: [] }),
		});
		expect(said(container)).toContain('read nothing yet');
	});

	it('keeps the reader field as tall as its button', () => {
		// The row aligns its items to the bottom, so text under the field would
		// put the button level with that text and below the input it submits.
		const { container } = render(RecommendationsPage, { props: props() });
		const field = container.querySelector('#rec-user')!.closest('[data-field]')!;
		expect(field.lastElementChild!.contains(container.querySelector('#rec-user'))).toBe(true);
		expect(said(container)).toContain('the Users page');
	});

	// The combobox posts the label it shows. Named user_id, it posted the
	// picked reader's email, which the plugin refused as an invalid user ID,
	// and a pasted id that matched no option was cleared to nothing.
	it('posts the id field and never the combobox', () => {
		const { container } = render(RecommendationsPage, {
			props: props({ readers: { ok: true, value: [{ id: '24d6560b-540e-47b6-8957-59934db4021d', email: 'mira@example.com' }] } }),
		});
		const posted = [...container.querySelectorAll('form[action="?/preview"] [name]')].map((el) => el.getAttribute('name'));
		expect(posted).toEqual(['user_id']);
		expect(container.querySelector('[name="user_id"]')!.getAttribute('role')).not.toBe('combobox');
	});

	it('fills the id field with the reader picked by email', async () => {
		const { container } = render(RecommendationsPage, {
			props: props({ readers: { ok: true, value: [{ id: '24d6560b-540e-47b6-8957-59934db4021d', email: 'mira@example.com' }] } }),
		});
		const search = container.querySelector('#rec-reader') as HTMLInputElement;
		await fireEvent.input(search, { target: { value: 'mira' } });
		await fireEvent.keyDown(search, { key: 'ArrowDown' });
		await fireEvent.keyDown(search, { key: 'Enter' });
		expect((container.querySelector('[name="user_id"]') as HTMLInputElement).value).toBe(
			'24d6560b-540e-47b6-8957-59934db4021d',
		);
	});

	it('names the reader a preview was generated for by email', () => {
		const id = '24d6560b-540e-47b6-8957-59934db4021d';
		const { container } = render(RecommendationsPage, {
			props: props(
				{ readers: { ok: true, value: [{ id, email: 'mira@example.com' }] } },
				{ previewFor: id, feed: [{ id: 'f1', user_id: id, content_id: 'c1', score: 0.5, source: 'trending', created_at: '' }] },
			),
		});
		expect(said(container)).toContain('1 entry for mira@example.com');
	});
});

describe('what the page says recommendations do', () => {
	it('says what a reader gets, not how the plugin works', () => {
		const { container } = render(RecommendationsPage, { props: props() });
		const text = said(container);
		expect(text).toContain('each reader gets');
		expect(text).not.toContain('the plugin works out');
	});
});

// The page opened on its explainer, so a returning reader scrolled past it
// to the lists they came for. The explainer and the integration now come last.
describe('section order', () => {
	it('puts the lists first and the explainer last', () => {
		const { container } = render(RecommendationsPage, { props: props() });
		const headings = [...container.querySelectorAll('h2')].map((h) => h.textContent?.trim());
		expect(headings).toEqual([
			'Trending now',
			'What one reader would see',
			'The split',
			'Wire it into your application',
			'What recommendations do',
		]);
	});

	it('points at the split above it', () => {
		const { container } = render(RecommendationsPage, { props: props() });
		expect(said(container)).toContain('so the split above shows whether');
	});
});

describe('the preview failure', () => {
	it('shows a refused preview inside the preview form, not at the top of the page', () => {
		const { container } = render(RecommendationsPage, {
			props: props({}, { action: 'preview', error: 'That is not a user id.' }),
		});
		const formText = container.querySelector('form#rec-preview-form')?.textContent ?? '';
		expect(formText).toContain('That is not a user id.');
		expect(said(container).split('That is not a user id.').length).toBe(2);
	});
});

// A heading list that jumps from h1 to h3 reads to a screen reader as a
// missing section.
describe('heading outline', () => {
	it('steps its headings down one level at a time', () => {
		const { container } = render(RecommendationsPage, { props: props() });
		expect(outlineSkips(container)).toEqual([]);
	});

	it('steps its headings down one level at a time while the feature is not enabled', () => {
		const { container } = render(RecommendationsPage, { props: props({ gate: { state: 'locked', upgradeUrl: '' }, stats: null }) });
		expect(container.querySelector('[data-testid="not-enabled"]')).toBeTruthy();
		expect(outlineSkips(container)).toEqual([]);
	});
});
