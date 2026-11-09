// @vitest-environment jsdom
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/navigation', () => ({
	goto: vi.fn(async () => {}),
	invalidateAll: vi.fn(async () => {}),
}));
vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));

import GoroutinesPage from './+page.svelte';

afterEach(() => {
	cleanup();
});

const POOL_VIEW = { size: 64, active: 3, waiting: 1, completed: 900, failed: 2, dropped: 0, avg_latency: '1.2ms', task_timeout: '30s' };
const PARALLEL_VIEW = { max_concurrent: 8, timeout: '30s' };
const ASYNC_VIEW = { enabled: true, workers: 4, queue_size: 1024, timeout: '5s', queued: 0, running: 1, overflow: 0, dropped: 0 };
const SNAPSHOT = {
	total: 12,
	runtime_total: 42,
	max_goroutines: 10000,
	leak_threshold: '5m0s',
	by_owner: {
		engine: { total: 4, oldest: '1m2s' },
		'cron': { total: 7, oldest: '3m10s' },
		'email': { total: 1, oldest: '2s' },
	},
};

function engine(over: Record<string, unknown> = {}) {
	return {
		snapshot: SNAPSHOT,
		pool: POOL_VIEW,
		parallel: PARALLEL_VIEW,
		asyncHooks: ASYNC_VIEW,
		byOwner: [
			{ owner: 'cron', total: 7, oldest: '3m10s' },
			{ owner: 'engine', total: 4, oldest: '1m2s' },
			{ owner: 'email', total: 1, oldest: '2s' },
		],
		superAdmin: true,
		licensed: true,
		...over,
	};
}

function data(overrides: Record<string, unknown> = {}) {
	return {
		goroutineEngine: engine(),
		...overrides,
	};
}

const props = (over: Record<string, unknown> = {}, form: Record<string, unknown> | null = null) => ({
	data: data(over) as never,
	form: form as never,
});

/*
 * The engine's scaling primitives are one section: the four views as tiles,
 * the tracked goroutines by owner, and the three tunables as forms. The views
 * are readable on every install. The forms need super_admin and nothing else,
 * and say so instead of failing.
 */
describe('Goroutine engine', () => {
	const section = (container: HTMLElement) => container.querySelector('[data-testid="goroutine-engine"]') as HTMLElement;
	const fieldsets = (container: HTMLElement) => [...section(container).querySelectorAll('fieldset')] as HTMLFieldSetElement[];

	it('wears the Beta badge and renders the four views as tiles', () => {
		const { container } = render(GoroutinesPage, { props: props() });
		const el = section(container);
		expect(el.querySelector('h2')?.textContent).toContain('Goroutine engine');
		expect([...el.querySelectorAll('span')].some((s) => s.textContent?.trim() === 'Beta')).toBe(true);

		const views = el.querySelector('[data-testid="goroutine-views"]') as HTMLElement;
		for (const label of ['Tracked', 'Runtime', 'Ceiling', 'Leak threshold', 'Size', 'Active', 'Waiting', 'Completed', 'Failed', 'Dropped', 'Avg latency', 'Task timeout', 'Max concurrent', 'Enabled', 'Workers', 'Queue size', 'Queued', 'Running', 'Overflow']) {
			expect(views.textContent, label).toContain(label);
		}
		for (const value of ['10000', '5m', '64', '900', '1.2 ms', '1024', 'On']) {
			expect(views.textContent, value).toContain(value);
		}
	});

	it('lists the owners with the largest first', () => {
		const { container } = render(GoroutinesPage, { props: props() });
		const rows = [...section(container).querySelectorAll('[data-testid="goroutine-owners"] tbody tr')];
		expect(rows.map((r) => r.querySelector('td')?.textContent?.trim())).toEqual(['cron', 'engine', 'email']);
		expect(rows[0].textContent).toContain('7');
		expect(rows[0].textContent).toContain('3m10s');
	});

	it('says when nothing is tracked instead of an empty table', () => {
		const { container } = render(GoroutinesPage, {
			props: props({ goroutineEngine: engine({ snapshot: { total: 3, runtime_total: 3 }, byOwner: [] }) }),
		});
		expect(section(container).querySelector('[data-testid="goroutine-owners"]')).toBeNull();
		expect(section(container).textContent).toContain('No goroutines with an owner yet');
	});

	it('opens the forms on the live values and enables them for a super admin', () => {
		const { container } = render(GoroutinesPage, { props: props() });
		expect(fieldsets(container)).toHaveLength(3);
		for (const fs of fieldsets(container)) expect(fs.disabled).toBe(false);
		expect((container.querySelector('input[name="size"]') as HTMLInputElement).value).toBe('64');
		expect((container.querySelector('input[name="max_concurrent"]') as HTMLInputElement).value).toBe('8');
		expect((container.querySelector('input[name="timeout"]') as HTMLInputElement).value).toBe('30s');
		expect((container.querySelector('input[name="workers"]') as HTMLInputElement).value).toBe('4');
		expect((container.querySelector('input[name="queue_size"]') as HTMLInputElement).value).toBe('1024');
		expect((container.querySelector('input[name="enabled"]') as HTMLInputElement).checked).toBe(true);
		expect(section(container).querySelector('[data-testid="not-enabled"]')).toBeNull();
		expect(section(container).querySelector('[data-testid="goroutine-license-note"]')).toBeNull();
	});

	// The role and the plugin's tuning flag disable a form. Neither draws the
	// generic not-enabled notice.
	it('draws no not-enabled notice in this section for either role', () => {
		for (const superAdmin of [true, false]) {
			const { container } = render(GoroutinesPage, {
				props: props({ goroutineEngine: engine({ superAdmin }) }),
			});
			expect(section(container).querySelector('[data-testid="not-enabled"]')).toBeNull();
		}
	});

	it('disables the forms for an admin who is not super admin, with the reason', () => {
		const { container } = render(GoroutinesPage, {
			props: props({ goroutineEngine: engine({ superAdmin: false }) }),
		});
		for (const fs of fieldsets(container)) expect(fs.disabled).toBe(true);
		expect(section(container).querySelector('[data-testid="goroutine-role-note"]')?.textContent).toContain('super admin');
		// The views stay: the reads are not gated.
		expect(section(container).querySelector('[data-testid="goroutine-views"]')?.textContent).toContain('Tracked');
	});

	it('disables the forms for a super admin when tuning is not licensed, with the reason', () => {
		const { container } = render(GoroutinesPage, {
			props: props({ goroutineEngine: engine({ licensed: false }) }),
		});
		expect(fieldsets(container)).toHaveLength(3);
		for (const fs of fieldsets(container)) expect(fs.disabled).toBe(true);
		const note = section(container).querySelector('[data-testid="goroutine-license-note"]') as HTMLElement;
		expect(note.textContent).toContain('Tuning the goroutine engine is not enabled on this engine.');
		expect(note.querySelector('a')).toBeNull();
		expect(section(container).querySelector('[data-testid="goroutine-role-note"]')).toBeNull();
		// Every reading stays: only the writes are licensed.
		const views = section(container).querySelector('[data-testid="goroutine-views"]') as HTMLElement;
		for (const label of ['Tracked', 'Size', 'Max concurrent', 'Workers']) expect(views.textContent, label).toContain(label);
		expect((container.querySelector('input[name="size"]') as HTMLInputElement).value).toBe('64');
	});

	it('states both reasons when the session is not super admin and tuning is not licensed', () => {
		const { container } = render(GoroutinesPage, {
			props: props({ goroutineEngine: engine({ superAdmin: false, licensed: false }) }),
		});
		for (const fs of fieldsets(container)) expect(fs.disabled).toBe(true);
		expect(section(container).querySelector('[data-testid="goroutine-role-note"]')).not.toBeNull();
		expect(section(container).querySelector('[data-testid="goroutine-license-note"]')).not.toBeNull();
	});

	it('renders a 402 as the license refusal on the form that asked, not as an error', () => {
		const { container } = render(GoroutinesPage, {
			props: props({}, { form: 'pool', refused: { kind: 'feature', feature: 'example-feature', plugin: 'example', upgradeUrl: '' } }),
		});
		const forms = [...section(container).querySelectorAll('form')];
		const notice = forms[0].querySelector('[data-testid="refusal-notice"]') as HTMLElement;
		expect(notice.textContent).toContain('Not enabled on this engine');
		expect(notice.textContent).toContain('Nothing was changed.');
		expect(forms[0].querySelector('[role="alert"]')?.textContent ?? '').not.toContain('Failed to');
		expect(forms[1].querySelector('[data-testid="refusal-notice"]')).toBeNull();
		expect(forms[2].querySelector('[data-testid="refusal-notice"]')).toBeNull();
	});

	it('renders a refusal inline on the form that asked, and nowhere else', () => {
		const { container } = render(GoroutinesPage, {
			props: props({}, { form: 'parallel', error: 'Could not save the parallel engine settings. Try again.' }),
		});
		const forms = [...section(container).querySelectorAll('form')];
		expect(forms).toHaveLength(3);
		expect(forms[1].textContent).toContain('Could not save the parallel engine settings');
		// The failure arrives in a region mounted before it, which a screen
		// reader announces reliably.
		expect(forms[1].querySelector('.contents[aria-live="assertive"]')?.textContent).toContain('Could not save the parallel engine settings');
		expect(forms[0].textContent).not.toContain('Failed to');
		expect(forms[2].textContent).not.toContain('Failed to');
	});

	it('renders a 422 inline with the plugin bounds message', () => {
		const { container } = render(GoroutinesPage, {
			props: props({}, { form: 'pool', error: 'pool size must be between 1 and 4096' }),
		});
		const forms = [...section(container).querySelectorAll('form')];
		expect(forms[0].querySelector('[role="alert"]')?.textContent).toContain('between 1 and 4096');
	});

	it('reports a save on the form that made it', async () => {
		const { container } = render(GoroutinesPage, {
			props: props({}, { form: 'asyncHooks', saved: true, view: ASYNC_VIEW }),
		});
		const forms = [...section(container).querySelectorAll('form')];
		await vi.waitFor(() => expect(forms[2].textContent).toContain('Applied'));
		expect(forms[0].textContent).not.toContain('Applied');
	});

	// The confirmation clears itself, so the caveat it carried would clear with
	// it. The caveat is a standing fact and stays outside the alert.
	it('keeps the restart caveat outside the confirmation that clears itself', async () => {
		const { container } = render(GoroutinesPage, {
			props: props({}, { form: 'pool', saved: true, view: POOL_VIEW }),
		});
		const form = [...section(container).querySelectorAll('form')][0];
		const alert = () => [...form.querySelectorAll('[aria-live="polite"], [role="alert"]')].map((el) => el.textContent ?? '').join(' ');
		await vi.waitFor(() => expect(alert()).toContain('Applied'));
		expect(alert()).not.toContain('stays after a restart');
		expect(form.textContent).toContain('The change applies to every replica and stays after a restart.');
	});

	it('says the engine did not answer instead of drawing empty tiles', () => {
		const { container } = render(GoroutinesPage, {
			props: props({ goroutineEngine: engine({ snapshot: null, pool: null, parallel: null, asyncHooks: null, byOwner: [] }) }),
		});
		expect(section(container).textContent).toContain('Goroutine engine unavailable');
		expect(section(container).querySelector('form')).toBeNull();
	});
});

describe('the goroutine engine page', () => {
	it('carries the observability tabs with Goroutine engine marked', () => {
		const { getByRole } = render(GoroutinesPage, { props: props() });
		expect(getByRole('tab', { name: 'Goroutine engine' }).getAttribute('aria-selected')).toBe('true');
		expect(getByRole('tab', { name: 'Overview' }).getAttribute('aria-selected')).toBe('false');
	});

	it('offers one refresh for the page, in the header', () => {
		const { getAllByRole } = render(GoroutinesPage, { props: props() });
		expect(getAllByRole('button', { name: /refresh/i })).toHaveLength(1);
	});
});
