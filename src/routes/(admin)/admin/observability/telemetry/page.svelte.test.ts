// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/navigation', () => ({ goto: vi.fn(async () => {}), invalidateAll: vi.fn(async () => {}) }));

import TelemetryPage from './+page.svelte';
import type { MetricFamily } from '$lib/api/telemetry';

const REQUESTS: MetricFamily = {
	name: 'lyeve_requests_total',
	help: 'Requests served.',
	type: 'counter',
	samples: [{ labels: { code: '2xx', method: 'GET', plugin: 'core', tenant: 'acme' }, value: 12 }],
};

const POOL: MetricFamily = {
	name: 'lyeve_db_pool_max_connections',
	help: 'Maximum open connections.',
	type: 'gauge',
	samples: [{ labels: {}, value: 25 }],
};

/** A read that answered. */
function ok<T>(value: T) {
	return { ok: true, value };
}

/** A read that failed, as the load hands it over. */
function failed(gate: Record<string, unknown>) {
	return { ok: false, gate };
}

/** A status report whose telemetry row names the given maturity in its manifest. */
function statusSaying(maturity: string | undefined) {
	return {
		compiled: ['telemetry'],
		entitled: ['telemetry'],
		plugins: [
			{
				name: 'telemetry',
				compiled: true,
				entitled: true,
				requested: true,
				active: true,
				phase: 'running',
				manifest: { label: 'Telemetry', category: 'platform', ...(maturity ? { maturity } : {}) },
			},
		],
	};
}

/**
 * The page's data. Families are given as their values and wrapped as an
 * answered read, unless a test passes a whole section.
 */
function props(data: Record<string, unknown>) {
	const section = (v: unknown) => (v === null || (typeof v === 'object' && 'ok' in (v as object)) ? v : ok(v));
	return {
		data: {
			...data,
			families: section(data.families),
		} as never,
	};
}

afterEach(cleanup);

describe('the role split', () => {
	// The exporters are the instance's export configuration. A tenant admin's
	// page carries no such section and no export control at all, rather than
	// an empty table or a disabled button.
	it('shows a tenant admin the metrics view only', () => {
		const { container, queryByTestId, queryByRole } = render(TelemetryPage, props({ superAdmin: false, families: [REQUESTS] }));
		expect(queryByTestId('telemetry-metrics')).not.toBeNull();
		expect(queryByTestId('telemetry-exporters')).toBeNull();
		expect(queryByRole('button', { name: /Export .* now/ })).toBeNull();
		expect(container.textContent).toContain('Only series with your tenant label');
		expect(container.textContent).toContain('{code="2xx",method="GET",plugin="core",tenant="acme"}');
		expect(container.textContent).not.toContain('Exporters');
	});

	it('shows a super admin the whole registry, and leaves the exporters to the export tab', () => {
		const { container, queryByTestId, queryByRole } = render(TelemetryPage, props({ superAdmin: true, families: [POOL, REQUESTS] }));
		expect(queryByTestId('telemetry-metrics')).not.toBeNull();
		expect(queryByTestId('telemetry-exporters')).toBeNull();
		expect(queryByRole('button', { name: /Export .* now/ })).toBeNull();
		expect(container.textContent).toContain('every tenant');
		expect(container.textContent).toContain('lyeve_db_pool_max_connections');
	});

	it('wears the Beta badge the plugin asks for, with the gaps named', () => {
		const { container } = render(
			TelemetryPage,
			props({ superAdmin: false, families: [REQUESTS], pluginStatus: statusSaying('beta') }),
		);
		expect(container.textContent).toContain('Beta');
		expect(container.textContent).toContain('One exporter set');
		expect(container.textContent).toContain('tenant slug');
	});

	it('leaves the badge off when the plugin does not say it is beta', () => {
		for (const pluginStatus of [statusSaying('stable'), statusSaying(undefined), null]) {
			const { container } = render(
				TelemetryPage,
				props({ superAdmin: false, families: [REQUESTS], pluginStatus }),
			);
			expect(container.textContent).not.toContain('Beta');
			cleanup();
		}
	});
});

describe('the metrics view', () => {
	it('says the engine did not answer the scrape rather than showing an empty registry', () => {
		const { container, queryByRole } = render(
			TelemetryPage,
			props({ superAdmin: false, families: failed({ state: 'unavailable' }) }),
		);
		expect(container.textContent).toContain('so telemetry metrics did not load');
		expect(container.textContent).not.toContain('No series yet');
		expect(queryByRole('searchbox', { name: 'Filter families' })).toBeNull();
	});

	it('says the role cannot read the metrics and offers no retry', () => {
		const { container, queryByRole } = render(
			TelemetryPage,
			props({ superAdmin: false, families: failed({ state: 'forbidden' }) }),
		);
		expect(container.textContent).toContain('Your role cannot open telemetry metrics.');
		expect(queryByRole('link', { name: /Try again/ })).toBeNull();
	});

	it('keeps the sentence of a failed scrape', () => {
		const message = 'Could not load metrics.';
		const { container } = render(
			TelemetryPage,
			props({ superAdmin: true, families: failed({ state: 'error', message }) }),
		);
		expect(container.textContent).toContain(message);
	});

	it('tells a tenant admin with no series that none has been recorded under their tenant', () => {
		const { container } = render(TelemetryPage, props({ superAdmin: false, families: [] }));
		expect(container.textContent).toContain('under your tenant');
	});

	it('filters the families by the search', async () => {
		const { container, getByRole } = render(TelemetryPage, props({ superAdmin: true, families: [POOL, REQUESTS] }));
		const search = getByRole('searchbox', { name: 'Filter families' });
		await fireEvent.input(search, { target: { value: 'pool' } });
		await tick();
		expect(container.textContent).toContain('lyeve_db_pool_max_connections');
		expect(container.textContent).not.toContain('lyeve_requests_total');
		expect(container.textContent).toContain('1 of 2 families');
	});

	it('folds a long family and opens it on demand', async () => {
		const wide: MetricFamily = {
			name: 'lyeve_request_duration_seconds',
			help: '',
			type: 'histogram',
			samples: Array.from({ length: 15 }, (_, i) => ({ labels: { le: String(i), __series: 'bucket' }, value: i })),
		};
		const { container, getByRole } = render(TelemetryPage, props({ superAdmin: true, families: [wide] }));
		expect(container.querySelectorAll('tbody tr')).toHaveLength(12);
		await fireEvent.click(getByRole('button', { name: 'Show all 15' }));
		await tick();
		expect(container.querySelectorAll('tbody tr')).toHaveLength(15);
		expect(container.textContent).toContain('lyeve_request_duration_seconds_bucket{le="14"}');
	});
});

describe('the metrics page', () => {
	it('carries the telemetry tabs with Metrics marked', () => {
		const { getByRole } = render(TelemetryPage, props({ superAdmin: false, families: [REQUESTS] }));
		expect(getByRole('tab', { name: 'Metrics' }).getAttribute('aria-selected')).toBe('true');
		expect(getByRole('tab', { name: 'Export' }).getAttribute('aria-selected')).toBe('false');
	});
});
