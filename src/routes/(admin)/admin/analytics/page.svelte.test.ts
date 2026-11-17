// @vitest-environment jsdom
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';

import AnalyticsPage from './+page.svelte';
import { outlineSkips } from '#lib/test-outline.ts';

afterEach(cleanup);

function said(c: HTMLElement): string {
	return (c.textContent ?? '').replace(/\s+/g, ' ');
}

const summary = {
	from: '',
	to: '',
	total_requests: 1913,
	total_2xx: 1900,
	total_4xx: 13,
	total_5xx: 0,
	error_rate: 0.0068,
	avg_latency_p50_ms: 1,
	avg_latency_p95_ms: 4,
	avg_latency_p99_ms: 9,
	max_latency_p99_ms: 20,
	avg_request_size_bytes: 0,
	max_request_size_bytes: 0,
	unique_endpoints: 2,
	unique_tenants: 1,
	unique_methods: 4,
	unique_user_agents: 1,
};

function method(key: string, request_count: number) {
	return {
		key,
		request_count,
		error_rate: 0,
		avg_latency_p95_ms: 1,
		max_latency_p99_ms: 1,
		request_size_avg_bytes: 0,
	};
}

const ok = <T,>(value: T) => ({ ok: true as const, value });

const props = (over: Record<string, unknown> = {}) => ({
	data: {
		summary: ok(summary),
		endpoints: ok({ items: [], total: 0 }),
		methods: ok({ items: [method('GET', 1731), method('POST', 171), method('PUT', 10), method('PATCH', 1)], total: 4 }),
		agents: ok({ items: [], total: 0 }),
		anomalies: ok({ anomalies: [], window_hours: 0, z_threshold: 0 }),
		...over,
	} as never,
});

/** Every heading level in document order, so a test can say none is skipped. */
function levels(root: HTMLElement): number[] {
	return [...root.querySelectorAll('h1, h2, h3, h4, h5, h6')].map((h) => Number(h.tagName.slice(1)));
}

function skips(list: number[]): boolean {
	return list.some((level, i) => level > (i === 0 ? 1 : list[i - 1]) + 1);
}

describe('headings', () => {
	it('puts each section under the title at level 2, with no level skipped', () => {
		const { container } = render(AnalyticsPage, { props: props() });
		const list = levels(container);
		expect(list).toContain(2);
		expect(skips(list)).toBe(false);
	});

	it('steps its headings down one level at a time while the feature is not enabled', () => {
		const { container } = render(AnalyticsPage, { props: props({ summary: { ok: false, gate: { state: 'locked', upgradeUrl: '' } } }) });
		expect(container.querySelector('[data-testid="not-enabled"]')).toBeTruthy();
		expect(outlineSkips(container)).toEqual([]);
	});
});

describe('what the page counts', () => {
	// The plugin records every request to both APIs, the console's own
	// included, so the page cannot claim to cover the public one alone.
	it('says it counts both APIs', () => {
		const { container } = render(AnalyticsPage, { props: props() });
		const text = said(container);
		expect(text).toContain('for the Content API and the Admin API');
		expect(text).not.toContain('public API');
	});
});

describe('endpoints', () => {
	it('stops an average request size at MB', () => {
		const endpoint = { ...method('/api/v1/content', 3), request_size_avg_bytes: 2 * 1024 ** 3 };
		const { container } = render(AnalyticsPage, { props: props({ endpoints: ok({ items: [endpoint], total: 1 }) }) });
		expect(said(container)).toContain('2048.0 MB');
	});
});

describe('HTTP methods', () => {
	function shares(container: HTMLElement): Record<string, string> {
		const out: Record<string, string> = {};
		for (const bar of container.querySelectorAll('[role="progressbar"]')) {
			const label = bar.getAttribute('aria-label') ?? '';
			const row = bar.parentElement;
			const pct = row?.querySelector('.tabular-nums')?.textContent?.trim() ?? '';
			out[label.split(' ')[0] ?? label] = pct;
		}
		return out;
	}

	// A share of every request, so the busiest method does not read 100%.
	it('states each method as a share of all requests', () => {
		const { container } = render(AnalyticsPage, { props: props() });
		const got = shares(container);
		expect(got.GET).toBe('90%');
		expect(got.POST).toBe('9%');
		expect(got.PUT).toBe('1%');
		expect(got.PATCH).toBe('0%');
	});
});

describe('a read that failed', () => {
	const failed = (message: string) => ({ ok: false, gate: { state: 'error', message } });

	// Drawn as zeros, a failed summary read looked like an instance nobody
	// called, and a failed anomaly read looked like a healthy one.
	it('says the summary could not be read instead of drawing zeros', () => {
		const { container } = render(AnalyticsPage, {
			props: props({ summary: failed('Could not load the request summary.') }),
		});
		const text = said(container);
		expect(text).toContain('Could not load the request summary.');
		expect(text).not.toContain('Total requests');
	});

	it('does not report no anomalies when the anomaly read failed', () => {
		const { container } = render(AnalyticsPage, {
			props: props({ anomalies: failed('Could not load anomalies.') }),
		});
		const text = said(container);
		expect(text).toContain('Could not load anomalies.');
		expect(text).not.toContain('No anomalies detected');
	});

	it('names an outage as an outage', () => {
		const { container } = render(AnalyticsPage, {
			props: props({ endpoints: { ok: false, gate: { state: 'unavailable' } } }),
		});
		const text = said(container);
		expect(text).toContain('is unavailable');
		expect(text).not.toContain('No endpoint data yet');
	});

	it('says once that the plugin is missing', () => {
		const absent = { ok: false, gate: { state: 'absent' } };
		const { container } = render(AnalyticsPage, {
			props: props({ summary: absent, endpoints: absent, methods: absent, agents: absent, anomalies: absent }),
		});
		const text = said(container);
		expect(text.split('not included in this build').length - 1).toBe(1);
	});
});
