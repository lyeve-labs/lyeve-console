import { describe, expect, it } from 'vitest';
import {
	hasWinner,
	isFinished,
	movesFrom,
	pValue,
	splitIsSound,
	splitTotal,
	statusTone,
	totalSample,
	underpowered,
	verdict,
	type Experiment,
	type ExperimentResults,
	type Variant,
} from './ab-testing';

function experiment(over: Partial<Experiment> = {}): Experiment {
	return {
		id: 'e1',
		tenant_id: 'default',
		name: 'Checkout button',
		status: 'running',
		traffic_split: {},
		auto_stop_enabled: false,
		significance_threshold: 0.05,
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

function results(over: Partial<ExperimentResults> = {}): ExperimentResults {
	return {
		experiment_id: 'e1',
		status: 'running',
		variants: [
			{ variant_id: 'v1', variant_name: 'control', is_control: true, sample_size: 500, conversions: 50, conversion_rate: 0.1 },
			{ variant_id: 'v2', variant_name: 'bright', is_control: false, sample_size: 500, conversions: 75, conversion_rate: 0.15 },
		],
		significant: true,
		winner: 'bright',
		sample_sizes: { control: 500, bright: 500 },
		...over,
	};
}

describe('the moves a status allows', () => {
	// Mirrored from the plugin's own map. A button that can only answer 409 is
	// worse than no button, and these two statuses are where a copy rots first.
	it('offers nothing from a terminal status', () => {
		expect(movesFrom('completed')).toEqual([]);
		expect(movesFrom('stopped')).toEqual([]);
		expect(isFinished('completed')).toBe(true);
		expect(isFinished('stopped')).toBe(true);
	});

	it('offers only what the engine accepts from each live status', () => {
		expect(movesFrom('draft')).toEqual(['start']);
		expect(movesFrom('running')).toEqual(['pause', 'stop']);
		expect(movesFrom('paused')).toEqual(['resume', 'stop']);
	});

	// Draft cannot be paused and paused cannot be started: both are 409s, and
	// both were plausible buttons to have drawn.
	it('never offers a move the engine refuses', () => {
		expect(movesFrom('draft')).not.toContain('pause');
		expect(movesFrom('paused')).not.toContain('start');
		expect(movesFrom('running')).not.toContain('resume');
	});

	it('uses the kit vocabulary for every status', () => {
		expect(statusTone('running')).toBe('success');
		expect(statusTone('paused')).toBe('warn');
		expect(statusTone('stopped')).toBe('danger');
		expect(statusTone('completed')).toBe('brand');
		expect(statusTone('draft')).toBe('neutral');
	});
});

describe('what the results support', () => {
	// This is the number people misread. Not significant is not a tie: it is an
	// experiment that has not answered, and reading it as a tie ships changes
	// on noise.
	it('refuses to call an inconclusive result a tie', () => {
		const said = verdict(results({ significant: false, winner: null }));
		expect(said).toContain('Not conclusive yet');
		expect(said).toBe('Not conclusive yet. The difference so far could be chance.');
	});

	it('names a winner only when the engine declared one and called it significant', () => {
		expect(hasWinner(results())).toBe(true);
		expect(hasWinner(results({ significant: false }))).toBe(false);
		expect(hasWinner(results({ winner: null }))).toBe(false);
		expect(hasWinner(null)).toBe(false);
	});

	it('says a significant result with no named winner is exactly that', () => {
		expect(verdict(results({ winner: null }))).toContain('no variant was named the winner');
	});

	it('says nobody has been exposed rather than reporting a result', () => {
		const empty = results({
			variants: [
				{ variant_id: 'v1', variant_name: 'control', is_control: true, sample_size: 0, conversions: 0, conversion_rate: 0 },
			],
			significant: false,
			winner: null,
		});
		expect(verdict(empty)).toContain('Nobody has been exposed');
		expect(verdict(null)).toBe('No results yet');
	});

	it('counts everyone across every variant', () => {
		expect(totalSample(results())).toBe(1000);
		expect(totalSample(null)).toBe(0);
	});
});

describe('whether a result is worth believing', () => {
	// The plugin counts the minimum across all variants together before it
	// calls a result significant, so the warning reads the same count.
	it('counts the minimum across all variants together', () => {
		const lopsided = results({
			variants: [
				{ variant_id: 'v1', variant_name: 'control', is_control: true, sample_size: 500, conversions: 50, conversion_rate: 0.1 },
				{ variant_id: 'v2', variant_name: 'bright', is_control: false, sample_size: 10, conversions: 3, conversion_rate: 0.3 },
			],
		});
		const short = results({
			variants: [
				{ variant_id: 'v1', variant_name: 'control', is_control: true, sample_size: 60, conversions: 6, conversion_rate: 0.1 },
				{ variant_id: 'v2', variant_name: 'bright', is_control: false, sample_size: 39, conversions: 4, conversion_rate: 0.1 },
			],
		});
		expect(underpowered(experiment(), lopsided)).toBe(false);
		expect(underpowered(experiment(), short)).toBe(true);
		expect(underpowered(experiment(), results({ variants: [] }))).toBe(true);
		expect(underpowered(experiment(), results())).toBe(false);
	});

	it('claims nothing when there is no minimum or no result', () => {
		expect(underpowered(experiment({ min_sample_size: 0 }), results())).toBe(false);
		expect(underpowered(experiment(), null)).toBe(false);
	});
});

describe('the traffic split', () => {
	// Each variant carries its own percentage and nothing reconciles them, so
	// 60/60 is storable and silently means whatever the bucketing does with it.
	it('notices a split that does not add up', () => {
		const bad = [variant({ traffic_percentage: 60 }), variant({ id: 'v2', traffic_percentage: 60 })];
		expect(splitTotal(bad)).toBe(120);
		expect(splitIsSound(bad)).toBe(false);
	});

	it('tolerates the float error in three equal shares', () => {
		const thirds = [
			variant({ traffic_percentage: 33.3 }),
			variant({ id: 'v2', traffic_percentage: 33.3 }),
			variant({ id: 'v3', traffic_percentage: 33.4 }),
		];
		expect(splitIsSound(thirds)).toBe(true);
	});

	it('does not complain about an experiment with no variants yet', () => {
		expect(splitIsSound([])).toBe(true);
	});
});

describe('the numbers as printed', () => {
	// A p-value of 0.0000001 reads as a measurement and is a floating point
	// artifact of a small sample.
	it('shows a very small p-value as a bound', () => {
		expect(pValue(0.0000001)).toBe('p < 0.001');
		expect(pValue(0.042)).toBe('p = 0.042');
		expect(pValue(null)).toBe('Not calculated');
	});
});
