import { globSync, readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SubmitFunction } from '$app/forms';

const kit = vi.hoisted(() => ({ submit: undefined as SubmitFunction | undefined }));
vi.mock('$app/forms', () => ({
	enhance: (_form: HTMLFormElement, submit: SubmitFunction) => {
		kit.submit = submit;
		return { destroy() {} };
	},
}));

const { enhance } = await import('./enhance');

/** Runs one post through the wrapper the way SvelteKit does, and returns what update() received. */
async function post(submit?: SubmitFunction): Promise<unknown[]> {
	enhance({} as HTMLFormElement, submit);
	const input = { cancel: vi.fn() } as unknown as Parameters<SubmitFunction>[0];
	const after = await kit.submit!(input);
	const update = vi.fn(async () => {});
	const result = { type: 'success', status: 200, location: '/admin/webhooks' } as const;
	await (after as (opts: unknown) => Promise<void>)({ result, update });
	return update.mock.calls.map((call: unknown[]) => call[0]);
}

describe('enhance', () => {
	beforeEach(() => {
		kit.submit = undefined;
	});

	it('keeps a bare form on its page', async () => {
		expect(await post()).toEqual([{ navigate: false }]);
	});

	it('keeps a handler that calls update on its page, with the options it names', async () => {
		expect(await post(() => async ({ update }) => update({ reset: false }))).toEqual([{ navigate: false, reset: false }]);
	});

	it('keeps the choice of a handler that names navigate', async () => {
		expect(await post(() => async ({ update }) => update({ navigate: true }))).toEqual([{ navigate: true }]);
	});

	it('applies the result in place when the handler returns no callback', async () => {
		expect(await post(() => {})).toEqual([{ navigate: false }]);
	});

	/*
	 * SvelteKit's own enhance moves the reader to the action's address after a
	 * post, which drops the query a page keeps its drawer, filters and offset
	 * in. A component that takes it straight from $app/forms gets that.
	 */
	it('is the only enhance a component takes', () => {
		const direct = globSync('src/**/*.{svelte,ts}')
			.filter((f) => !f.endsWith('.test.ts') && f !== 'src/lib/enhance.ts')
			.filter((f) => /import\s*\{[^}]*\benhance\b[^}]*\}\s*from\s*'\$app\/forms'/.test(readFileSync(f, 'utf8')))
			.sort();
		expect(direct).toEqual([]);
	});
});
