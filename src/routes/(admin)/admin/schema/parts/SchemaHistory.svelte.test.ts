// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DdlHistory } from './ddl-history.svelte';
import SchemaHistory from './SchemaHistory.svelte';

let teardown: (() => void) | undefined;
afterEach(() => {
	cleanup();
	teardown?.();
});

function setup(fill: (ddl: DdlHistory) => void = () => {}) {
	let ddl!: DdlHistory;
	teardown = $effect.root(() => {
		ddl = new DdlHistory({ table: () => 'posts', isSuperAdmin: () => true, rowCounts: () => ({}) });
	});
	const submit = vi.fn();
	ddl.form = { requestSubmit: submit } as unknown as HTMLFormElement;
	fill(ddl);
	render(SchemaHistory, { props: { ddl } });
	flushSync();
	return { ddl, submit };
}

describe('SchemaHistory', () => {
	it('draws placeholders while the read is on its way', () => {
		setup((d) => {
			d.open = true;
			d.loading = true;
		});
		expect(screen.getByTestId('schema-history-loading').getAttribute('aria-busy')).toBe('true');
	});

	it('names each entry state in words and counts the queued ones', () => {
		setup((d) => {
			d.open = true;
			d.view = {
				name: 'posts',
				pending: 1,
				limit: 2,
				entries: [
					{ version: 3, state: 'pending', description: 'drop column x', up_sql: 'DROP x', created_at: '2026-01-01T00:00:00Z' },
					{ version: 2, state: 'applied', description: 'add column y', up_sql: 'ADD y', down_sql: 'DROP y', created_at: '2026-01-01T00:00:00Z' },
				],
			} as DdlHistory['view'];
		});
		const section = screen.getByTestId('schema-history');
		expect(section.textContent).toContain('Queued');
		expect(section.textContent).toContain('Applied');
		expect(section.textContent).toContain('1 queued change');
		expect(section.textContent).toContain('Showing the newest 2 statements.');
		expect(screen.getByRole('button', { name: 'Apply' })).toBeTruthy();
	});

	it('says an empty history is empty', () => {
		setup((d) => {
			d.open = true;
			d.view = { name: 'posts', pending: 0, limit: 200, entries: [] };
		});
		expect(screen.getByText('No history for this table yet.')).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull();
	});

	it('offers the read again after it failed, and shows a failed apply apart', async () => {
		const { submit } = setup((d) => {
			d.open = true;
			d.error = 'The engine did not answer.';
			d.applyError = 'The queued changes could not be applied.';
		});
		expect(screen.getByText('The queued changes could not be applied.')).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
		expect(submit).toHaveBeenCalledTimes(1);
	});
});
