// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/navigation', () => ({ goto: vi.fn(async () => {}), invalidateAll: vi.fn(async () => {}) }));
vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));

import TelemetryPage from './+page.svelte';

// The exporters as the plugin encodes them. Its times are Go time values,
// which JSON writes as the zero time rather than leaving them out, and an
// error has its addresses and URLs redacted.
const EXPORTERS = [
	{
		name: 'pushgateway',
		healthy: true,
		last_export: '2026-09-21T10:00:00Z',
		last_failure: '0001-01-01T00:00:00Z',
		exports: 4,
		failures: 0,
	},
	{
		name: 'otlp',
		healthy: false,
		last_export: '2026-09-21T09:00:00Z',
		last_failure: '2026-09-21T10:00:00Z',
		last_error: 'otlp: export: Post "[redacted]": dial tcp [redacted]: connect: connection refused',
		last_error_class: 'unreachable',
		exports: 1,
		failures: 3,
	},
];

/** A read that answered. */
function ok<T>(value: T) {
	return { ok: true, value };
}

/** A read that failed, as the load hands it over. */
function failed(gate: Record<string, unknown>) {
	return { ok: false, gate };
}

const NO_DESTINATION = ok({ destination: null, licensed: true });

/**
 * The page's data. Exporters are given as their values and wrapped as an
 * answered read, unless a test passes a whole section.
 */
function props(data: Record<string, unknown>, form: Record<string, unknown> | null = null) {
	const section = (v: unknown) => (v === null || (typeof v === 'object' && 'ok' in (v as object)) ? v : ok(v));
	return {
		data: {
			destination: NO_DESTINATION,
			...data,
			exporters: section(data.exporters),
		} as never,
		form: form as never,
	};
}

afterEach(cleanup);

describe('the role split', () => {
	// The exporters are the instance's export configuration. A tenant admin's
	// page carries no such section and no export control at all, rather than
	// an empty table or a disabled button.
	it('shows a tenant admin the destination only', () => {
		const { queryByTestId, queryByRole } = render(TelemetryPage, props({ superAdmin: false, exporters: null }));
		expect(queryByTestId('telemetry-destination')).not.toBeNull();
		expect(queryByTestId('telemetry-exporters')).toBeNull();
		expect(queryByRole('button', { name: /Export .* now/ })).toBeNull();
	});

	it('shows a super admin the exporters with an export control per row', () => {
		const { container, queryByTestId, getAllByRole } = render(TelemetryPage, props({ superAdmin: true, exporters: EXPORTERS }));
		expect(queryByTestId('telemetry-exporters')).not.toBeNull();
		expect(getAllByRole('button', { name: /Export .* now/ })).toHaveLength(2);
		expect(container.textContent).toContain('Healthy');
		expect(container.textContent).toContain('Unhealthy');
		expect(container.textContent).toContain('connection refused');
	});
});

describe('the exporters section', () => {
	it('relays the cooldown on the form that asked', () => {
		const { container } = render(
			TelemetryPage,
			props({ superAdmin: true, exporters: EXPORTERS }, { name: 'otlp', error: 'otlp exported a moment ago. Wait five seconds and try again.' }),
		);
		expect(container.textContent).toContain('Wait five seconds');
	});

	it('says the exporter list failed rather than that none is configured', () => {
		const message = 'Could not load exporters.';
		const { container, queryByTestId } = render(
			TelemetryPage,
			props({ superAdmin: true, exporters: failed({ state: 'error', message }) }),
		);
		expect(queryByTestId('telemetry-exporters')?.textContent).toContain(message);
		expect(container.textContent).not.toContain('No exporters configured');
	});

	it('says no exporter is configured rather than rendering an empty table', () => {
		const { container } = render(TelemetryPage, props({ superAdmin: true, exporters: [] }));
		expect(container.textContent).toContain('No exporters configured');
	});

	it('reads Never for an exporter that has not exported', () => {
		const { container } = render(TelemetryPage, props({ superAdmin: true, exporters: [{ name: 'statsd', healthy: true, last_export: '0001-01-01T00:00:00Z', last_failure: '0001-01-01T00:00:00Z', exports: 0, failures: 0 }] }));
		expect(container.textContent).toContain('Never');
		expect(container.textContent).not.toContain('Invalid Date');
	});
});

describe('the export page', () => {
	it('carries the telemetry tabs with Export marked', () => {
		const { getByRole } = render(TelemetryPage, props({ superAdmin: false, exporters: null }));
		expect(getByRole('tab', { name: 'Export' }).getAttribute('aria-selected')).toBe('true');
		expect(getByRole('tab', { name: 'Metrics' }).getAttribute('aria-selected')).toBe('false');
	});
});
