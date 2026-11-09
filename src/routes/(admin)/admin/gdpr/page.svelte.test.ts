// @vitest-environment jsdom
import { render, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy: () => {} }) }));
vi.mock('$app/state', () => ({ page: { url: new URL('http://admin/admin/gdpr') } }));

import GdprPage from './+page.svelte';

afterEach(cleanup);

// A confirmation takes its text two frames after it mounts, so a test that
// says one is absent looks only after those frames have passed.
async function twoFrames(): Promise<void> {
	await new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())));
	await tick();
}

const said = (c: HTMLElement) => (c.textContent ?? '').replace(/\s+/g, ' ');

function erased(errors: string[] | undefined, extra: Record<string, unknown> = {}) {
	return {
		data: { stepUp: null } as never,
		form: {
			action: 'erase',
			ok: true,
			subject: 'jane@example.com',
			result: { identifier: 'jane@example.com', total_rows: 12, errors, ...extra },
		} as never,
	};
}

// The only sentence the engine sends when an eraser fails.
const ERASERS_FAILED = 'one or more erasers failed';

// An erasure that failed in one plugin leaves the subject's data there. A
// green "complete" that clears itself would close the request on data that
// is still held.
describe('Privacy request erasure outcome', () => {
	it('calls an erasure with failures incomplete and says where to look', async () => {
		const { container, findByText } = render(GdprPage, { props: erased([ERASERS_FAILED]) });
		await findByText('Erasure incomplete');
		await twoFrames();
		const text = said(container);
		expect(text).toContain('Erasure incomplete');
		expect(text).not.toContain('Erasure complete');
		expect(text).toContain('but some data is still stored.');
		expect(text).toContain('Check the engine log for the part that failed, fix the cause, then run the erasure again.');
		const items = [...container.querySelectorAll('li')].map((li) => li.textContent?.trim());
		expect(items).toEqual([ERASERS_FAILED]);
	});

	it('keeps the incomplete erasure on screen until it is dismissed', async () => {
		vi.useFakeTimers();
		try {
			const { container } = render(GdprPage, { props: erased([ERASERS_FAILED]) });
			await vi.advanceTimersByTimeAsync(60_000);
			await tick();
			expect(said(container)).toContain('Erasure incomplete');
		} finally {
			vi.useRealTimers();
		}
	});

	// A legal hold stops the erasure before anything is erased. The engine
	// answers with no rows and no errors and names the holds.
	it('says a held erasure erased nothing and names the holds', async () => {
		const { container, findByText } = render(GdprPage, {
			props: erased([], { total_rows: 0, holds: [{ id: 'h1', reason: 'Litigation 42' }, { id: 'h2' }] }),
		});
		await findByText('Erasure held');
		await twoFrames();
		const text = said(container);
		expect(text).toContain('Erasure held');
		expect(text).not.toContain('Erasure complete');
		expect(text).toContain('Nothing was erased');
		expect(text).toContain('under audit retention, then run the erasure again');
		const items = [...container.querySelectorAll('li')].map((li) => li.textContent?.trim());
		expect(items).toEqual(['Litigation 42', 'h2']);
	});

	// An address another account in the tenant also holds keeps its rows.
	// The engine answers unfinished and names no failed part, and a repeat
	// erases nothing more, so the page offers neither.
	it('says records were kept when the answer is unfinished and names no failed part', async () => {
		vi.useFakeTimers();
		try {
			const { container } = render(GdprPage, {
				props: erased(['not finished: rows kept under a shared address'], { total_rows: 3, complete: false }),
			});
			await vi.advanceTimersByTimeAsync(60_000);
			await tick();
			const text = said(container);
			expect(text).toContain('Erasure kept some records');
			expect(text).toContain("cannot be told apart from another account's data in this tenant");
			expect(text).toContain('Erased 3 rows');
			expect(text).not.toContain('Erasure complete');
			expect(text).not.toContain('Erasure incomplete');
			expect(text).not.toContain('which part failed');
			expect(text).not.toContain('Run the erasure again');
			expect(container.querySelectorAll('li')).toHaveLength(0);
		} finally {
			vi.useRealTimers();
		}
	});

	it('still calls an unfinished erasure that names its failed parts incomplete', () => {
		const { container } = render(GdprPage, {
			props: erased(['not finished: forms', 'repeat the request to finish the erasure'], {
				complete: false,
				failed: ['forms'],
			}),
		});
		const text = said(container);
		expect(text).toContain('Erasure incomplete');
		expect(text).toContain('Check the engine log for the part that failed, fix the cause, then run the erasure again.');
		expect(text).not.toContain('Erasure kept some records');
	});

	it('calls an erasure with no failures complete', async () => {
		const { container } = render(GdprPage, { props: erased([]) });
		await vi.waitFor(() => expect(said(container)).toContain('Erasure complete'));
		expect(said(container)).toContain('Erased 12 rows');
	});
});

describe('the export download under a finger', () => {
	// The link is drawn as a small button, so it grows to the control size
	// under a finger as a Button does.
	it('grows the Download JSON link to the control size', () => {
		const { getByRole } = render(GdprPage, {
			props: { data: { stepUp: null } as never, form: { action: 'export', ok: true, subject: 'jane@example.com', result: { identifier: 'jane@example.com', plugins: {}, errors: [], summary: { total_records: 0, plugins_with_data: 0, plugins_queried: 1 } } } as never },
		});
		expect(getByRole('link', { name: /Download JSON/ }).classList.contains('coarse:min-h-control')).toBe(true);
	});
});

describe('what a person proves before exporting', () => {
	const stepUp = (factors: string[], form: unknown = null) => ({
		data: { stepUp: { ok: true, value: { factors } } } as never,
		form: form as never,
	});

	it('ticks the stored factors and says what each one asks', () => {
		const { container } = render(GdprPage, { props: stepUp(['password', 'email']) });
		const ticked = [...container.querySelectorAll('input[name="factors"]:checked')].map((i) => (i as HTMLInputElement).value);
		expect(ticked).toEqual(['password', 'email']);
		expect(said(container)).toContain('Someone without two-factor authentication set up cannot export while this is ticked.');
		expect(said(container)).toContain('With nothing ticked, being signed in is enough.');
	});

	it('ticks nothing when no step is required', () => {
		const { container } = render(GdprPage, { props: stepUp([]) });
		expect(container.querySelectorAll('input[name="factors"]:checked')).toHaveLength(0);
	});

	it('leaves the setting out while its routes do not answer', () => {
		const { container } = render(GdprPage, { props: { data: { stepUp: null } as never, form: null as never } });
		expect(said(container)).not.toContain('Before a person exports their own data');
	});

	it('draws a failed read as a failure with a way to try again', () => {
		const { container, getByRole } = render(GdprPage, {
			props: { data: { stepUp: { ok: false, gate: { state: 'unavailable' } } } as never, form: null as never },
		});
		expect(said(container)).toContain('did not load');
		expect(getByRole('link', { name: /try again/i })).toBeTruthy();
		expect(container.querySelector('input[name="factors"]')).toBeNull();
	});

	it('confirms a save', async () => {
		const { container } = render(GdprPage, { props: stepUp(['code'], { action: 'stepUp', ok: true }) });
		await vi.waitFor(() => expect(said(container)).toContain('Export requirements saved. They apply to the next export on every tenant.'));
	});

	it('says why the section is empty while its plugin is stopped', () => {
		const { container, getByTestId } = render(GdprPage, {
			props: { data: { stepUp: { ok: false, stopped: { state: 'not-built' } } } as never, form: null as never },
		});
		expect(getByTestId('not-running').dataset.plugin).toBe('analytics');
		expect(container.querySelector('input[name="factors"]')).toBeNull();
	});

	it('shows a license refusal on save with its way forward', () => {
		const refused = { kind: 'feature', feature: 'example-feature', plugin: 'example', upgradeUrl: '' };
		const { container } = render(GdprPage, {
			props: stepUp(['code'], { action: 'stepUp', error: 'This needs example-feature.', refused }),
		});
		expect(container.querySelector('form[action="?/stepUp"] [data-testid="refusal-notice"]')).not.toBeNull();
	});

	it('keeps a refused save on screen', async () => {
		const { container } = render(GdprPage, {
			props: stepUp(['email'], { action: 'stepUp', error: 'Email is not set up, so an emailed code cannot be required.' }),
		});
		await vi.waitFor(() => expect(said(container)).toContain('Email is not set up'));
		await twoFrames();
		expect(said(container)).not.toContain('Export requirements saved.');
	});
});
