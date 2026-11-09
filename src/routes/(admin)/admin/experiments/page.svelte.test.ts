// @vitest-environment jsdom
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy: () => {} }) }));

import ExperimentsPage from './+page.svelte';
import type { Experiment } from '$lib/api/ab-testing';

afterEach(cleanup);

function said(c: HTMLElement): string {
	return (c.textContent ?? '').replace(/\s+/g, ' ');
}

function experiment(over: Partial<Experiment> = {}): Experiment {
	return {
		id: 'e1',
		tenant_id: 'default',
		name: 'Checkout button',
		status: 'running',
		traffic_split: {},
		auto_stop_enabled: false,
		significance_threshold: 0.95,
		min_sample_size: 100,
		created_at: '2026-09-01T00:00:00Z',
		updated_at: '2026-09-01T00:00:00Z',
		...over,
	};
}

const props = (over: Record<string, unknown> = {}, form: unknown = null) => ({
	data: {
		experiments: [experiment()],
		total: 1,
		limit: 25,
		offset: 0,
		hasMore: false,
		gate: { state: 'ok' },
		licensed: true,
		...over,
	} as never,
	form: form as never,
});

describe('the gate', () => {
	it('shows the not-enabled state when the engine refuses the routes', () => {
		const { container } = render(ExperimentsPage, {
			props: props({ gate: { state: 'locked', upgradeUrl: '' }, experiments: [] }),
		});
		expect(said(container)).toContain('Not enabled on this engine');
		expect(said(container)).not.toContain('No experiments yet');
	});

	it('reports a failed read as a failure, not as nothing running', () => {
		const { container } = render(ExperimentsPage, {
			props: props({
				gate: { state: 'error', message: 'The experiments could not be read.' },
				experiments: [],
			}),
		});
		expect(said(container)).toContain('could not be read');
		expect(said(container)).not.toContain('No experiments yet');
	});
});

describe('the moves on a row', () => {
	// A control that can only answer 409 is worse than no control, so the row
	// draws the transitions the engine accepts and no others.
	it('names the search box by a label, not by its placeholder', () => {
		const { getByLabelText } = render(ExperimentsPage, { props: props() });
		expect(getByLabelText('Search experiments').tagName).toBe('INPUT');
	});

	it('offers pause and stop while running, and never resume', () => {
		const { getAllByRole } = render(ExperimentsPage, { props: props() });
		const labels = getAllByRole('button').map((b) => (b.textContent ?? '').trim());
		expect(labels).toContain('Pause');
		expect(labels).toContain('Stop');
		expect(labels).not.toContain('Resume');
		expect(labels).not.toContain('Start');
	});

	it('offers only start from draft', () => {
		const { getAllByRole } = render(ExperimentsPage, {
			props: props({ experiments: [experiment({ status: 'draft' })] }),
		});
		const labels = getAllByRole('button').map((b) => (b.textContent ?? '').trim());
		expect(labels).toContain('Start');
		expect(labels).not.toContain('Pause');
	});

	it('offers no move at all once an experiment has ended', () => {
		const { getAllByRole } = render(ExperimentsPage, {
			props: props({ experiments: [experiment({ status: 'stopped' })] }),
		});
		const labels = getAllByRole('button').map((b) => (b.textContent ?? '').trim());
		for (const move of ['Start', 'Pause', 'Resume', 'Stop']) {
			expect(labels).not.toContain(move);
		}
	});

	// Editing a finished experiment would change the definition a recorded
	// result was produced under.
	it('hides the edit control on a finished experiment', () => {
		const { queryByLabelText } = render(ExperimentsPage, {
			props: props({ experiments: [experiment({ status: 'completed' })] }),
		});
		expect(queryByLabelText('Edit Checkout button')).toBeNull();
	});
});

describe('the list', () => {
	it('links each row to where its results are', () => {
		const { container } = render(ExperimentsPage, { props: props() });
		const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
		expect(hrefs).toContain('/admin/experiments/e1');
	});

	it('says how many are splitting traffic right now', () => {
		const { container } = render(ExperimentsPage, { props: props() });
		expect(said(container)).toContain('1 experiment is running');
	});

	// The plugin counts the minimum across all variants together, so the
	// column says so rather than promising a count for each.
	it('states the minimum as a total across all variants', () => {
		const { container } = render(ExperimentsPage, { props: props() });
		const text = said(container);
		expect(text).toContain('Exposures needed');
		expect(text).toContain('100 across all variants');
		expect(text).not.toContain('per variant');
	});

	it('says what an empty list means', () => {
		const { container } = render(ExperimentsPage, { props: props({ experiments: [] }) });
		expect(said(container)).toContain('No experiments yet');
	});
});

// The engine reads the threshold as a confidence level, so the drawer offers
// one and an experiment stored at the engine's default opens unchanged.
describe('the confidence level', () => {
	function threshold(container: HTMLElement): string {
		return (container.ownerDocument.querySelector('input[name="significance_threshold"]') as HTMLInputElement).value;
	}

	it('starts a new experiment at 0.95', async () => {
		const { container, getAllByText } = render(ExperimentsPage, { props: props() });
		await fireEvent.click(getAllByText('New experiment')[0]);
		expect(threshold(container)).toBe('0.95');
	});

	it('labels the minimum as a total across all variants', async () => {
		const { getAllByText, getByLabelText } = render(ExperimentsPage, { props: props() });
		await fireEvent.click(getAllByText('New experiment')[0]);
		const field = getByLabelText('Minimum exposures');
		expect(field.getAttribute('name')).toBe('min_sample_size');
		expect(said(field.ownerDocument.body)).toContain('Total exposures across all variants.');
		expect(said(field.ownerDocument.body)).not.toContain('per variant');
	});

	it('opens an experiment stored at 0.95 with 0.95', async () => {
		const { container, getByLabelText } = render(ExperimentsPage, { props: props() });
		await fireEvent.click(getByLabelText('Edit Checkout button'));
		expect(threshold(container)).toBe('0.95');
	});
});

/*
 * The drawer and the row actions share one form result. A failed delete or
 * move belongs to the page, and a newly opened drawer starts clean.
 */
describe('where a failure shows', () => {
	it('shows a failed delete on the page and not in the drawer opened after it', async () => {
		const failed = 'Could not delete the experiment. Try again.';
		const { container, getAllByText } = render(ExperimentsPage, {
			props: props({}, { action: 'delete', error: failed }),
		});
		expect(said(container)).toContain(failed);

		await fireEvent.click(getAllByText('New experiment')[0]);
		const drawer = container.ownerDocument.querySelector('#experiment-form') as HTMLElement;
		expect(said(drawer)).not.toContain(failed);
	});

	it('shows a failed save inside the open drawer', async () => {
		const { container, getAllByText, rerender } = render(ExperimentsPage, { props: props() });
		await fireEvent.click(getAllByText('New experiment')[0]);

		await rerender(props({}, { action: 'save', error: 'Enter a name for the experiment.' }));

		const drawer = container.ownerDocument.querySelector('#experiment-form') as HTMLElement;
		expect(said(drawer)).toContain('Enter a name for the experiment.');
	});
});

describe('the experiment name link', () => {
	// A finished experiment has no edit button, so the name is the only way in.
	it('gives the link that opens an experiment a touch hit area', () => {
		const { container } = render(ExperimentsPage, { props: props({ experiments: [experiment({ status: 'completed' })] }) });
		const link = container.querySelector('tbody a[href="/admin/experiments/e1"]') as HTMLElement;
		expect(link.className.split(/\s+/)).toEqual(expect.arrayContaining(['relative', 'hit-area']));
	});
});
