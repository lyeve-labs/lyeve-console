import type { HttpClient } from '@lyeve-labs/client';
import { readAll } from './list';
import { num, record, str } from './narrow';

/**
 * The multitenant plugin's cost ledger. Amounts travel as decimal strings so
 * no dialect and no JSON parser rounds them, and they are shown as the engine
 * wrote them.
 */

export type ResourceType = 'database' | 'storage' | 'bandwidth' | 'compute' | 'ai';

export const RESOURCE_TYPES: readonly ResourceType[] = ['database', 'storage', 'bandwidth', 'compute', 'ai'];

export type BudgetPeriod = 'monthly' | 'quarterly' | 'annual';

export const BUDGET_PERIODS: readonly BudgetPeriod[] = ['monthly', 'quarterly', 'annual'];

export interface CostSummary {
	total_amount: string;
	currency: string;
	database_cost: string;
	storage_cost: string;
	bandwidth_cost: string;
	compute_cost: string;
	ai_cost: string;
	entry_count: number;
}

export interface BudgetAlert {
	budget_id: string;
	budget_name: string;
	threshold: number;
	current_spend: string;
	budget_amount: string;
	spend_percent: number;
	triggered: boolean;
}

export interface CostDashboard {
	total_cost_this_month: string;
	budgets_at_risk: BudgetAlert[];
	open_anomalies: number;
	active_recommendations: number;
	potential_savings: string;
}

export interface Budget {
	id: string;
	name: string;
	resource_type: ResourceType | null;
	period: BudgetPeriod;
	amount: string;
	currency: string;
	alert_thresholds: number[];
	current_spend: string;
	period_start: string;
	period_end: string;
}

export interface BudgetInput {
	name: string;
	resource_type: ResourceType | null;
	period: BudgetPeriod;
	amount: string;
	currency: string;
	alert_thresholds: number[];
	period_start: string;
	period_end: string;
}

export interface Price {
	resource_type: ResourceType;
	unit_price: string;
	per_units: number;
	currency: string;
	/** `default` for the built-in figure, `tenant` for a row the tenant set. */
	source: 'default' | 'tenant';
	updated_at: string | null;
}

export interface PriceInput {
	unit_price: string;
	per_units: number;
	currency: string;
}

/** What one feed tick wrote for the caller's tenant. */
export interface FeedResult {
	tenant_id: string;
	entries_saved: number;
	budget_events: number;
	anomalies: number;
}

const BASE = '/api/admin/cost-monitor';

export function isResourceType(v: unknown): v is ResourceType {
	return typeof v === 'string' && (RESOURCE_TYPES as readonly string[]).includes(v);
}

export function isBudgetPeriod(v: unknown): v is BudgetPeriod {
	return typeof v === 'string' && (BUDGET_PERIODS as readonly string[]).includes(v);
}

export function toSummary(raw: Record<string, unknown>): CostSummary {
	return {
		total_amount: str(raw.total_amount, '0'),
		currency: str(raw.currency),
		database_cost: str(raw.database_cost, '0'),
		storage_cost: str(raw.storage_cost, '0'),
		bandwidth_cost: str(raw.bandwidth_cost, '0'),
		compute_cost: str(raw.compute_cost, '0'),
		ai_cost: str(raw.ai_cost, '0'),
		entry_count: num(raw.entry_count),
	};
}

export function toBudgetAlert(raw: Record<string, unknown>): BudgetAlert {
	return {
		budget_id: str(raw.budget_id),
		budget_name: str(raw.budget_name),
		threshold: num(raw.threshold),
		current_spend: str(raw.current_spend, '0'),
		budget_amount: str(raw.budget_amount, '0'),
		spend_percent: num(raw.spend_percent),
		triggered: raw.triggered === true,
	};
}

export function toDashboard(raw: Record<string, unknown>): CostDashboard {
	return {
		total_cost_this_month: str(raw.total_cost_this_month, '0'),
		budgets_at_risk: (Array.isArray(raw.budgets_at_risk) ? raw.budgets_at_risk : []).map((a) =>
			toBudgetAlert(record(a)),
		),
		open_anomalies: num(raw.open_anomalies),
		active_recommendations: num(raw.active_recommendations),
		potential_savings: str(raw.potential_savings, '0'),
	};
}

export function toBudget(raw: Record<string, unknown>): Budget {
	return {
		id: str(raw.id),
		name: str(raw.name),
		resource_type: isResourceType(raw.resource_type) ? raw.resource_type : null,
		period: isBudgetPeriod(raw.period) ? raw.period : 'monthly',
		amount: str(raw.amount, '0'),
		currency: str(raw.currency),
		alert_thresholds: (Array.isArray(raw.alert_thresholds) ? raw.alert_thresholds : []).filter(
			(t): t is number => typeof t === 'number',
		),
		current_spend: str(raw.current_spend, '0'),
		period_start: str(raw.period_start),
		period_end: str(raw.period_end),
	};
}

export function toPrice(raw: Record<string, unknown>): Price {
	return {
		resource_type: isResourceType(raw.resource_type) ? raw.resource_type : 'database',
		unit_price: str(raw.unit_price, '0'),
		per_units: num(raw.per_units),
		currency: str(raw.currency),
		source: raw.source === 'tenant' ? 'tenant' : 'default',
		updated_at: typeof raw.updated_at === 'string' && raw.updated_at ? raw.updated_at : null,
	};
}

export function toFeedResult(raw: Record<string, unknown>): FeedResult {
	return {
		tenant_id: str(raw.tenant_id),
		entries_saved: num(raw.entries_saved),
		budget_events: num(raw.budget_events),
		anomalies: num(raw.anomalies),
	};
}

/**
 * The ledger's totals. Given a start, only lines from then on count, which is
 * how the page shows the month the dashboard's figures describe rather than
 * the whole ledger beside them.
 */
export function getSummary(client: HttpClient, from?: Date): Promise<CostSummary> {
	const q = from ? `?from=${encodeURIComponent(from.toISOString().replace(/\.\d{3}Z$/, 'Z'))}` : '';
	return client.get<Record<string, unknown>>(`${BASE}/summary${q}`).then(toSummary);
}

/** The first moment of the month the given time falls in, in UTC. */
export function monthStart(now: Date): Date {
	return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** One resource's part of a total, for the breakdown. */
export interface CostShare {
	label: string;
	amount: string;
	percent: number;
}

/**
 * The summary as a breakdown by resource, largest first. A total of zero
 * gives every share zero percent rather than dividing by nothing.
 */
export function costShares(s: CostSummary): CostShare[] {
	const parts: [string, string][] = [
		['Database', s.database_cost],
		['Storage', s.storage_cost],
		['Bandwidth', s.bandwidth_cost],
		['Compute', s.compute_cost],
		['AI', s.ai_cost],
	];
	const total = Number(s.total_amount) || 0;
	return parts
		.map(([label, amount]) => {
			const n = Number(amount) || 0;
			return { label, amount, percent: total > 0 ? Math.round((n / total) * 100) : 0, n };
		})
		.sort((a, b) => b.n - a.n)
		.map(({ label, amount, percent }) => ({ label, amount, percent }));
}

export function getDashboard(client: HttpClient): Promise<CostDashboard> {
	return client.get<Record<string, unknown>>(`${BASE}/dashboard`).then(toDashboard);
}

/** The plugin's ceiling on one page of budgets. */
const BUDGET_PAGE = 200;

/** How many pages of budgets one read walks before it stops. */
const BUDGET_PAGES = 25;

/**
 * Every budget the tenant holds. The plugin pages the list and states the
 * count, so the read walks the pages up to it rather than drawing the first
 * page as the whole list.
 */
export async function listBudgets(client: HttpClient): Promise<Budget[]> {
	const { rows } = await readAll(
		async (limit, offset) => {
			const res = await client.get<unknown>(`${BASE}/budgets?limit=${limit}&offset=${offset}`);
			const list = Array.isArray(res) ? res : (record(res).data ?? []);
			const stated = Array.isArray(res) ? null : record(res).total_count;
			return {
				rows: (Array.isArray(list) ? list : []).map((b) => toBudget(record(b))),
				total: typeof stated === 'number' ? stated : null,
			};
		},
		BUDGET_PAGE,
		BUDGET_PAGES * BUDGET_PAGE
	);
	return rows;
}

export function createBudget(client: HttpClient, input: BudgetInput): Promise<Budget> {
	return client
		.post<Record<string, unknown>>(`${BASE}/budgets`, {
			name: input.name,
			...(input.resource_type ? { resource_type: input.resource_type } : {}),
			period: input.period,
			amount: input.amount,
			currency: input.currency,
			alert_thresholds: input.alert_thresholds,
			period_start: input.period_start,
			period_end: input.period_end,
		})
		.then(toBudget);
}

export function deleteBudget(client: HttpClient, id: string): Promise<void> {
	return client.delete<void>(`${BASE}/budgets/${encodeURIComponent(id)}`);
}

export async function listPrices(client: HttpClient): Promise<Price[]> {
	const res = await client.get<unknown>(`${BASE}/prices`);
	return (Array.isArray(res) ? res : []).map((p) => toPrice(record(p)));
}

export function putPrice(client: HttpClient, resourceType: ResourceType, input: PriceInput): Promise<Price> {
	return client
		.put<Record<string, unknown>>(`${BASE}/prices/${encodeURIComponent(resourceType)}`, input)
		.then(toPrice);
}

export function deletePrice(client: HttpClient, resourceType: ResourceType): Promise<void> {
	return client.delete<void>(`${BASE}/prices/${encodeURIComponent(resourceType)}`);
}

/** Run the feed tick for the caller's tenant now, without waiting for the hour. */
export function aggregateNow(client: HttpClient): Promise<FeedResult> {
	return client.post<Record<string, unknown>>(`${BASE}/aggregate`, {}).then(toFeedResult);
}
