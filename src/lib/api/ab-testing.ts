/**
 * The ab-testing plugin's admin routes.
 *
 * An experiment is a lifecycle, not a record: draft, running, paused, and then
 * one of two ends. The engine refuses an invalid move with a 409 naming both
 * statuses, so the screen mirrors the same map rather than offering every
 * button and letting three of them fail.
 *
 * Results carry a p-value and a significance flag, and the two are the most
 * misread numbers in the product. A result that is not significant is not a
 * tie: it is an experiment that has not answered yet, and the difference
 * decides whether somebody ships a change. The helpers below refuse to call a
 * winner the engine did not declare.
 */
import type { StatusTone } from '@lyeve-labs/ui-kit';
import type { HttpClient } from '@lyeve-labs/client';
import { rowsOf, type ListEnvelope } from './list';

export const EXPERIMENTS_URL = '/api/admin/ab/experiments';

export const EXPERIMENT_STATUSES = [
	'draft',
	'running',
	'paused',
	'completed',
	'stopped',
] as const;
export type ExperimentStatus = (typeof EXPERIMENT_STATUSES)[number];

export const METRIC_TYPES = ['conversion', 'count', 'revenue', 'custom'] as const;
export type MetricType = (typeof METRIC_TYPES)[number];

/** Variant name to its share of traffic, as a fraction between 0 and 1. */
export type TrafficSplit = Record<string, number>;

export interface Experiment {
	id: string;
	tenant_id: string;
	name: string;
	description?: string;
	status: ExperimentStatus;
	traffic_split: TrafficSplit;
	start_at?: string | null;
	end_at?: string | null;
	auto_stop_enabled: boolean;
	significance_threshold: number;
	min_sample_size: number;
	created_at: string;
	updated_at: string;
}

export interface Variant {
	id: string;
	experiment_id: string;
	name: string;
	description?: string;
	config: string;
	traffic_percentage: number;
	is_control: boolean;
	created_at: string;
}

export interface Metric {
	id: string;
	experiment_id: string;
	name: string;
	description?: string;
	event_name: string;
	metric_type: MetricType;
	created_at: string;
}

export interface VariantResult {
	variant_id: string;
	variant_name: string;
	is_control: boolean;
	sample_size: number;
	conversions: number;
	conversion_rate: number;
	p_value?: number | null;
}

export interface ExperimentResults {
	experiment_id: string;
	status: ExperimentStatus;
	variants: VariantResult[];
	winner?: string | null;
	significant: boolean;
	sample_sizes: Record<string, number>;
}

export async function listExperiments(
	client: HttpClient,
	limit: number,
	offset: number
): Promise<ListEnvelope<Experiment>> {
	return client.get<ListEnvelope<Experiment>>(
		`${EXPERIMENTS_URL}?limit=${limit}&offset=${offset}`
	);
}

/**
 * The most rows one list read returns. An experiment's page shows every
 * variant and metric at once, and the split total is only right over all of
 * them, so the read asks for the whole page the engine allows.
 */
export const PANEL_LIMIT = 500;

/** Every variant of an experiment, out of the paged answer. */
export async function listVariants(client: HttpClient, id: string): Promise<Variant[]> {
	return rowsOf(
		await client.get<ListEnvelope<Variant>>(
			`${EXPERIMENTS_URL}/${encodeURIComponent(id)}/variants?limit=${PANEL_LIMIT}`
		)
	);
}

/** Every metric of an experiment, out of the paged answer. */
export async function listMetrics(client: HttpClient, id: string): Promise<Metric[]> {
	return rowsOf(
		await client.get<ListEnvelope<Metric>>(
			`${EXPERIMENTS_URL}/${encodeURIComponent(id)}/metrics?limit=${PANEL_LIMIT}`
		)
	);
}

export async function readResults(
	client: HttpClient,
	id: string
): Promise<ExperimentResults> {
	return client.get<ExperimentResults>(`${EXPERIMENTS_URL}/${encodeURIComponent(id)}/results`);
}

export interface SaveExperiment {
	name: string;
	description?: string;
	traffic_split?: TrafficSplit;
	auto_stop_enabled?: boolean;
	significance_threshold?: number;
	min_sample_size?: number;
}

export async function createExperiment(
	client: HttpClient,
	body: SaveExperiment
): Promise<Experiment> {
	return client.post<Experiment>(EXPERIMENTS_URL, body);
}

export async function updateExperiment(
	client: HttpClient,
	id: string,
	body: SaveExperiment
): Promise<Experiment> {
	return client.put<Experiment>(`${EXPERIMENTS_URL}/${encodeURIComponent(id)}`, body);
}

export async function deleteExperiment(client: HttpClient, id: string): Promise<void> {
	await client.delete(`${EXPERIMENTS_URL}/${encodeURIComponent(id)}`);
}

export type Transition = 'start' | 'pause' | 'resume' | 'stop';

export async function transition(
	client: HttpClient,
	id: string,
	move: Transition
): Promise<Experiment> {
	return client.post<Experiment>(`${EXPERIMENTS_URL}/${encodeURIComponent(id)}/${move}`, {});
}

export interface SaveVariant {
	name: string;
	description?: string;
	config?: string;
	traffic_percentage: number;
	is_control?: boolean;
}

export async function createVariant(
	client: HttpClient,
	id: string,
	body: SaveVariant
): Promise<Variant> {
	return client.post<Variant>(`${EXPERIMENTS_URL}/${encodeURIComponent(id)}/variants`, body);
}

export async function deleteVariant(
	client: HttpClient,
	id: string,
	variantId: string
): Promise<void> {
	await client.delete(
		`${EXPERIMENTS_URL}/${encodeURIComponent(id)}/variants/${encodeURIComponent(variantId)}`
	);
}

export interface SaveMetric {
	name: string;
	description?: string;
	event_name: string;
	metric_type: MetricType;
}

export async function createMetric(
	client: HttpClient,
	id: string,
	body: SaveMetric
): Promise<Metric> {
	return client.post<Metric>(`${EXPERIMENTS_URL}/${encodeURIComponent(id)}/metrics`, body);
}

export async function deleteMetric(
	client: HttpClient,
	id: string,
	metricId: string
): Promise<void> {
	await client.delete(
		`${EXPERIMENTS_URL}/${encodeURIComponent(id)}/metrics/${encodeURIComponent(metricId)}`
	);
}

/**
 * Which moves the engine will accept from each status.
 *
 * A copy of the plugin's own map, kept deliberately: the alternative is
 * offering every button and letting the engine refuse three of them, and a
 * control that answers 409 is worse than one that is not there. The test
 * beside this pins the two terminal statuses, which is where the copy would
 * rot first if a transition were added.
 */
const MOVES: Readonly<Record<ExperimentStatus, readonly Transition[]>> = {
	draft: ['start'],
	running: ['pause', 'stop'],
	paused: ['resume', 'stop'],
	completed: [],
	stopped: [],
};

export function movesFrom(status: ExperimentStatus): readonly Transition[] {
	return MOVES[status] ?? [];
}

export const TRANSITION_LABELS: Readonly<Record<Transition, string>> = {
	start: 'Start',
	pause: 'Pause',
	resume: 'Resume',
	stop: 'Stop',
};

/** Whether an experiment has ended and can never run again. */
export function isFinished(status: ExperimentStatus): boolean {
	return status === 'completed' || status === 'stopped';
}

export function statusTone(
	status: ExperimentStatus
): StatusTone {
	if (status === 'running') return 'success';
	if (status === 'paused') return 'warn';
	if (status === 'completed') return 'brand';
	if (status === 'stopped') return 'danger';
	return 'neutral';
}

export const STATUS_LABELS: Readonly<Record<ExperimentStatus, string>> = {
	draft: 'Draft',
	running: 'Running',
	paused: 'Paused',
	completed: 'Completed',
	stopped: 'Stopped',
};

/**
 * What the results actually support, in one sentence.
 *
 * This is the number people misread. "Not significant" is not a tie and not a
 * result: it is an experiment that has not answered, and treating it as one
 * ships changes on noise. A winner is named only when the engine both declared
 * one and marked the result significant, because either alone is not evidence.
 */
export function verdict(results: ExperimentResults | null): string {
	if (!results) return 'No results yet';
	const seen = totalSample(results);
	if (seen === 0) return 'Nobody has been exposed to this experiment yet';
	if (!results.significant) {
		return 'Not conclusive yet. The difference so far could be chance.';
	}
	if (!results.winner) {
		return 'The difference is significant, but no variant was named the winner.';
	}
	return `${results.winner} is ahead, and the difference is unlikely to be chance.`;
}

/** Whether the page may present a variant as having won. */
export function hasWinner(results: ExperimentResults | null): boolean {
	return !!results && results.significant && !!results.winner;
}

/** Everyone counted across every variant. */
export function totalSample(results: ExperimentResults | null): number {
	if (!results) return 0;
	return (results.variants ?? []).reduce((sum, v) => sum + (v.sample_size ?? 0), 0);
}

/**
 * A p-value, or a note that there is not one.
 *
 * Very small values are shown as a bound rather than a number: 0.0000001 reads
 * as a measurement and it is a floating point artifact of a small sample.
 */
export function pValue(p: number | null | undefined): string {
	if (p === null || p === undefined || !Number.isFinite(p)) return 'Not calculated';
	if (p < 0.001) return 'p < 0.001';
	return `p = ${p.toFixed(3)}`;
}

/**
 * Whether an experiment has collected enough exposures to be believed.
 *
 * The threshold is the experiment's own minimum sample size, counted across
 * all variants together. That is how the plugin reads it before it calls a
 * result significant, so the page warns on the same count rather than on a
 * stricter rule the plugin never applies.
 */
export function underpowered(exp: Experiment, results: ExperimentResults | null): boolean {
	if (!results || exp.min_sample_size <= 0) return false;
	return totalSample(results) < exp.min_sample_size;
}

/**
 * Whether the declared traffic split adds up.
 *
 * Variants carry a percentage each and nothing reconciles them, so a split of
 * 60/60 is storable and silently means whatever the bucketing does with it.
 * Reported to one decimal place, since the values are floats and 33.3 three
 * times is not exactly 100.
 */
export function splitTotal(variants: readonly Variant[]): number {
	return Math.round(variants.reduce((sum, v) => sum + (v.traffic_percentage ?? 0), 0) * 10) / 10;
}

export function splitIsSound(variants: readonly Variant[]): boolean {
	if (variants.length === 0) return true;
	return Math.abs(splitTotal(variants) - 100) < 0.5;
}
