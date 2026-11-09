// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/navigation', () => ({ goto: vi.fn(async () => {}), invalidateAll: vi.fn(async () => {}) }));
vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));

import MemoryPage from './+page.svelte';

const MEMORY = {
	snapshots: [{ timestamp: '2026-09-21T10:00:00Z', heap_alloc: 3 * 1024 * 1024, heap_objects: 10, total_alloc: 4096, num_gc: 2, num_goroutine: 30 }],
	slope_bytes_per_sec: 2048,
	leak_likely: true,
	leak_reason: 'heap grew for 10 snapshots',
};

const ok = <T,>(value: T) => ({ ok: true as const, value });
const down = { ok: false as const, gate: { state: 'unavailable' } };

function props(memory: unknown, form: Record<string, unknown> | null = null) {
	return { data: { memory } as never, form: form as never };
}

afterEach(cleanup);

describe('the profiler memory page', () => {
	it('renders the memory trend with the leak verdict', () => {
		const { container, getByTestId } = render(MemoryPage, props(ok(MEMORY)));
		expect(container.textContent).toContain('Leak likely');
		expect(container.textContent).toContain('heap grew for 10 snapshots');
		expect(getByTestId('memory-stats').textContent).toContain('3.0 MB');
	});

	it('says the trend could not be read instead of rendering zeros', () => {
		const { getByTestId } = render(MemoryPage, props(down));
		expect(getByTestId('profiler-memory').textContent).toContain('is unavailable');
	});

	it('carries the profiler tabs with Memory marked', () => {
		const { getByRole } = render(MemoryPage, props(ok(MEMORY)));
		expect(getByRole('tab', { name: 'Memory' }).getAttribute('aria-selected')).toBe('true');
	});

	it('resets through its own action, with the refresh beside it', () => {
		const { container, getAllByRole } = render(MemoryPage, props(ok(MEMORY)));
		expect(container.querySelector('form[action="?/reset"]')).toBeTruthy();
		expect(getAllByRole('button', { name: /refresh/i })).toHaveLength(1);
	});

	it('reports a reset on this tab', async () => {
		const { container } = render(MemoryPage, props(ok(MEMORY), { form: 'reset', reset: true }));
		await vi.waitFor(() => expect(container.textContent).toContain('Profiler reset.'));
	});
});
