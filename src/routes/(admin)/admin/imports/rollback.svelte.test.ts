// @vitest-environment jsdom
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SubmitFunction } from '$app/forms';

const forms = vi.hoisted(() => ({ submits: [] as { action: string | null; fn: SubmitFunction }[] }));
vi.mock('$app/forms', () => ({
	enhance: (el: HTMLFormElement, fn?: SubmitFunction) => {
		if (fn) forms.submits.push({ action: el.getAttribute('action'), fn });
		return { destroy() {} };
	},
}));
vi.mock('$app/navigation', () => ({ invalidate: vi.fn(async () => {}), goto: vi.fn(async () => {}) }));
vi.mock('$app/state', () => ({ page: { url: new URL('http://localhost/admin/imports') } }));

const kit = vi.hoisted(() => ({ confirm: vi.fn(async () => false) }));
vi.mock('@lyeve-labs/ui-kit', async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	confirm: kit.confirm,
}));

import ImportsPage from './+page.svelte';
import type { ImportJob } from '#lib/api/bulk-import.ts';

afterEach(() => {
	cleanup();
	forms.submits.length = 0;
	kit.confirm.mockClear();
});

function job(inserted: number): ImportJob {
	return {
		id: 'j1',
		content_type: 'article',
		source_format: 'csv',
		source_name: 'articles.csv',
		source_kind: 'upload',
		mode: 'create',
		total_rows: inserted,
		processed_rows: inserted,
		errored_rows: 0,
		inserted_rows: inserted,
		updated_rows: 0,
		skipped_rows: 0,
		status: 'completed',
		dry_run: false,
		created_at: '2026-09-26T10:00:00Z',
	};
}

/** The sentence the rollback confirmation states for a job that created this many entries. */
async function rollbackDetail(inserted: number): Promise<string> {
	render(ImportsPage, {
		props: {
			data: {
				jobs: [job(inserted)],
				total: 1,
				limit: 25,
				offset: 0,
				hasMore: false,
				gate: { state: 'ok' },
				installed: true,
				schemas: { ok: true, value: [] },
				user: { id: 'u1', roles: ['super_admin'] },
				detail: null,
			} as never,
			form: null as never,
		},
	});
	const submit = forms.submits.find((s) => s.action === '?/rollback');
	if (!submit) throw new Error('no rollback form');
	await submit.fn({ cancel: () => {} } as never);
	return (kit.confirm.mock.calls[0] as unknown as [string, string])[1];
}

describe('the rollback confirmation', () => {
	it('names one created entry in the singular', async () => {
		expect(await rollbackDetail(1)).toMatch(/^The 1 entry it created is deleted, with any edits made to it since\. /);
	});

	it('names any other count in the plural', async () => {
		expect(await rollbackDetail(1200)).toMatch(/^The 1,200 entries it created are deleted, with any edits made to them since\. /);
	});
});
