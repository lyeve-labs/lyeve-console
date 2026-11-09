// @vitest-environment jsdom
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SubmitFunction } from '@sveltejs/kit';

vi.mock('$app/navigation', () => ({ goto: vi.fn(async () => {}) }));

const forms = vi.hoisted(() => ({ submits: [] as SubmitFunction[] }));
vi.mock('$app/forms', () => ({
	enhance: (_el: HTMLFormElement, fn?: SubmitFunction) => {
		if (fn) forms.submits.push(fn);
		return { destroy: () => {} };
	},
}));

const kit = vi.hoisted(() => ({ confirm: vi.fn(async () => false), success: vi.fn() }));
vi.mock('@lyeve-labs/ui-kit', async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>();
	return {
		...actual,
		confirm: kit.confirm,
		toast: { ...(actual.toast as object), success: kit.success },
	};
});

import ContentListPage from './+page.svelte';
import type { PageData } from './$types';

beforeEach(() => {
	forms.submits = [];
	kit.confirm.mockReset();
	kit.confirm.mockResolvedValue(false);
	kit.success.mockReset();
});

afterEach(cleanup);

function data(overrides: Record<string, unknown> = {}): PageData {
	const { items: rows, ...rest } = overrides;
	return {
		schemas: { ok: true, value: [{ name: 'posts', display_name: 'Posts' }] },
		schemaDef: {
			name: 'posts',
			display_name: 'Posts',
			fields: [{ name: 'title', field_type: 'string', system: false }],
			with_draft_publish: false,
			with_updated_at: false,
		},
		items: {
			ok: true,
			value: rows ?? [
				{
					id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
					created_at: '2026-01-01T00:00:00Z',
					updated_at: '2026-01-02T00:00:00Z',
					data: { title: 'The launch post', _status: 'published' },
				},
			],
		},
		activeSchema: 'posts',
		status: null,
		limit: 100,
		offset: 0,
		total: 1,
		...rest,
	} as unknown as PageData;
}

/*
 * Every delete in the admin asks through one shared dialog, so the wording
 * stays the same everywhere. What this page owns is the named subject and the
 * sentence saying the delete is final.
 */
describe('Content entry delete confirmation', () => {
	function submit(overrides: Record<string, unknown> = {}): SubmitFunction {
		render(ContentListPage, { props: { data: data(overrides), form: null as never } });
		const fn = forms.submits.at(-1);
		expect(fn).toBeTruthy();
		return fn as SubmitFunction;
	}

	it('asks before deleting', async () => {
		await submit()({ cancel: vi.fn() } as never);

		expect(kit.confirm).toHaveBeenCalledTimes(1);
	});

	// Eight characters of a UUID name nothing an author would recognize, so the
	// question names the entry. The id rides on the dialog's detail line, not
	// inside the sentence, where it would wrap. The button says what it does.
	it('names the entry, says what the button does, and puts the id on the detail line', async () => {
		await submit()({ cancel: vi.fn() } as never);

		const [title, message, options] = kit.confirm.mock.calls[0] as unknown as [
			string,
			string,
			{ confirmLabel?: string; detail?: string },
		];
		expect(title).toBe('Delete The launch post?');
		expect(message).toBe('Its revisions and translations are deleted too.');
		expect(message).not.toContain('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
		expect(options.confirmLabel).toBe('Delete');
		expect(options.detail).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
	});

	it('falls back to the short id when the entry has no title', async () => {
		await submit({
			items: [
				{
					id: 'ffffffff-1111-2222-3333-444444444444',
					created_at: '2026-01-01T00:00:00Z',
					updated_at: '2026-01-02T00:00:00Z',
					data: { _status: 'published' },
				},
			],
		})({ cancel: vi.fn() } as never);

		const [title, , options] = kit.confirm.mock.calls[0] as unknown as [string, string, { detail?: string }];
		expect(title).toContain('the untitled entry');
		// With no title, the full id is the only way to find the entry again.
		expect(options.detail).toBe('ffffffff-1111-2222-3333-444444444444');
	});

	it('never sends the request when the question is declined', async () => {
		const cancel = vi.fn();

		await submit()({ cancel } as never);

		expect(cancel).toHaveBeenCalledTimes(1);
	});

	it('confirms the delete, so the row does not vanish in silence', async () => {
		kit.confirm.mockResolvedValue(true);

		const formData = new FormData();
		const after = (await submit()({ cancel: vi.fn(), formData } as never)) as (a: unknown) => Promise<void>;
		await after({ result: { type: 'success' }, update: async () => {} });

		expect(formData.get('confirmed')).toBe('yes');
		expect(kit.success).toHaveBeenCalledWith('The launch post deleted.');
	});
});
