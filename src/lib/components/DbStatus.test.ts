// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActionResult, SubmitFunction } from '$app/forms';

const nav = vi.hoisted(() => ({ refreshAll: vi.fn(async () => {}), invalidate: vi.fn(async (_dep: string) => {}) }));
vi.mock('$app/navigation', () => nav);

/*
 * enhance is mocked to hand back the submit function the component gave it.
 * Driving that directly exercises what the component does with each kind of
 * ActionResult without a real submission, which in jsdom would need the whole
 * router.
 */
const forms = vi.hoisted(() => ({ submits: [] as SubmitFunction[] }));
vi.mock('$app/forms', () => ({
	enhance: (_el: HTMLFormElement, fn?: SubmitFunction) => {
		if (fn) forms.submits.push(fn);
		return { destroy: () => {} };
	},
}));

import DbStatus from './DbStatus.svelte';

/** Queued statements, in the shape the engine lists them. */
const queue = [
	{ schema_name: 'posts', description: 'drop column _posts.title' },
	{ schema_name: 'posts', description: 'clear column _posts.body for tenant acme' },
	{ schema_name: 'pages', description: 'add column _pages.slug' },
];

beforeEach(() => {
	forms.submits = [];
	nav.refreshAll.mockClear();
	nav.invalidate.mockClear();
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

/** Runs the captured submit function and hands it one action result. */
async function submit(result: ActionResult): Promise<void> {
	const started = forms.submits[0];
	const done = (await started({} as never)) as (arg: { result: ActionResult }) => Promise<void>;
	await done({ result });
}

describe('DbStatus', () => {
	// A read belongs in `load` and a write in a form action, so the script here
	// makes no call of its own.
	it('asks the engine for nothing of its own', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);

		render(DbStatus, { props: { pending: 3, redirectTo: '/admin/media' } });

		await waitFor(() => expect(screen.getByTestId('db-status')).toBeTruthy());
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('reports a database that matches the schemas', () => {
		render(DbStatus, { props: { pending: 0, redirectTo: '/admin' } });

		expect(screen.getByText('Database synced')).toBeTruthy();
		expect(document.querySelector('form')).toBeNull();
	});

	it('says the count is unknown when the shell got no answer', () => {
		// Reading no answer as zero would paint the chip green and claim the
		// database is in step with a server that has not spoken.
		render(DbStatus, { props: { pending: null, redirectTo: '/admin' } });

		expect(screen.getByText('Database unknown')).toBeTruthy();
		expect(screen.queryByText('Database synced')).toBeNull();
	});

	it('makes the pending count the control that clears it', () => {
		// The count and the action are one thing, not a label pointing at a
		// control somewhere else.
		render(DbStatus, { props: { pending: 3, redirectTo: '/admin/media?limit=25' } });

		const button = screen.getByTestId('db-status');
		expect(button.textContent).toContain('3 pending');
	});

	/*
	 * The queue holds every tenant's pending drops on the tables they share, and
	 * a dropped column takes its data with it. One click on a header chip that
	 * reads as a status badge applied all of it.
	 */
	it('asks before applying, naming every queued statement', async () => {
		render(DbStatus, { props: { pending: 3, items: queue, redirectTo: '/admin' } });

		const chip = screen.getByTestId('db-status');
		expect(chip.getAttribute('type')).toBe('button');
		expect(document.querySelector('form')).toBeNull();

		await fireEvent.click(chip);

		const dialog = screen.getByRole('dialog');
		for (const item of queue) expect(within(dialog).getByText(item.description)).toBeTruthy();
		const drop = within(dialog).getByText('drop column _posts.title').closest('li') as HTMLElement;
		expect(within(drop).getByText('Destroys data')).toBeTruthy();
		const clear = within(dialog).getByText('clear column _posts.body for tenant acme').closest('li') as HTMLElement;
		expect(within(clear).getByText('Destroys data')).toBeTruthy();
		const add = within(dialog).getByText('add column _pages.slug').closest('li') as HTMLElement;
		expect(within(add).queryByText('Destroys data')).toBeNull();
		expect(within(dialog).getByRole('button', { name: /apply/i }).getAttribute('type')).toBe('submit');
		expect(forms.submits).toHaveLength(1);
	});

	// The write is a form action, and the post carries the page to come back to
	// and the queue the dialog listed, which the action checks before applying.
	it('applies through the form action rather than a fetch', async () => {
		render(DbStatus, { props: { pending: 3, items: queue, redirectTo: '/admin/media?limit=25' } });
		await fireEvent.click(screen.getByTestId('db-status'));

		const form = document.querySelector('form');
		expect(form?.getAttribute('method')).toBe('POST');
		expect(form?.getAttribute('action')).toBe('/admin?/applyMigrations');

		const back = form?.querySelector('input[name="redirectTo"]') as HTMLInputElement;
		expect(back.value).toBe('/admin/media?limit=25');
		const expected = form?.querySelector('input[name="expected"]') as HTMLInputElement;
		expect(JSON.parse(expected.value)).toEqual(queue.map((item) => item.description));
	});

	// A queue that moved since the list was read is refused, and the list is read again.
	it('reads the queue again when the action says it changed', async () => {
		render(DbStatus, { props: { pending: 1, items: queue.slice(0, 1), redirectTo: '/admin' } });
		await fireEvent.click(screen.getByTestId('db-status'));

		await submit({ type: 'failure', status: 409, location: '/admin', data: { error: 'The queue changed since it was listed. Review it again.' } });

		await waitFor(() => expect(screen.getByText('The queue changed since it was listed. Review it again.')).toBeTruthy());
		expect(nav.invalidate).toHaveBeenCalledWith('app:migrations');
	});

	it('names the failure rather than falling silent', async () => {
		render(DbStatus, { props: { pending: 1, redirectTo: '/admin' } });
		await fireEvent.click(screen.getByTestId('db-status'));

		await submit({ type: 'failure', status: 400, location: '/admin', data: { error: 'migration 059 failed' } });

		await waitFor(() => expect(screen.getByText('migration 059 failed')).toBeTruthy());
		expect(nav.refreshAll).not.toHaveBeenCalled();
	});

	it('falls back to a message of its own when the action names none', async () => {
		render(DbStatus, { props: { pending: 1, redirectTo: '/admin' } });
		await fireEvent.click(screen.getByTestId('db-status'));

		await submit({ type: 'failure', status: 400, location: '/admin', data: {} });

		await waitFor(() => expect(screen.getByText('Could not apply the migrations. Try again.')).toBeTruthy());
	});

	it('reports a request that never arrived', async () => {
		render(DbStatus, { props: { pending: 1, redirectTo: '/admin' } });
		await fireEvent.click(screen.getByTestId('db-status'));

		await submit({ type: 'error', error: { status: 500, message: 'offline' } });

		await waitFor(() => expect(screen.getByText('Could not apply the migrations. Check your connection and try again.')).toBeTruthy());
	});

	/*
	 * Orca speaks none of a region marked as a status, and no screen reader
	 * announces a region that arrives holding its text, so the failure lands
	 * in a region that was on the page and empty before the apply.
	 */
	it('announces a failed sync from a live region mounted empty', async () => {
		render(DbStatus, { props: { pending: 1, redirectTo: '/admin' } });
		const live = screen.getByTestId('db-status-live');
		expect(live.tagName).toBe('DIV');
		expect(live.getAttribute('aria-live')).toBe('polite');
		expect(live.getAttribute('aria-atomic')).toBe('true');
		expect(live.hasAttribute('role')).toBe(false);
		expect(live.textContent).toBe('');

		await fireEvent.click(screen.getByTestId('db-status'));
		await submit({ type: 'failure', status: 400, location: '/admin', data: { error: 'migration 059 failed' } });

		await waitFor(() => expect(live.textContent).toBe('migration 059 failed'));
		expect(screen.getByTestId('db-status-live')).toBe(live);
		// The region is the message a sighted reader sees, so nothing hides it
		// from a screen reader and nothing repeats it.
		expect(live.hasAttribute('aria-hidden')).toBe(false);
		expect(live.className).toContain('empty:sr-only');
		expect(screen.getAllByText('migration 059 failed')).toHaveLength(1);
		expect(document.querySelector('[role="status"]')).toBeNull();
	});

	// Focus returns to the chip when the dialog's exit ends, and Orca in Chrome
	// can drop a sentence that arrives during the exit in favor of that move.
	it('says the failure only once the closing dialog has left', async () => {
		render(DbStatus, { props: { pending: 1, redirectTo: '/admin' } });
		const live = screen.getByTestId('db-status-live');
		await fireEvent.click(screen.getByTestId('db-status'));
		// jsdom plays no exit, so a leaving dialog is stood in by hand.
		const leaving = document.createElement('div');
		leaving.setAttribute('aria-modal', 'true');
		leaving.setAttribute('inert', '');
		document.body.append(leaving);

		const done = submit({ type: 'failure', status: 400, location: '/admin', data: { error: 'migration 059 failed' } });
		await new Promise((r) => setTimeout(r, 10));
		expect(live.textContent).toBe('');

		leaving.remove();
		await done;
		await waitFor(() => expect(live.textContent).toBe('migration 059 failed'));
	});

	// Focus returns to the chip after the dialog leaves, and Firefox reads the
	// chip's title as its description, so a title holding the failure makes a
	// screen reader say it a second time.
	it('keeps the failure out of the chip it returns focus to', async () => {
		render(DbStatus, { props: { pending: 2, redirectTo: '/admin' } });
		await fireEvent.click(screen.getByTestId('db-status'));
		await submit({ type: 'failure', status: 409, location: '/admin', data: { error: 'The queue changed since it was listed. Review it again.' } });

		await waitFor(() => expect(screen.getByTestId('db-status-live').textContent).toBe('The queue changed since it was listed. Review it again.'));
		expect(screen.getByTestId('db-status').getAttribute('title')).toBe('2 migrations waiting to be applied');
	});

	// The action redirects so that a submission without JavaScript lands
	// somewhere. Here the count is refreshed in place instead.
	it('refreshes the shell rather than following the redirect', async () => {
		render(DbStatus, { props: { pending: 2, redirectTo: '/admin/schema' } });
		await fireEvent.click(screen.getByTestId('db-status'));

		await submit({ type: 'redirect', status: 303, location: '/admin/schema' });

		expect(nav.refreshAll).toHaveBeenCalledTimes(1);
		expect(screen.queryByText('Could not apply the migrations. Check your connection and try again.')).toBeNull();
	});
});

/*
 * Below sm the words were hidden from everyone, so a reader on a phone had a
 * colored dot and a tooltip a finger cannot open. The words stay for a screen
 * reader and an icon of its own shape stands for each state.
 */
describe('DbStatus on a narrow screen', () => {
	it.each([
		[null, 'Database unknown'],
		[0, 'Database synced'],
	])('keeps the words for a screen reader when pending is %s', (pending, words) => {
		render(DbStatus, { props: { pending, redirectTo: '/admin' } });
		const label = screen.getByText(words);
		expect(label.className).toContain('sr-only');
		expect(label.className).not.toContain('hidden');
		expect(screen.getByTestId('db-status').querySelector('svg')).not.toBeNull();
	});

	it('draws a different icon for each state', () => {
		const { container: unknown } = render(DbStatus, { props: { pending: null, redirectTo: '/admin' } });
		const { container: synced } = render(DbStatus, { props: { pending: 0, redirectTo: '/admin' } });
		const shape = (c: HTMLElement) => c.querySelector('[data-testid="db-status"] svg')?.getAttribute('class') ?? '';
		expect(shape(unknown)).not.toBe(shape(synced));
	});
});
