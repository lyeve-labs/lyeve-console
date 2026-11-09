// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/navigation', () => ({ goto: vi.fn(async () => {}), invalidateAll: vi.fn(async () => {}) }));
vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));

import ProfilerPage from './+page.svelte';

const STATS = {
	endpoint: '/api/v1/content',
	method: 'GET',
	count: 4,
	avg_duration_ns: 1_500_000,
	p50_duration_ns: 1_000_000,
	p95_duration_ns: 2_500_000_000,
	p99_duration_ns: 3_000_000_000,
	max_duration_ns: 4_000_000_000,
	avg_alloc_bytes: 2048,
	total_alloc_bytes: 8192,
	last_seen: '2026-09-21T10:00:00Z',
};

const ok = <T,>(value: T) => ({ ok: true as const, value });
const down = { ok: false as const, gate: { state: 'unavailable' } };

function page(over: Record<string, unknown> = {}) {
	return {
		endpoints: ok([STATS]),
		slowest: ok([STATS]),
		plugins: ok([{ plugin: 'core', count: 4, avg_duration_ns: 1_000_000, max_duration_ns: 2_000_000, total_alloc_bytes: 4096 }]),
		selected: null,
		detail: null,
		...over,
	};
}

function props(data: Record<string, unknown>, form: Record<string, unknown> | null = null) {
	return { data: data as never, form: form as never };
}

afterEach(cleanup);

describe('the profiler page', () => {
	it('renders the slowest table and the plugin breakdown', () => {
		const { getByTestId } = render(ProfilerPage, props(page()));
		expect(getByTestId('profiler-slowest').textContent).toContain('/api/v1/content');
		expect(getByTestId('profiler-slowest').textContent).toContain('2.50 s');
		expect(getByTestId('profiler-plugins').textContent).toContain('core');
	});

	it('links every endpoint row to its own detail by query parameter', () => {
		const { container } = render(ProfilerPage, props(page()));
		const link = container.querySelector('a[href^="/admin/observability/profiler?endpoint="]');
		expect(link?.getAttribute('href')).toBe('/admin/observability/profiler?endpoint=api%2Fv1%2Fcontent');
	});

	it('renders the selected endpoint with its recent entries', () => {
		const detail = {
			endpoint: '/api/v1/content',
			methods: [{ method: 'GET', count: 4, stats: STATS, recent_entries: [{ plugin: 'core', endpoint: '/api/v1/content', method: 'GET', duration_ns: 1_000_000, status_code: 503, alloc_bytes: 100, total_alloc: 1, heap_alloc: 1, heap_objects: 1, num_gc: 1, num_goroutine: 9, captured_at: '2026-09-21T10:00:00Z' }] }],
			total_count: 4,
			limit: 100,
			offset: 0,
		};
		const { getByTestId } = render(ProfilerPage, props(page({ selected: '/api/v1/content', detail: ok(detail) })));
		const section = getByTestId('profiler-detail');
		expect(section.textContent).toContain('4 samples recorded');
		expect(section.textContent).toContain('Recent GET requests');
		expect(section.textContent).toContain('503');
	});

	it('says the ring holds nothing for a selection it has no sample of', () => {
		const { getByTestId } = render(ProfilerPage, props(page({ selected: '/nothing', detail: ok(null) })));
		expect(getByTestId('profiler-detail').textContent).toContain('No data for this endpoint');
	});

	// A failed read of the selection said the endpoint had no samples.
	it('says the selection could not be read rather than that it has no data', () => {
		const { getByTestId } = render(ProfilerPage, props(page({ selected: '/api/v1/content', detail: down })));
		const text = getByTestId('profiler-detail').textContent ?? '';
		expect(text).toContain('is unavailable');
		expect(text).not.toContain('No data for this endpoint');
	});

	it('says which view the engine did not answer instead of rendering zeros', () => {
		const { container, getByTestId } = render(ProfilerPage, props(page({ slowest: down, plugins: down, endpoints: down })));
		expect(getByTestId('profiler-slowest').textContent).toContain('is unavailable');
		expect(getByTestId('profiler-plugins').textContent).toContain('is unavailable');
		expect(container.textContent).not.toContain('0 endpoints sampled');
	});
});

describe('the endpoint links on a touch screen', () => {
	// Each link is the only control in its row, and only 16px tall.
	it('gives each endpoint link the touch hit area', () => {
		const { getByTestId } = render(ProfilerPage, props(page()));
		const link = getByTestId('profiler-slowest').querySelector('a') as HTMLAnchorElement;
		expect(link.className).toContain('hit-area');
		expect(link.className).toContain('relative');
	});
});

describe('the profiler links under a finger', () => {
	const hasHitArea = (el: Element | null) => !!el && ['relative', 'hit-area'].every((c) => el.classList.contains(c));

	it('gives Clear selection a touch hit area', () => {
		const { getByRole } = render(ProfilerPage, props(page({ selected: '/nothing', detail: ok(null) })));
		expect(hasHitArea(getByRole('link', { name: 'Clear selection' }))).toBe(true);
	});
});

describe('the timings page', () => {
	it('carries the profiler tabs with Timings marked', () => {
		const { getByRole } = render(ProfilerPage, props(page()));
		expect(getByRole('tab', { name: 'Timings' }).getAttribute('aria-selected')).toBe('true');
	});

	it('leaves the memory trend and the capture forms to their own tabs', () => {
		const { queryByTestId } = render(ProfilerPage, props(page()));
		expect(queryByTestId('profiler-memory')).toBeNull();
		expect(queryByTestId('profiler-exports')).toBeNull();
	});
});
