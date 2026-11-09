// @vitest-environment jsdom
import { render, cleanup } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

/*
 * enhance hands each form's submit function over here, so a test can run the
 * one behind a delete and apply a result to it.
 */
const forms = vi.hoisted(() => ({ submits: [] as { node: HTMLFormElement; submit: unknown }[] }));
vi.mock('$app/forms', () => ({
	enhance: (node: HTMLFormElement, submit?: unknown) => {
		forms.submits.push({ node, submit });
		return { destroy() {} };
	},
}));

const kit = vi.hoisted(() => ({ confirm: vi.fn(async () => true) }));
vi.mock('@lyeve-labs/ui-kit', async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>();
	return { ...actual, confirm: kit.confirm };
});

const nav = vi.hoisted(() => ({ goto: vi.fn() }));
vi.mock('$app/navigation', () => nav);
vi.mock('$app/state', () => ({ page: { url: new URL('http://localhost/admin/webhooks?offset=50&dead=1') } }));

import DeadLetterDrawer from './DeadLetterDrawer.svelte';

afterEach(() => {
	cleanup();
	forms.submits.length = 0;
	kit.confirm.mockReset();
	kit.confirm.mockResolvedValue(true);
	nav.goto.mockReset();
});

type After = (input: { result: { type: string }; update: () => Promise<void> }) => Promise<void>;
type Submit = (input: { cancel: () => void; formData: FormData }) => Promise<After | void>;

/** The submit function enhance holds for the connected delete form. */
function deleteSubmit(): Submit {
	const del = forms.submits.find((f) => f.node.getAttribute('action') === '?/dead-letter-delete' && f.node.isConnected);
	return del?.submit as Submit;
}

const entry = (id: string, status: string) => ({
	id,
	webhook_name: 'Ship it',
	event_type: 'before_update',
	schema_name: 'post',
	total_attempts: 3,
	last_error: 'Connection refused',
	status,
	dead_at: '2026-01-02T00:00:00Z',
});

const dialog = () => document.body.querySelector('[role="dialog"]') as HTMLElement | null;

/** A page of the queue as the load read it. */
function queue(rows: ReturnType<typeof entry>[], total: number | null = null, offset = 0, limit = 50) {
	return { offset, limit, read: { ok: true as const, value: { rows, total } } };
}

const props = (deadLetters: unknown, form: unknown = null, held: unknown = null) => ({ form, deadLetters, held }) as never;

describe('the dead letter drawer', () => {
	it('stays shut while the address does not open the queue', () => {
		render(DeadLetterDrawer, { props: props(null) });
		expect(dialog()).toBeNull();
	});

	it('opens on the queue the load read and states the total when it is larger than the page', () => {
		render(DeadLetterDrawer, { props: props(queue([entry('a', 'pending'), entry('b', 'replayed')], 9, 0, 2)) });
		expect(dialog()?.textContent).toContain('Dead letter queue');
		expect(dialog()?.textContent).toContain('entries 1 to 2 of 9');
	});

	it('leaves the total out when the queue did not state one', () => {
		render(DeadLetterDrawer, { props: props(queue([entry('a', 'pending')])) });
		expect(dialog()?.textContent).not.toMatch(/ of \d/);
	});

	it('offers replay, dismiss and delete on a pending entry only, each posting its id', () => {
		render(DeadLetterDrawer, { props: props(queue([entry('a', 'pending'), entry('b', 'replayed')])) });
		for (const action of ['?/dead-letter-replay', '?/dead-letter-dismiss', '?/dead-letter-delete']) {
			const posted = [...document.body.querySelectorAll<HTMLFormElement>(`form[action="${action}"]`)];
			expect(posted, action).toHaveLength(1);
			expect(new FormData(posted[0]).get('id')).toBe('a');
		}
	});

	it('drops a deleted entry from the list once the delete succeeds', async () => {
		render(DeadLetterDrawer, { props: props(queue([entry('a', 'pending'), entry('c', 'pending')])) });
		const formData = new FormData();
		const after = (await deleteSubmit()({ cancel: vi.fn(), formData })) as After;
		expect(formData.get('confirmed')).toBe('yes');
		await after({ result: { type: 'success' }, update: async () => {} });
		flushSync();
		expect(dialog()?.querySelectorAll('tbody tr')).toHaveLength(1);
	});

	it('keeps an entry whose delete failed', async () => {
		render(DeadLetterDrawer, { props: props(queue([entry('a', 'pending')])) });
		const after = (await deleteSubmit()({ cancel: vi.fn(), formData: new FormData() })) as After;
		await after({ result: { type: 'failure' }, update: async () => {} });
		flushSync();
		expect(dialog()?.querySelectorAll('tbody tr')).toHaveLength(1);
	});

	// One click used to delete the delivery for good with no question asked.
	it('asks first, naming the webhook and when the delivery died, and sends nothing when declined', async () => {
		kit.confirm.mockResolvedValue(false);
		render(DeadLetterDrawer, { props: props(queue([entry('a', 'pending')])) });
		const cancel = vi.fn();
		const formData = new FormData();
		expect(await deleteSubmit()({ cancel, formData })).toBeUndefined();
		expect(cancel).toHaveBeenCalled();
		expect(formData.has('confirmed')).toBe(false);
		const [title, detail] = kit.confirm.mock.calls[0] as unknown as [string, string];
		expect(title).toBe('Delete the dead letter from Ship it?');
		expect(detail).toContain('2026');
	});
});

/*
 * Replay and dismiss results land in one map keyed by entry. An effect that
 * tracked the map it rewrote reran on its own write until Svelte threw.
 */
describe('the result of a replay or a dismissal', () => {
	it('settles, shows in place of the entry\'s actions, and keeps the earlier result', async () => {
		const listed = queue([entry('a', 'pending'), entry('c', 'pending')]);
		const { rerender } = render(DeadLetterDrawer, { props: props(listed) });
		await rerender(props(listed, { deadLetterReplay: { id: 'a', status: 'replayed', http_status: 200 } }));
		const rows = () => [...(dialog()?.querySelectorAll('tbody tr') ?? [])];
		expect(rows()[0].textContent).toContain('Delivered (HTTP 200)');
		expect(rows()[0].querySelector('form')).toBeNull();
		await rerender(props(listed, { deadLetterDismiss: { id: 'c', status: 'dismissed' } }));
		expect(rows()[1].textContent).toContain('Dismissed');
		expect(rows()[1].querySelector('form')).toBeNull();
		expect(rows()[0].textContent).toContain('Delivered (HTTP 200)');
	});

	// The plugin's status always reads "replayed", and the receiver's code is
	// what says whether the delivery arrived.
	it('reports the code a refusing receiver answered and keeps the entry pending', async () => {
		const listed = queue([entry('a', 'pending')]);
		const { rerender } = render(DeadLetterDrawer, { props: props(listed) });
		await rerender(props(listed, { deadLetterReplay: { id: 'a', status: 'replayed', http_status: 502 } }));
		const row = dialog()?.querySelector('tbody tr');
		expect(row?.textContent).toContain('The receiver returned HTTP 502. The entry is still pending.');
		expect(row?.querySelector('form[action="?/dead-letter-replay"]')).not.toBeNull();
	});
});

describe('the queue and its own failures', () => {
	const refused = { kind: 'feature', feature: 'example-feature', plugin: 'example', upgradeUrl: '' };

	it('shows a failed replay inside the drawer', async () => {
		const listed = queue([entry('a', 'pending')]);
		const { rerender } = render(DeadLetterDrawer, { props: props(listed) });
		await rerender(props(listed, { action: 'dead-letter-replay', id: 'a', error: 'dead letter entry is not pending' }));
		expect(dialog()?.textContent).toContain('dead letter entry is not pending');
	});

	it('ignores a failure of another action', async () => {
		const listed = queue([entry('a', 'pending')]);
		const { rerender } = render(DeadLetterDrawer, { props: props(listed) });
		await rerender(props(listed, { action: 'delete', error: 'Could not delete the webhook. Try again.' }));
		expect(dialog()?.textContent).not.toContain('Could not delete the webhook. Try again.');
	});

	it('holds replay and dismiss with the reason once the license refused one, and keeps delete', () => {
		render(DeadLetterDrawer, { props: props(queue([entry('a', 'pending')]), null, refused) });
		const button = (name: RegExp) =>
			[...(dialog()?.querySelectorAll('button') ?? [])].find((b) => name.test(b.getAttribute('aria-label') ?? '')) as HTMLButtonElement;
		expect(button(/^Replay/).disabled).toBe(true);
		expect(button(/^Dismiss/).disabled).toBe(true);
		expect(button(/^Delete/).disabled).toBe(false);
		expect(dialog()?.textContent).toContain('This is not enabled on this engine. Nothing was changed. You can still delete entries.');
	});

	it('links each page of the queue by its offset and keeps the list under it', () => {
		render(DeadLetterDrawer, { props: props(queue([entry('a', 'pending'), entry('b', 'pending')], 5, 0, 2)) });
		const hrefs = [...(dialog()?.querySelectorAll('a') ?? [])].map((a) => a.getAttribute('href'));
		expect(hrefs).toContain('/admin/webhooks?offset=50&dead=1&dead_offset=2');
	});

	// A failed read is never drawn as an empty queue.
	it('shows a failed read in the drawer rather than an empty queue', () => {
		render(DeadLetterDrawer, {
			props: props({ offset: 0, limit: 50, read: { ok: false, gate: { state: 'error', message: 'Could not load dead letters.' } } }),
		});
		expect(dialog()?.textContent).toContain('Could not load dead letters.');
		expect(dialog()?.textContent).not.toContain('No dead letters');
	});

	it('takes the queue out of the address on close', () => {
		render(DeadLetterDrawer, { props: props(queue([])) });
		[...(dialog()?.querySelectorAll('button') ?? [])].find((b) => b.textContent?.trim() === 'Close')?.click();
		expect(nav.goto).toHaveBeenCalledWith('/admin/webhooks?offset=50', { noScroll: true, keepFocus: true });
	});
});
