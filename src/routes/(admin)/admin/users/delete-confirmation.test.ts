// @vitest-environment jsdom
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SubmitFunction } from '@sveltejs/kit';

vi.mock('$app/navigation', () => ({
	goto: vi.fn(async () => {}),
	invalidateAll: vi.fn(async () => {}),
}));

/*
 * The submit function is the unit under test. enhance awaits it before it sends
 * anything, so canceling inside it is what stops the request. Capturing it
 * here drives that directly rather than through the DOM's submit plumbing.
 */
const forms = vi.hoisted(() => ({ submits: [] as SubmitFunction[] }));
vi.mock('$app/forms', () => ({
	enhance: (_el: HTMLFormElement, fn?: SubmitFunction) => {
		if (fn) forms.submits.push(fn);
		return { destroy: () => {} };
	},
}));

const kit = vi.hoisted(() => ({
	confirm: vi.fn(async () => false),
	success: vi.fn(),
}));
vi.mock('@lyeve-labs/ui-kit', async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>();
	return {
		...actual,
		confirm: kit.confirm,
		toast: { ...(actual.toast as object), success: kit.success },
	};
});

import UsersPage from './+page.svelte';

beforeEach(() => {
	forms.submits = [];
	kit.confirm.mockReset();
	kit.confirm.mockResolvedValue(false);
	kit.success.mockReset();
});

afterEach(cleanup);

function accounts(count: number) {
	return Array.from({ length: count }, (_, i) => ({
		id: `u${i}`,
		email: `user${i}@b.co`,
		roles: ['editor'],
		tenant_id: 't1',
		disabled: false,
		created_at: '2026-01-01T00:00:00Z',
	}));
}

const props = () => ({
	data: {
		users: { ok: true, value: accounts(2) },
		limit: 25,
		offset: 0,
		hasMore: false,
		tenants: { ok: true, value: [] },
	} as never,
	form: null as never,
});

/*
 * A delete asks first, through the kit's confirm. It renders through the
 * DialogContainer the admin layout already mounts and defaults focus to
 * Cancel.
 */
describe('Users delete confirmation', () => {
	function deleteSubmit(): SubmitFunction {
		render(UsersPage, { props: props() });
		// The role editor's form is first in the row. The delete forms follow.
		const submit = forms.submits.at(-1);
		expect(submit).toBeTruthy();
		return submit as SubmitFunction;
	}

	it('asks before deleting', async () => {
		const submit = deleteSubmit();
		const cancel = vi.fn();

		await submit({ cancel, formData: new FormData() } as never);

		expect(kit.confirm).toHaveBeenCalledTimes(1);
	});

	it('names the account and says what the delete takes with it', async () => {
		const submit = deleteSubmit();

		await submit({ cancel: vi.fn(), formData: new FormData() } as never);

		const [title, message] = kit.confirm.mock.calls[0] as unknown as [string, string];
		expect(title).toContain('user1@b.co');
		// "This cannot be undone" is true of every delete here, so it tells the
		// reader nothing about the one in front of them.
		expect(message).toBe('Their sessions end immediately and their audit trail is kept. This cannot be undone.');
	});

	it('never sends the request when the question is declined', async () => {
		const submit = deleteSubmit();
		const cancel = vi.fn();

		const result = await submit({ cancel, formData: new FormData() } as never);

		expect(cancel).toHaveBeenCalledTimes(1);
		expect(result).toBeUndefined();
	});

	it('sends the request once the question is answered', async () => {
		kit.confirm.mockResolvedValue(true);
		const submit = deleteSubmit();
		const cancel = vi.fn();

		const result = await submit({ cancel, formData: new FormData() } as never);

		expect(cancel).not.toHaveBeenCalled();
		expect(typeof result).toBe('function');
	});

	it('confirms the delete, so silent success and silent failure differ', async () => {
		kit.confirm.mockResolvedValue(true);
		const submit = deleteSubmit();

		const after = (await submit({ cancel: vi.fn(), formData: new FormData() } as never)) as (arg: unknown) => Promise<void>;
		await after({ result: { type: 'success' }, update: async () => {} });

		expect(kit.success).toHaveBeenCalledWith('user1@b.co deleted.');
	});

	it('stays silent when the action failed', async () => {
		kit.confirm.mockResolvedValue(true);
		const submit = deleteSubmit();

		const after = (await submit({ cancel: vi.fn(), formData: new FormData() } as never)) as (arg: unknown) => Promise<void>;
		await after({ result: { type: 'failure' }, update: async () => {} });

		expect(kit.success).not.toHaveBeenCalled();
	});
});
