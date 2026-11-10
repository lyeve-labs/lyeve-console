// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CodeEditor from './CodeEditor.svelte';
import { fixtureIntrospection } from '$lib/flow/fixtures';

afterEach(cleanup);

function setup(value = 'select 1', extra: Record<string, unknown> = {}) {
	const oninput = vi.fn();
	const result = render(CodeEditor, { props: { id: 'sql', label: 'SQL', value, language: 'sql', oninput, ...extra } });
	const textarea = result.container.querySelector('textarea') as HTMLTextAreaElement;
	return { ...result, oninput, textarea };
}

describe('CodeEditor', () => {
	it('draws a line number per line, at least six, and names the language', () => {
		const { getByTestId } = setup('a\nb\nc');
		const gutter = getByTestId('code-gutter');
		expect([...gutter.querySelectorAll('div')].filter((d) => d.children.length === 0).map((d) => d.textContent)).toEqual(['1', '2', '3', '4', '5', '6']);
		expect(getByTestId('code-editor').textContent).toContain('sql');
	});

	it('draws the gutter with the field border at rest, under the pointer and on focus', () => {
		const classes = setup().getByTestId('code-gutter').className.split(/\s+/);
		expect(classes).toContain('border-line');
		expect(classes).toContain('group-has-[textarea:hover:not(:focus)]:border-line-strong');
		expect(classes).toContain('group-has-[textarea:focus]:border-focus');
		expect(classes).not.toContain('border-line-strong');
	});

	it('draws the gutter in the error color beside a field in error', () => {
		const classes = setup('select 1', { error: 'Enter a query.' }).getByTestId('code-gutter').className.split(/\s+/);
		expect(classes).toContain('border-danger');
		expect(classes).not.toContain('border-line');
	});

	it('grows the gutter with the content', () => {
		const { getByTestId } = setup(Array.from({ length: 9 }, (_, i) => `line ${i}`).join('\n'));
		expect(getByTestId('code-gutter').textContent).toContain('9');
	});

	it('inserts two spaces on Tab instead of leaving the field', async () => {
		const { textarea, oninput } = setup('ab');
		textarea.setSelectionRange(1, 1);
		await fireEvent.keyDown(textarea, { key: 'Tab' });
		expect(textarea.value).toBe('a  b');
		expect(textarea.selectionStart).toBe(3);
		expect(oninput).toHaveBeenLastCalledWith('a  b');
	});

	it('read-only shows the text, keeps Tab as focus movement and reveals a line by its text', async () => {
		const { textarea, oninput, component } = setup('name: x\nnodes:\n  - id: join\n    type: data.join\n', { readonly: true, language: 'yaml' });
		expect(textarea.readOnly).toBe(true);
		textarea.setSelectionRange(0, 0);
		await fireEvent.keyDown(textarea, { key: 'Tab' });
		expect(oninput).not.toHaveBeenCalled();
		expect(textarea.value.startsWith('name')).toBe(true);
		(component as unknown as { reveal: (s: string) => void }).reveal('id: join');
		expect(textarea.value.slice(textarea.selectionStart, textarea.selectionEnd)).toBe('  - id: join');
	});

	it('inserts a table name at the cursor from the tables panel', async () => {
		const { textarea, oninput, getByRole } = setup('select * from ', {
			tables: { status: 'ready', tables: fixtureIntrospection.tables },
		});
		textarea.setSelectionRange(14, 14);
		await fireEvent.click(getByRole('button', { name: /^public\.orders/ }));
		await fireEvent.click(getByRole('button', { name: 'Insert public.orders' }));
		expect(oninput).toHaveBeenLastCalledWith('select * from public.orders');
		textarea.setSelectionRange(textarea.value.length, textarea.value.length);
		await fireEvent.click(getByRole('button', { name: 'Insert total' }));
		expect(oninput).toHaveBeenLastCalledWith('select * from public.orderstotal');
	});

	it('shows the panel states and a retry', async () => {
		const onretry = vi.fn();
		const { getByTestId, getByRole, rerender } = setup('', { tables: { status: 'loading', tables: [] } });
		expect(getByTestId('tables-panel').textContent).toContain('Loading tables');
		await rerender({ id: 'sql', label: 'SQL', value: '', language: 'sql', oninput: vi.fn(), onretry, tables: { status: 'error', tables: [], message: 'refused' } });
		expect(getByTestId('tables-panel').textContent).toContain('refused');
		await fireEvent.click(getByRole('button', { name: 'Retry' }));
		expect(onretry).toHaveBeenCalled();
	});

	it('filters a long table list and caps what it paints', async () => {
		const tables = Array.from({ length: 150 }, (_, i) => ({ name: `public.t${i}`, columns: [] }));
		const { getByTestId, getByLabelText } = setup('', { tables: { status: 'ready', tables } });
		expect(getByTestId('tables-panel').textContent).toContain('50 more');
		await fireEvent.input(getByLabelText('Filter tables'), { target: { value: 't14' } });
		const panel = getByTestId('tables-panel');
		expect(panel.textContent).toContain('public.t14');
		expect(panel.textContent).not.toContain('public.t2');
	});

	it('shows no panel for a language other than sql', () => {
		const { queryByTestId } = setup('{}', { language: 'json', tables: { status: 'ready', tables: [] } });
		expect(queryByTestId('tables-panel')).toBeNull();
	});
});
