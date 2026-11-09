// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PageData } from './$types';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy: () => {} }) }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import CostsPage from './+page.svelte';

afterEach(cleanup);

const summary = {
	total_amount: '12.50',
	currency: 'USD',
	database_cost: '0',
	storage_cost: '2.50',
	bandwidth_cost: '4.00',
	compute_cost: '6.00',
	ai_cost: '0',
	entry_count: 4,
};

const dashboard = {
	total_cost_this_month: '12.50',
	budgets_at_risk: [
		{ budget_id: 'b1', budget_name: 'Storage cap', threshold: 80, current_spend: '9.00', budget_amount: '10.00', spend_percent: 90, triggered: true },
	],
	open_anomalies: 1,
	active_recommendations: 0,
	potential_savings: '0',
};

/** A read that answered. A null override is a read that failed for no reason the page can name. */
function read(value: unknown) {
	return value === null ? { ok: false, gate: { state: 'error', message: 'It could not be read.' } } : { ok: true, value };
}

function data(overrides: Record<string, unknown> = {}): PageData {
	const reads = { summary, dashboard };
	const merged: Record<string, unknown> = { enabled: true, upgradeUrl: '', ...overrides };
	for (const key of Object.keys(reads) as (keyof typeof reads)[]) {
		const value = key in overrides ? overrides[key] : reads[key];
		merged[key] = value !== null && typeof value === 'object' && 'ok' in value ? value : read(value);
	}
	return merged as unknown as PageData;
}

describe('tenant costs page', () => {
	it('renders the summary and the month under the strip', () => {
		render(CostsPage, { props: { data: data(), form: null } });
		expect(screen.getByRole('tab', { name: 'This month' }).getAttribute('aria-selected')).toBe('true');
		expect(screen.getByText('Beta')).toBeTruthy();
		expect(screen.getByText('12.50 USD')).toBeTruthy();
		expect(screen.getByTestId('cost-summary').textContent).toContain('USD');
		expect(screen.getByText('From 4 cost lines since the first of the month. Costs are updated every hour from the usage and AI meters.')).toBeTruthy();
		expect(screen.getByTestId('cost-dashboard')).toBeTruthy();
		expect(screen.getByRole('list', { name: 'Budgets at risk' }).textContent).toContain('Storage cap');
		expect(screen.getByRole('button', { name: /Update costs/ })).toHaveProperty('disabled', false);
		expect(screen.queryByTestId('not-enabled')).toBeNull();
	});

	it('shows only that the feature is not enabled when the ledger refused, and no control', () => {
		render(CostsPage, {
			props: { data: data({ enabled: false, summary: null, dashboard: null }), form: null },
		});
		expect(screen.getByTestId('not-enabled').textContent).toContain('Not enabled on this engine.');
		expect(screen.queryByRole('region', { name: 'This month' })).toBeNull();
		expect(screen.queryByRole('button', { name: /Update costs/ })).toBeNull();
		expect(screen.queryByText('Beta')).toBeNull();
	});

	it('links where the refusal says the ledger is turned on, and only to a safe place', () => {
		render(CostsPage, {
			props: { data: data({ enabled: false, upgradeUrl: 'https://example.test/enable' }), form: null },
		});
		expect(screen.getByRole('link', { name: 'How to enable it' }).getAttribute('href')).toBe('https://example.test/enable');
		cleanup();
		render(CostsPage, {
			props: { data: data({ enabled: false, upgradeUrl: 'javascript:alert(1)' }), form: null },
		});
		expect(screen.getByTestId('not-enabled')).toBeTruthy();
		expect(screen.queryByRole('link', { name: 'How to enable it' })).toBeNull();
	});

	it('says which read did not answer', () => {
		render(CostsPage, {
			props: { data: data({ summary: { ok: false, gate: { state: 'unavailable' } } }), form: null },
		});
		expect(screen.getByText(/so the split by resource did not load/)).toBeTruthy();
		expect(screen.getByTestId('cost-dashboard')).toBeTruthy();
	});

	it('reports the feed run and a refusal of it', async () => {
		render(CostsPage, {
			props: {
				data: data(),
				form: { form: 'aggregate', saved: true, result: { tenant_id: 't', entries_saved: 3, budget_events: 1, anomalies: 0 } } as never,
			},
		});
		expect(await screen.findByText('Costs updated')).toBeTruthy();
		expect(screen.getByText(/3 cost lines written, 1 budget events published/)).toBeTruthy();
		cleanup();
		render(CostsPage, {
			props: { data: data(), form: { form: 'aggregate', error: 'The cost ledger is not enabled on this engine.', locked: true } as never },
		});
		expect(screen.getAllByText('The cost ledger is not enabled on this engine.')).toHaveLength(1);
	});
});
