// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PageData } from './$types';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy: () => {} }) }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import PricesPage from './+page.svelte';

afterEach(cleanup);

const prices = [
	{ resource_type: 'storage', unit_price: '0.05', per_units: 1073741824, currency: 'USD', source: 'tenant', updated_at: '2026-09-19T10:00:00Z' },
	{ resource_type: 'compute', unit_price: '1.00', per_units: 1000000, currency: 'USD', source: 'default', updated_at: null },
];

function data(overrides: Record<string, unknown> = {}): PageData {
	return { enabled: true, upgradeUrl: '', prices: { ok: true, value: prices }, ...overrides } as unknown as PageData;
}

function fieldsets(): HTMLFieldSetElement[] {
	return Array.from(document.querySelectorAll('fieldset'));
}

describe('tenant cost prices page', () => {
	it('draws a price card per resource under the strip', () => {
		render(PricesPage, { props: { data: data(), form: null } });
		expect(screen.getByRole('tab', { name: 'Prices' }).getAttribute('aria-selected')).toBe('true');
		expect(screen.getByText('Beta')).toBeTruthy();
		expect(screen.getByText('Set by this tenant')).toBeTruthy();
		expect(screen.getByRole('button', { name: /Use default/ })).toBeTruthy();
		expect(screen.getAllByRole('form', { name: /Price for/ })).toHaveLength(5);
		expect(fieldsets().every((f) => !f.disabled)).toBe(true);
	});

	it('shows only that the feature is not enabled when the ledger refused, and no control', () => {
		render(PricesPage, {
			props: { data: data({ enabled: false, prices: { ok: false, gate: { state: 'locked', upgradeUrl: '' } } }), form: null },
		});
		expect(screen.getByTestId('not-enabled').textContent).toContain('Not enabled on this engine.');
		expect(fieldsets()).toHaveLength(0);
		expect(screen.queryByText('Beta')).toBeNull();
	});

	it('reports a refused price once', () => {
		render(PricesPage, {
			props: { data: data(), form: { form: 'price', error: 'The cost ledger is not enabled on this engine.', locked: true } as never },
		});
		expect(screen.getAllByText('The cost ledger is not enabled on this engine.')).toHaveLength(1);
	});
});

/*
 * A price card states what this tenant pays per block of units. Drawn with no
 * price read, every card claimed the default at 0 USD and offered to save it.
 */
describe('tenant cost prices that are not known', () => {
	it('draws no price card when the prices could not be read', () => {
		render(PricesPage, {
			props: { data: data({ prices: { ok: false, gate: { state: 'unavailable' } } }), form: null },
		});
		expect(screen.queryByTestId('cost-prices')).toBeNull();
		expect(screen.queryAllByRole('form', { name: /Price for/ })).toHaveLength(0);
		expect(screen.queryByText('Default')).toBeNull();
		expect(screen.getByText(/so the prices did not load/)).toBeTruthy();
	});
});

/*
 * At 1024 pixels two cards sat side by side and the per-units stepper shrank
 * to a few digits between its buttons, so a block of 1073741824 read as 10737.
 */
describe('the price cards on a narrow screen', () => {
	it('keeps the cards one per row below the widest screens and gives the stepper the widest column', () => {
		render(PricesPage, { props: { data: data(), form: null } });
		const cards = screen.getByTestId('cost-prices');
		expect(cards.className).toContain('xl:grid-cols-2');
		expect(cards.className).not.toMatch(/(^|\s)lg:grid-cols-2/);
		const row = document.querySelector('#price-storage-per')?.closest('.grid');
		expect(row?.className).toContain('minmax(9rem,1.4fr)');
	});
});
