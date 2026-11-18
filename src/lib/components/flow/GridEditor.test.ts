// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

import GridEditor from './GridEditor.svelte';
import { watchTransitions } from '#lib/transitions.test-support.ts';

afterEach(cleanup);

function setup(columns: string[], rows: string[][]) {
	const onchange = vi.fn();
	const result = render(GridEditor, { props: { columns, rows, onchange } });
	return { ...result, onchange };
}

describe('GridEditor', () => {
	it('starts a table with a first column and offers no row before it', async () => {
		const { onchange } = setup([], []);
		expect(screen.getByText('No columns yet. Add one to start the table.')).toBeTruthy();
		expect((screen.getByRole('button', { name: /Add row/ }) as HTMLButtonElement).disabled).toBe(true);
		await fireEvent.click(screen.getByRole('button', { name: /Add column/ }));
		expect(onchange).toHaveBeenCalledWith({ columns: ['column_1'], rows: [] });
	});

	it('adds a blank row as wide as the table', async () => {
		const { onchange } = setup(['sku', 'qty'], [['a1', '2']]);
		await fireEvent.click(screen.getByRole('button', { name: /Add row/ }));
		expect(onchange).toHaveBeenCalledWith({ columns: ['sku', 'qty'], rows: [['a1', '2'], ['', '']] });
	});

	it('writes a typed cell and a renamed column', async () => {
		const { onchange } = setup(['sku', 'qty'], [['a1', '2']]);
		await fireEvent.input(screen.getByLabelText('Row 1 qty'), { target: { value: '5' } });
		expect(onchange).toHaveBeenLastCalledWith({ columns: ['sku', 'qty'], rows: [['a1', '5']] });
		await fireEvent.input(screen.getByLabelText('Column 2 name'), { target: { value: 'count' } });
		expect(onchange).toHaveBeenLastCalledWith({ columns: ['sku', 'count'], rows: [['a1', '2']] });
	});

	it('keeps each column and row with its cells when one before it is removed, and plays the removed one out', async () => {
		const onchange = vi.fn();
		const { rerender } = render(GridEditor, { props: { columns: ['sku', 'qty'], rows: [['a1', '2'], ['b2', '7']], onchange } });
		const qty = screen.getByLabelText('Column 2 name');
		const sku = screen.getByLabelText('Column 1 name').closest('th')!;
		const watch = watchTransitions();
		try {
			await fireEvent.click(screen.getByRole('button', { name: 'Remove column sku' }));
			await rerender(onchange.mock.lastCall![0]);
			expect(watch.left).toContain(sku);
			expect(screen.getByLabelText('Column 1 name')).toBe(qty);

			const second = screen.getByLabelText('Row 2 qty');
			const firstRow = screen.getByLabelText('Row 1 qty').closest('tr')!;
			await fireEvent.click(screen.getByRole('button', { name: 'Remove row 1' }));
			await rerender(onchange.mock.lastCall![0]);
			expect(watch.left).toContain(firstRow);
			// A leaving row pinned out of flow turns into a block and its cells bunch to one side.
			expect(firstRow.style.position).toBe('');
			expect(screen.getByLabelText('Row 1 qty')).toBe(second);
		} finally {
			watch.stop();
		}
	});

	it('removes a column with its cells, and a row', async () => {
		const { onchange } = setup(['sku', 'qty'], [['a1', '2'], ['b2', '7']]);
		await fireEvent.click(screen.getByRole('button', { name: 'Remove column sku' }));
		expect(onchange).toHaveBeenLastCalledWith({ columns: ['qty'], rows: [['2'], ['7']] });
		await fireEvent.click(screen.getByRole('button', { name: 'Remove row 1' }));
		expect(onchange).toHaveBeenLastCalledWith({ columns: ['sku', 'qty'], rows: [['b2', '7']] });
	});

	it('pads a short row to the column count, so the node never stores a ragged table', async () => {
		const { onchange } = setup(['sku', 'qty', 'note'], [['a1']]);
		await fireEvent.input(screen.getByLabelText('Row 1 sku'), { target: { value: 'a2' } });
		expect(onchange).toHaveBeenLastCalledWith({ columns: ['sku', 'qty', 'note'], rows: [['a2', '', '']] });
	});

	it('previews how many rows and columns the node hands on', () => {
		setup(['sku'], [['a1'], ['b2']]);
		expect(screen.getByText('Preview: 2 rows, 1 column')).toBeTruthy();
	});
});
