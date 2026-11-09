// @vitest-environment jsdom
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/navigation', () => ({
	goto: vi.fn(async () => {}),
	invalidateAll: vi.fn(async () => {}),
}));

import ObservabilityPage from './+page.svelte';

afterEach(() => {
	cleanup();
});

// The engine's pool health snapshot as it serializes it: one flat object,
// measured on every read, latency in milliseconds.
const POOL_SNAPSHOT = {
	engine: 'postgres',
	healthy: true,
	latency_ms: 1.2,
	open_connections: 8,
	in_use: 3,
	idle: 5,
	max_open_connections: 25,
	wait_count: 0,
	wait_duration_ms: 0,
	max_idle_closed: 0,
	max_lifetime_closed: 0,
	utilization: 0.12,
	utilization_warning: false,
};

const ok = <T,>(value: T) => ({ ok: true as const, value });

function data(overrides: Record<string, unknown> = {}) {
	return {
		poolHealth: ok(POOL_SNAPSHOT),
		latency: ok({ slowest: [], total: 0 }),
		top: 20,
		goroutines: 42,
		...overrides,
	};
}

const props = (over: Record<string, unknown> = {}) => ({
	data: data(over) as never,
});

const health = (over: Record<string, unknown>) => ({
	poolHealth: ok({ engine: 'postgres', healthy: true, ...over }),
});

describe('Pool health badge', () => {
	// Seven stats across a 1024px screen cut "Goroutines" and the engine name.
	it('puts the pool stats seven across only from the extra large breakpoint', () => {
		const { container } = render(ObservabilityPage, { props: props() });
		const row = container.querySelector('[data-testid="pool-stats"]') as HTMLElement;
		expect(row.className).toContain('xl:grid-cols-7');
		expect(row.className).not.toContain('lg:grid-cols-7');
	});

	it('reads Healthy with its counts for a measured pool', () => {
		const { container } = render(ObservabilityPage, { props: props() });
		const row = container.querySelector('[data-testid="pool-stats"]') as HTMLElement;

		expect(container.textContent).toContain('Healthy');
		const text = row.textContent?.replace(/\s+/g, ' ');
		expect(text).toContain('Open 8');
		expect(text).toContain('In use 3');
		expect(text).toContain('Idle 5');
		expect(text).toContain('1.2 ms');
	});

	it('still reads Unhealthy when the engine says so, metrics or not', () => {
		const { container } = render(ObservabilityPage, {
			props: props(health({ healthy: false })),
		});

		expect(container.textContent).toContain('Unhealthy');
	});

	it('reads Unhealthy over a measured pool the engine judged unhealthy', () => {
		const { container } = render(ObservabilityPage, {
			props: props({ poolHealth: ok({ ...POOL_SNAPSHOT, healthy: false, errors: ['ping took 900ms'] }) }),
		});

		expect(container.textContent).toContain('Unhealthy');
		expect(container.textContent).toContain('ping took 900ms');
		expect(container.textContent).toContain('Wait count');
	});
});

/*
 * The pool's state is a badge on its card, the figures are one row,
 * the rankings table is the body with its row count in the toolbar, and there
 * is one refresh for the page.
 */
describe('Page shape', () => {
	it("opens without a banner, and says the pool's health on the card badge", () => {
		const { container } = render(ObservabilityPage, { props: props() });
		expect(container.querySelector('[role="alert"], [role="status"]')).toBeNull();
		const badge = [...container.querySelectorAll('span')].find((el) => el.textContent?.trim() === 'Healthy');
		expect(badge, 'no badge').toBeTruthy();
		const header = badge!.closest('div');
		expect(header?.querySelector('h2')?.textContent).toContain('Connection pool');
	});

	it('puts the engine, the ping latency, the goroutines and the pool counts on one row', () => {
		const { container } = render(ObservabilityPage, { props: props() });
		const row = container.querySelector('[data-testid="pool-stats"]') as HTMLElement;
		for (const label of ['Engine', 'Ping latency', 'Goroutines', 'Open', 'In use', 'Idle', 'Wait count']) {
			expect(row.textContent, label).toContain(label);
		}
		expect(row.textContent).toContain('42');
	});

	it('offers one refresh for the page, in the header', () => {
		const { getAllByRole } = render(ObservabilityPage, { props: props() });
		expect(getAllByRole('button', { name: /refresh/i })).toHaveLength(1);
	});

	it('keeps the row count in the rankings toolbar', () => {
		const { container } = render(ObservabilityPage, { props: props({ latency: ok({ slowest: [], total: 7 }) }) });
		const bar = [...container.querySelectorAll('[role="toolbar"]')].find((el) => el.getAttribute('aria-label') === 'Latency rankings');
		expect(bar?.querySelector('#latency-top')).toBeTruthy();
		expect(bar?.textContent).toContain('7 endpoints tracked');
	});
});

/*
 * A read that failed is said to have failed. Drawn as its empty answer, it
 * read as an engine that had timed nothing and as a pool with no pooler.
 */
describe('reads that failed', () => {
	const failed = (message: string) => ({ ok: false, gate: { state: 'error', message } });

	it('says the latency rankings could not be read', () => {
		const { container } = render(ObservabilityPage, {
			props: props({ latency: failed('Could not load latency rankings.') }),
		});
		expect(container.textContent).toContain('Could not load latency rankings.');
		expect(container.textContent).not.toContain('No latency data yet');
		expect(container.textContent).not.toContain('endpoints tracked');
	});

	it('names an outage of the pool health read as an outage', () => {
		const { container } = render(ObservabilityPage, {
			props: props({ poolHealth: { ok: false, gate: { state: 'unavailable' } } }),
		});
		expect(container.textContent).toContain('is unavailable');
		expect(container.textContent).not.toContain('No pool statistics');
		expect(container.textContent).not.toContain('No check time reported');
	});

	it('says the pool reported no statistics when the read answered without them', () => {
		const { container } = render(ObservabilityPage, { props: props({ poolHealth: ok({}) }) });
		expect(container.textContent).toContain('No pool statistics');
		expect(container.textContent).not.toContain('is unavailable');
	});
});

describe('latency depth', () => {
	it('offers each depth as a link that keeps the place on the page', () => {
		const { container } = render(ObservabilityPage, { props: props() });
		const links = [...container.querySelectorAll<HTMLAnchorElement>('#latency-top a')];
		expect(links.map((a) => a.getAttribute('href'))).toEqual([
			'/admin/observability?top=10',
			'/admin/observability?top=20',
			'/admin/observability?top=50',
			'/admin/observability?top=100',
		]);
		expect(links.find((a) => a.getAttribute('aria-current') === 'page')?.textContent).toContain('Top 20');
		expect(container.querySelector('#latency-top')?.hasAttribute('data-sveltekit-noscroll')).toBe(true);
	});
});

describe('the area strip', () => {
	it('carries the observability tabs with Overview marked', () => {
		const { getByRole } = render(ObservabilityPage, { props: props() });
		expect(getByRole('tab', { name: 'Overview' }).getAttribute('aria-selected')).toBe('true');
		expect(getByRole('tab', { name: 'Goroutine engine' }).getAttribute('aria-selected')).toBe('false');
	});
});
