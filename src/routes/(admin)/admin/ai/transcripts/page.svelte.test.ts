// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Page from './+page.svelte';
import { fixtureSettings, fixtureTranscript } from '$lib/components/ai/test-support/fixtures';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));

afterEach(cleanup);

function setup(overrides: Record<string, unknown> = {}) {
	return render(Page, {
		props: {
			data: {
				gate: { state: 'ok' },
				transcripts: [],
				total: 0,
				limit: 50,
				offset: 0,
				hasMore: false,
				kind: '',
				subjectKind: '',
				subjectId: '',
				aiSettings: fixtureSettings,
				aiLayoutGate: { state: 'ok' },
				isSuperAdmin: false,
				...overrides,
			},
			form: null,
		} as never,
	});
}

describe('AI transcripts page', () => {
	it('lists use case, kind, caller, model, message count and time per row', () => {
		const { container } = setup({ transcripts: [fixtureTranscript], total: 1 });
		const row = container.querySelector('tbody tr') as HTMLElement;
		expect(row.textContent).toContain('Editor assistant');
		expect(row.textContent).toContain('prompt v2');
		expect(row.textContent).toContain('assistant');
		expect(row.textContent).toContain('editor');
		expect(row.textContent).toContain('gpt-4o');
		expect(row.textContent).toContain('2');
		expect(row.querySelector('a')?.getAttribute('href')).toBe(`/admin/ai/transcripts/${fixtureTranscript.id}`);
	});

	it('keeps the filters in the form and offers Clear once one is set', () => {
		const { container, getByText } = setup({ kind: 'node', subjectId: 'flow-1' });
		expect((container.querySelector('input[name="subject_id"]') as HTMLInputElement).value).toBe('flow-1');
		expect((container.querySelector('input[name="kind"]') as HTMLInputElement).value).toBe('node');
		expect(getByText('Clear').closest('a')?.getAttribute('href')).toBe('/admin/ai/transcripts');
		expect(getByText('No transcripts match')).toBeTruthy();
	});

	it('warns when transcript storage is off for the tenant', () => {
		const { getByRole } = setup({ aiSettings: { ...fixtureSettings, transcripts_enabled: false } });
		expect(getByRole('status').textContent).toContain('Transcript storage is off');
	});

	it('paints the forbidden state and no table', () => {
		const { getByText, container } = setup({ gate: { state: 'forbidden' } });
		expect(getByText('Only an admin or a super admin can open AI transcripts.')).toBeTruthy();
		expect(container.querySelector('table')).toBeNull();
	});
});
