// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/navigation', () => ({ goto: vi.fn(async () => {}), invalidateAll: vi.fn(async () => {}) }));
vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));

import CapturePage from './+page.svelte';

function props(form: Record<string, unknown> | null = null) {
	return { data: {} as never, form: form as never };
}

afterEach(cleanup);

describe('the profiler capture page', () => {
	// The exports post to the admin's own proxy, which forwards the session
	// to the engine's debug route and hands the pprof bytes back as a file. A
	// proxy in front of both sends every /api/ path to the engine, so the
	// console's route has to live outside it.
	it('offers the four pprof exports as downloads through the console, never an engine path', () => {
		const { getByTestId } = render(CapturePage, props());
		const forms = [...getByTestId('profiler-exports').querySelectorAll('form')].map((f) => f.getAttribute('action'));
		expect(forms).toEqual([
			'/admin/observability/profiler/profile/cpu',
			'/admin/observability/profiler/profile/goroutine',
			'/admin/observability/profiler/profile/heap',
			'/admin/observability/profiler/profile/allocs',
		]);
		for (const action of forms) expect(action?.startsWith('/api/')).toBe(false);
	});

	it('draws a captured flamegraph as an image from its SVG', () => {
		const graph = { endpoint: '/api/v1/content', duration_sec: 5, svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>', profile_type: 'cpu', captured_at: '2026-09-21T10:00:00Z' };
		const { getByTestId } = render(CapturePage, props({ form: 'flamegraph', graph }));
		const img = getByTestId('flamegraph').querySelector('img');
		expect(img?.getAttribute('src')).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
		expect(img?.getAttribute('alt')).toContain('/api/v1/content');
	});

	it('relays a refused capture on the flamegraph form', () => {
		const { container } = render(CapturePage, props({ form: 'flamegraph', error: 'flamegraph generation failed' }));
		expect(container.textContent).toContain('flamegraph generation failed');
	});

	it('carries the profiler tabs with Profiles marked', () => {
		const { getByRole } = render(CapturePage, props());
		expect(getByRole('tab', { name: 'Profiles' }).getAttribute('aria-selected')).toBe('true');
	});
});
