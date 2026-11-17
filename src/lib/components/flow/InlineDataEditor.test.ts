// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import InlineDataEditor from './InlineDataEditor.svelte';
import GridEditor from './GridEditor.svelte';
import { fixtureCatalog } from '#lib/flow/fixtures.ts';

afterEach(cleanup);

const inline = fixtureCatalog.find((s) => s.type === 'data.inline')!;

function setup(value: Record<string, unknown>) {
	const onchange = vi.fn();
	const result = render(InlineDataEditor, { props: { schema: inline.config_schema, value, onchange } });
	return { ...result, onchange };
}

describe('InlineDataEditor', () => {
	it('switches the editor with the format and counts the rows', async () => {
		const { getByTestId, getByRole, onchange } = setup({ format: 'json', content: '[{"a":1},{"a":2}]' });
		expect(getByTestId('code-editor').getAttribute('data-language')).toBe('json');
		expect(getByTestId('inline-preview').textContent).toContain('2 rows');
		// Five formats are chips that wrap, each a pressed or unpressed button.
		expect(getByRole('button', { name: 'JSON' }).getAttribute('aria-pressed')).toBe('true');
		await fireEvent.click(getByRole('button', { name: 'CSV' }));
		expect(onchange).toHaveBeenLastCalledWith({ format: 'csv', content: '[{"a":1},{"a":2}]' });
	});

	it('keeps a strip of segments when the schema narrows the formats to a few', () => {
		const narrow = { ...inline.config_schema, properties: { ...inline.config_schema.properties, format: { type: 'string', enum: ['json', 'csv'] } } };
		const { getByRole } = render(InlineDataEditor, { props: { schema: narrow, value: { format: 'json' }, onchange: vi.fn() } });
		expect(getByRole('radio', { name: 'CSV' })).toBeTruthy();
	});

	it('offers the header toggle for csv only and stores header false', async () => {
		const { getByLabelText, onchange } = setup({ format: 'csv', content: 'id\n1\n2' });
		await fireEvent.click(getByLabelText('First line is the header'));
		expect(onchange).toHaveBeenLastCalledWith({ format: 'csv', content: 'id\n1\n2', header: false });
	});

	it('says a template cannot be counted', () => {
		const { getByTestId } = setup({ format: 'json', content: '{{ trigger.body }}' });
		expect(getByTestId('inline-preview').textContent).toContain('cannot be counted');
	});

	it('renders the grid for a table and writes columns and rows', async () => {
		const { getByTestId, getByRole, onchange } = setup({ format: 'table', columns: ['id'], rows: [['1']] });
		expect(getByTestId('grid-editor')).toBeTruthy();
		await fireEvent.click(getByRole('button', { name: 'Add column' }));
		expect(onchange).toHaveBeenLastCalledWith({ format: 'table', columns: ['id', 'column_2'], rows: [['1', '']] });
	});

	it('writes the content through the code editor', async () => {
		const { container, onchange } = setup({ format: 'yaml' });
		await fireEvent.input(container.querySelector('textarea') as HTMLTextAreaElement, { target: { value: '- a: 1' } });
		expect(onchange).toHaveBeenLastCalledWith({ format: 'yaml', content: '- a: 1' });
	});
});

describe('GridEditor', () => {
	function grid(columns: string[], rows: string[][]) {
		const onchange = vi.fn();
		const result = render(GridEditor, { props: { columns, rows, onchange } });
		return { ...result, onchange };
	}

	it('renames a column, edits a cell and shows the preview count', async () => {
		const { getByLabelText, getByTestId, onchange } = grid(['id', 'name'], [['1', 'a']]);
		expect(getByTestId('grid-preview').textContent).toContain('1 row, 2 columns');
		await fireEvent.input(getByLabelText('Column 2 name'), { target: { value: 'title' } });
		expect(onchange).toHaveBeenLastCalledWith({ columns: ['id', 'title'], rows: [['1', 'a']] });
		await fireEvent.input(getByLabelText('Row 1 name'), { target: { value: 'b' } });
		expect(onchange).toHaveBeenLastCalledWith({ columns: ['id', 'name'], rows: [['1', 'b']] });
	});

	it('adds and removes rows and columns, keeping every row the width of the header', async () => {
		const { getByRole, onchange } = grid(['id', 'name'], [['1', 'a'], ['2']]);
		await fireEvent.click(getByRole('button', { name: 'Add row' }));
		expect(onchange).toHaveBeenLastCalledWith({ columns: ['id', 'name'], rows: [['1', 'a'], ['2', ''], ['', '']] });
		await fireEvent.click(getByRole('button', { name: 'Remove column name' }));
		expect(onchange).toHaveBeenLastCalledWith({ columns: ['id'], rows: [['1'], ['2']] });
		await fireEvent.click(getByRole('button', { name: 'Remove row 2' }));
		expect(onchange).toHaveBeenLastCalledWith({ columns: ['id', 'name'], rows: [['1', 'a']] });
	});

	it('starts from nothing with a column', async () => {
		const { getByRole, getByText, onchange } = grid([], []);
		expect(getByText('No columns yet. Add one to start the table.')).toBeTruthy();
		expect((getByRole('button', { name: 'Add row' }) as HTMLButtonElement).disabled).toBe(true);
		await fireEvent.click(getByRole('button', { name: 'Add column' }));
		expect(onchange).toHaveBeenLastCalledWith({ columns: ['column_1'], rows: [] });
	});
});
