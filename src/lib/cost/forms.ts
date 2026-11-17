import {
	isBudgetPeriod,
	isResourceType,
	type BudgetInput,
	type PriceInput,
	type ResourceType,
} from '#lib/api/cost.ts';

/** A decimal amount as the ledger stores it: digits with an optional fraction. */
const DECIMAL = /^\d+(\.\d+)?$/;

/** A calendar date from the picker, sent to the engine as the start of that day in UTC. */
function dayStart(value: string): string | null {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
	const d = new Date(`${value}T00:00:00Z`);
	return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * The first instant after a calendar day. A budget's window ends there, the
 * way each monthly cost line ends at the next month's first instant, so a
 * budget whose last day is the month's last day counts that month's line.
 */
function dayAfter(value: string): string | null {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
	const d = new Date(`${value}T00:00:00Z`);
	if (Number.isNaN(d.getTime())) return null;
	d.setUTCDate(d.getUTCDate() + 1);
	return d.toISOString();
}

/** The last day a budget window covers, from the end the engine stores. */
export function lastDay(periodEnd: string): string {
	const end = Date.parse(periodEnd);
	return Number.isNaN(end) ? periodEnd : new Date(end - 1).toISOString();
}

/**
 * The budget form, checked before the engine sees it so the refusal names
 * the control. The thresholds are percentages, comma separated, and default
 * to the engine's own 50, 80 and 100 when left empty.
 */
export function parseBudget(form: FormData): { budget: BudgetInput } | { error: string } {
	const name = String(form.get('name') ?? '').trim();
	if (!name) return { error: 'Enter a name.' };
	const amount = String(form.get('amount') ?? '').trim();
	if (!DECIMAL.test(amount)) return { error: 'Enter the amount as a number, such as 250 or 99.50.' };
	const period = form.get('period');
	if (!isBudgetPeriod(period)) return { error: 'Choose monthly, quarterly or annual.' };
	const resourceRaw = String(form.get('resource_type') ?? '').trim();
	const resource_type: ResourceType | null = resourceRaw ? (isResourceType(resourceRaw) ? resourceRaw : null) : null;
	if (resourceRaw && !resource_type) return { error: 'Choose a resource type, or leave it empty for every resource.' };
	const currency = String(form.get('currency') ?? '').trim().toUpperCase() || 'USD';
	const thresholdsRaw = String(form.get('alert_thresholds') ?? '').trim();
	const alert_thresholds = thresholdsRaw
		? thresholdsRaw.split(',').map((t) => Number(t.trim()))
		: [50, 80, 100];
	if (alert_thresholds.some((t) => !Number.isInteger(t) || t <= 0 || t > 1000)) {
		return { error: 'Enter whole percentages separated by commas, such as 50, 80, 100.' };
	}
	const period_start = dayStart(String(form.get('period_start') ?? ''));
	const period_end = dayAfter(String(form.get('period_end') ?? ''));
	if (!period_start || !period_end) return { error: 'Choose the first and last day of the budget window.' };
	if (period_end <= period_start) return { error: 'Choose an end date after the start date.' };
	return {
		budget: { name, resource_type, period, amount, currency, alert_thresholds, period_start, period_end },
	};
}

/** The price form for one resource type. */
export function parsePrice(
	form: FormData,
): { resourceType: ResourceType; price: PriceInput } | { error: string } {
	const resourceType = form.get('resource_type');
	if (!isResourceType(resourceType)) return { error: 'Choose a resource type.' };
	const unit_price = String(form.get('unit_price') ?? '').trim();
	if (!DECIMAL.test(unit_price)) return { error: 'Enter the unit price as a number, such as 0.09.' };
	const per_units = Number(String(form.get('per_units') ?? '').trim());
	if (!Number.isInteger(per_units) || per_units < 1) return { error: 'Enter the block size as a whole number of units, at least 1.' };
	const currency = String(form.get('currency') ?? '').trim().toUpperCase() || 'USD';
	return { resourceType, price: { unit_price, per_units, currency } };
}
