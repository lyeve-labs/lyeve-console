// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import GoroutineEnginePanel from './GoroutineEnginePanel.svelte';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));

afterEach(cleanup);

const POOL = { size: 64, active: 3, waiting: 1, completed: 900, failed: 2, dropped: 0, avg_latency: '1.2ms', task_timeout: '30s' };
const PARALLEL = { max_concurrent: 8, timeout: '30s' };
const ASYNC = { enabled: true, workers: 4, queue_size: 1024, timeout: '5s', queued: 0, running: 1, overflow: 0, dropped: 0 };

function engine(over: Record<string, unknown> = {}) {
	return {
		snapshot: { total: 12, runtime_total: 42, max_goroutines: 10000, leak_threshold: '5m0s', by_owner: {} },
		pool: POOL,
		parallel: PARALLEL,
		asyncHooks: ASYNC,
		byOwner: [{ owner: 'cron', total: 7, oldest: '3m10s' }],
		superAdmin: true,
		licensed: true,
		...over,
	};
}

function setup(over: Record<string, unknown> = {}, form: Record<string, unknown> | null = null) {
	return render(GoroutineEnginePanel, { props: { engine: engine(over) as never, form: form as never } });
}

describe('goroutine engine stat grids', () => {
	// From the medium breakpoint the cards sit two across, and four stats in a
	// half-width card at 1024px cut "Leak threshold" and "Completed".
	it('puts four stats in a row only where a half-width card is wide enough', () => {
		const { getByTestId } = setup();
		const grids = getByTestId('goroutine-views').querySelectorAll('.sm\\:grid-cols-4');
		expect(grids.length).toBe(3);
		for (const grid of grids) {
			expect(grid.className).toContain('md:grid-cols-2');
			expect(grid.className).toContain('xl:grid-cols-4');
		}
	});
});

const field = (container: HTMLElement, id: string) => container.querySelector(`#${id}`) as HTMLInputElement;
const fieldset = (container: HTMLElement, action: string) => container.querySelector(`form[action="?/${action}"] fieldset`) as HTMLFieldSetElement;

describe('GoroutineEnginePanel', () => {
	it('posts each tunable to its own action with the field names the plugin reads', () => {
		const { container } = setup();
		const names = (action: string) => [...container.querySelectorAll(`form[action="?/${action}"] [name]`)].map((el) => el.getAttribute('name'));
		expect(names('pool')).toEqual(['size']);
		expect(names('parallel')).toEqual(['max_concurrent', 'timeout']);
		expect(names('asyncHooks')).toEqual(['workers', 'queue_size', 'timeout', 'enabled']);
	});

	it('opens the forms on the live values and keeps an edit when new values arrive', async () => {
		const { container, rerender } = setup();
		expect(field(container, 'ge-pool-size').value).toBe('64');
		expect(field(container, 'ge-parallel-timeout').value).toBe('30s');
		expect(field(container, 'ge-async-queue').value).toBe('1024');
		await rerender({ engine: engine({ pool: { ...POOL, size: 128 } }) as never, form: null as never });
		expect(field(container, 'ge-pool-size').value).toBe('64');
		expect(container.textContent).toContain('128');
	});

	it('disables the forms with the reason for a role or a license that cannot tune', () => {
		const { container } = setup({ superAdmin: false, licensed: false });
		for (const action of ['pool', 'parallel', 'asyncHooks']) expect(fieldset(container, action).disabled).toBe(true);
		expect(container.querySelector('[data-testid="goroutine-role-note"]')?.textContent).toContain('Only a super admin can change these.');
		expect(container.querySelector('[data-testid="goroutine-license-note"]')).toBeTruthy();
	});

	it('disables only the form whose part the engine runs without', () => {
		const { container } = setup({ parallel: undefined });
		expect(fieldset(container, 'pool').disabled).toBe(false);
		expect(fieldset(container, 'parallel').disabled).toBe(true);
		expect(container.textContent).toContain('This engine runs without a parallel engine.');
	});

	it('shows an answer only on the form that asked', async () => {
		const { container } = setup({}, { form: 'parallel', error: 'Max concurrent must be between 1 and 1024.' });
		const form = (action: string) => container.querySelector(`form[action="?/${action}"]`) as HTMLFormElement;
		expect(form('parallel').textContent).toContain('Max concurrent must be between 1 and 1024.');
		expect(form('pool').textContent).not.toContain('Max concurrent');
		cleanup();
		const saved = setup({}, { form: 'pool', saved: true });
		await vi.waitFor(() => expect((saved.container.querySelector('form[action="?/pool"]') as HTMLFormElement).textContent).toContain('Applied.'));
		expect((saved.container.querySelector('form[action="?/asyncHooks"]') as HTMLFormElement).textContent).not.toContain('Applied.');
	});

	it('says the engine did not answer instead of drawing empty tiles and forms', () => {
		const { container } = setup({ snapshot: undefined, pool: undefined, parallel: undefined, asyncHooks: undefined });
		expect(container.textContent).toContain('Goroutine engine unavailable');
		expect(container.querySelector('[data-testid="goroutine-tunables"]')).toBeNull();
	});
});
