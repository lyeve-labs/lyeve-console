// @vitest-environment jsdom
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy: () => {} }) }));

import DetailPage from './+page.svelte';
import type { Experiment, ExperimentResults, Metric, Variant } from '#lib/api/ab-testing.ts';

afterEach(cleanup);

function said(c: HTMLElement): string {
	return (c.textContent ?? '').replace(/\s+/g, ' ');
}

function experiment(over: Partial<Experiment> = {}): Experiment {
	return {
		id: 'e1',
		tenant_id: 'default',
		name: 'Checkout button',
		description: 'Does a brighter button get more checkouts',
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

function variant(over: Partial<Variant> = {}): Variant {
	return {
		id: 'v1',
		experiment_id: 'e1',
		name: 'control',
		config: '',
		traffic_percentage: 50,
		is_control: true,
		created_at: '2026-09-01T00:00:00Z',
		...over,
	};
}

function metric(over: Partial<Metric> = {}): Metric {
	return {
		id: 'm1',
		experiment_id: 'e1',
		name: 'Checkout completed',
		event_name: 'checkout.completed',
		metric_type: 'conversion',
		created_at: '2026-09-01T00:00:00Z',
		...over,
	};
}

function results(over: Partial<ExperimentResults> = {}): ExperimentResults {
	return {
		experiment_id: 'e1',
		status: 'running',
		variants: [
			{ variant_id: 'v1', variant_name: 'control', is_control: true, sample_size: 500, conversions: 50, conversion_rate: 0.1 },
			{ variant_id: 'v2', variant_name: 'bright', is_control: false, sample_size: 500, conversions: 75, conversion_rate: 0.15, p_value: 0.004 },
		],
		significant: true,
		winner: 'bright',
		sample_sizes: { control: 500, bright: 500 },
		...over,
	};
}

const ok = <T>(value: T) => ({ ok: true, value });
const down = { ok: false, gate: { state: 'unavailable' } };

/** Each panel answered, unless `over` says otherwise. A bare value is an answered read. */
const props = (over: Record<string, unknown> = {}, form: unknown = null) => {
	const panel = (key: string, fallback: unknown) => {
		const v = key in over ? over[key] : fallback;
		return v && typeof v === 'object' && 'ok' in v ? v : ok(v);
	};
	return {
		data: {
			experiment: experiment(),
			gate: { state: 'ok' },
			...over,
			variants: panel('variants', [variant(), variant({ id: 'v2', name: 'bright', is_control: false })]),
			metrics: panel('metrics', [metric()]),
			results: panel('results', results()),
		} as never,
		form: form as never,
	};
};

describe('the verdict', () => {
	it('names the leader when the engine called it significant', () => {
		const { container } = render(DetailPage, { props: props() });
		const text = said(container);
		expect(text).toContain('bright is ahead');
		expect(text).toContain('unlikely to be chance');
	});

	// The reading this whole page exists to prevent.
	it('refuses to present an inconclusive result as a tie', () => {
		const { container } = render(DetailPage, {
			props: props({ results: results({ significant: false, winner: null }) }),
		});
		const text = said(container);
		expect(text).toContain('Not conclusive yet');
		expect(text).toContain('Not conclusive yet. The difference so far could be chance.');
		expect(text).not.toContain('Ahead');
	});

	it('warns while the exposures across all variants are below the minimum', () => {
		const thin = results({
			variants: [
				{ variant_id: 'v1', variant_name: 'control', is_control: true, sample_size: 40, conversions: 4, conversion_rate: 0.1 },
				{ variant_id: 'v2', variant_name: 'bright', is_control: false, sample_size: 9, conversions: 4, conversion_rate: 0.44 },
			],
		});
		const { container } = render(DetailPage, { props: props({ results: thin }) });
		const text = said(container);
		expect(text).toContain('So far the experiment has 49 exposures across all variants, fewer than the 100 it needs.');
		expect(text).toContain('no result counts as significant');
	});

	it('counts a single exposure in the singular', () => {
		const one = results({
			variants: [
				{ variant_id: 'v1', variant_name: 'control', is_control: true, sample_size: 0, conversions: 0, conversion_rate: 0 },
				{ variant_id: 'v2', variant_name: 'bright', is_control: false, sample_size: 1, conversions: 1, conversion_rate: 1 },
			],
		});
		const { container } = render(DetailPage, { props: props({ results: one }) });
		expect(said(container)).toContain('So far the experiment has 1 exposure across all variants');
	});

	// The minimum is a total, so a lopsided split past it is not short of it.
	it('does not warn once the total reaches the minimum, however it is split', () => {
		const lopsided = results({
			variants: [
				{ variant_id: 'v1', variant_name: 'control', is_control: true, sample_size: 500, conversions: 50, conversion_rate: 0.1 },
				{ variant_id: 'v2', variant_name: 'bright', is_control: false, sample_size: 9, conversions: 4, conversion_rate: 0.44 },
			],
		});
		const { container } = render(DetailPage, { props: props({ results: lopsided }) });
		expect(said(container)).not.toContain('fewer than');
	});
});

describe('the traffic split', () => {
	// Nothing in the engine reconciles the per-variant percentages, so a split
	// that does not add up is storable and means whatever bucketing does.
	it('says when the shares do not come to a hundred', () => {
		const { container } = render(DetailPage, {
			props: props({
				variants: [variant({ traffic_percentage: 60 }), variant({ id: 'v2', name: 'bright', traffic_percentage: 60 })],
			}),
		});
		expect(said(container)).toContain('add up to 120%');
	});

	it('says nothing when they do', () => {
		const { container } = render(DetailPage, { props: props() });
		expect(said(container)).not.toContain('add up to');
	});
});

describe('the empty states', () => {
	it('says an experiment with no variants splits nothing', () => {
		const { container } = render(DetailPage, { props: props({ variants: [] }) });
		expect(said(container)).toContain('Add a control and at least one other variant');
	});

	it('says an experiment with no metric can never produce a result', () => {
		const { container } = render(DetailPage, { props: props({ metrics: [] }) });
		expect(said(container)).toContain('Without one, this experiment has no result.');
	});

	it('says nobody has been exposed yet when the results answer with no exposure', () => {
		const { container } = render(DetailPage, { props: props({ results: results({ variants: [], significant: false, winner: null }) }) });
		expect(said(container)).toContain('Nobody has been exposed to this experiment yet');
	});
});

/*
 * A panel whose read failed is not an empty panel. Offering to add the first
 * variant over a list that may already have two would duplicate them on the
 * next try.
 */
describe('a panel that could not be read', () => {
	it('says the variants could not be read and offers no new variant', () => {
		const { container } = render(DetailPage, { props: props({ variants: down }) });
		const text = said(container);
		expect(text).toContain('the variants did not load');
		expect(text).not.toContain('Add a control and at least one other variant');
		expect(text).not.toContain('New variant');
	});

	it('says the metrics could not be read and offers no new metric', () => {
		const { container } = render(DetailPage, { props: props({ metrics: down }) });
		const text = said(container);
		expect(text).toContain('the metrics did not load');
		expect(text).not.toContain('Without one, this experiment has no result.');
		expect(text).not.toContain('New metric');
	});

	it('says the results could not be read and counts no exposure', () => {
		const { container } = render(DetailPage, { props: props({ results: down }) });
		const text = said(container);
		expect(text).toContain('the results did not load');
		expect(text).not.toContain('Nobody has been exposed');
		expect(text).toContain('Exposures unknown');
	});
});

/*
 * The page's forms share one result. A failed remove belongs on the page, and
 * a failed add in its own drawer.
 */
describe('where a failure shows', () => {
	it('shows a failed remove on the page and not in a drawer opened after it', async () => {
		const failed = 'Could not remove the variant. Try again.';
		const { container, getAllByText } = render(DetailPage, {
			props: props({}, { action: 'removeVariant', error: failed }),
		});
		expect(said(container)).toContain(failed);

		await fireEvent.click(getAllByText('New variant')[0]);
		const drawer = container.ownerDocument.querySelector('#variant-form') as HTMLElement;
		expect(said(drawer)).not.toContain(failed);
	});

	it('shows a failed add inside its drawer and not in the other', async () => {
		const { container, getAllByText } = render(DetailPage, {
			props: props({}, { action: 'addMetric', error: 'Choose a metric type.' }),
		});
		expect(said(container)).not.toContain('Choose a metric type.');

		await fireEvent.click(getAllByText('New variant')[0]);
		expect(said(container.ownerDocument.querySelector('#variant-form') as HTMLElement)).not.toContain('Choose a metric type.');
	});

});

describe('the new metric drawer', () => {
	// Four short types fit in sight, so they are segments rather than a list
	// that hides three of them.
	it('offers the four metric types as segments and submits the chosen one', async () => {
		const { container, getAllByText } = render(DetailPage, { props: props() });
		await fireEvent.click(getAllByText('New metric')[0]);

		const drawer = container.ownerDocument.querySelector('#metric-form') as HTMLElement;
		expect(drawer.querySelectorAll('[role="radio"]').length).toBe(4);
		expect((drawer.querySelector('input[name="metric_type"]') as HTMLInputElement).value).toBe('conversion');
	});
});
