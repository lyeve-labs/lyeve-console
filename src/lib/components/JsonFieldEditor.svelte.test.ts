// @vitest-environment jsdom
import { cleanup, fireEvent, render, within } from '@testing-library/svelte';
import { beforeEach, describe, expect, it } from 'vitest';
import JsonFieldEditor, { cellValue, pairsOf, parseError, textOf } from './JsonFieldEditor.svelte';

describe('pairsOf', () => {
	it('reads a flat object as pairs', () => {
		expect(pairsOf('{"a":"x","n":3,"b":true,"z":null}')).toEqual([
			{ key: 'a', value: 'x' },
			{ key: 'n', value: '3' },
			{ key: 'b', value: 'true' },
			{ key: 'z', value: 'null' },
		]);
	});

	it('refuses what pairs cannot hold without changing it', () => {
		// A nested value, an array or a scalar would come back different on save.
		expect(pairsOf('{"a":{"b":1}}')).toBeNull();
		expect(pairsOf('[1,2]')).toBeNull();
		expect(pairsOf('"text"')).toBeNull();
		expect(pairsOf('{not json')).toBeNull();
	});

	it('reads empty text as no pairs', () => {
		expect(pairsOf('  ')).toEqual([]);
	});
});

describe('cellValue and textOf', () => {
	it('keeps numbers, booleans and null typed and everything else as text', () => {
		expect(cellValue('3')).toBe(3);
		expect(cellValue('-1.5e3')).toBe(-1500);
		expect(cellValue('true')).toBe(true);
		expect(cellValue('null')).toBeNull();
		expect(cellValue('03')).toBe('03');
		expect(cellValue('hello')).toBe('hello');
	});

	it('writes the pairs as a JSON object and leaves out a pair with no key', () => {
		const text = textOf([
			{ key: 'a', value: '1' },
			{ key: '', value: 'ignored' },
			{ key: 'b', value: 'two' },
		]);
		expect(JSON.parse(text)).toEqual({ a: 1, b: 'two' });
	});

	it('round-trips a flat object', () => {
		const doc = { name: 'x', count: 2, on: false };
		const pairs = pairsOf(JSON.stringify(doc));
		expect(pairs).not.toBeNull();
		expect(JSON.parse(textOf(pairs ?? []))).toEqual(doc);
	});
});

describe('parseError', () => {
	it('names the parse failure and says nothing for valid or empty text', () => {
		expect(parseError('{')).toBeTruthy();
		expect(parseError('{"a":1}')).toBeNull();
		expect(parseError('')).toBeNull();
	});
});

describe('JsonFieldEditor', () => {
	it('opens a flat object as keys and values and shows what is saved', () => {
		const { container, getByTestId } = render(JsonFieldEditor, { props: { value: '{"a":"x"}' } });
		const inputs = container.querySelectorAll('input');
		expect((inputs[0] as HTMLInputElement).value).toBe('a');
		expect((inputs[1] as HTMLInputElement).value).toBe('x');
		expect(JSON.parse(getByTestId('json-preview').textContent ?? '')).toEqual({ a: 'x' });
	});

	it('opens what is saved by default for keys and values, behind a disclosure button', () => {
		const { container } = render(JsonFieldEditor, { props: { value: '{"a":"x"}' } });
		const toggle = within(container).getByRole('button', { name: 'What is saved' });
		expect(toggle.getAttribute('aria-expanded')).toBe('true');
	});

	it('opens a nested document as JSON text', () => {
		const { container } = render(JsonFieldEditor, { props: { value: '{"a":{"b":1}}' } });
		expect(container.querySelector('textarea')).toBeTruthy();
		expect(container.textContent).toContain('so edit it as JSON');
	});

	it('reports invalid JSON while it is typed', async () => {
		const { container } = render(JsonFieldEditor, { props: { value: '[1]' } });
		const area = container.querySelector('textarea') as HTMLTextAreaElement;
		await fireEvent.input(area, { target: { value: '{"a":' } });
		expect(container.textContent).toContain('Not valid JSON');
	});

	it('keeps the rows below a removed one on the inputs they were typed into', async () => {
		const { container } = render(JsonFieldEditor, { props: { value: '{"a":"x","b":"y"}' } });
		const second = within(container).getAllByLabelText('Key')[1] as HTMLInputElement;
		await fireEvent.click(within(container).getByRole('button', { name: 'Remove a' }));
		expect(second.isConnected).toBe(true);
		expect(second.value).toBe('b');
	});
});

describe('the note on a value that stays JSON', () => {
	// Written after the choice, the note was not read with it.
	it('belongs to the edit choice, so a screen reader reads it with the control', () => {
		const { container } = render(JsonFieldEditor, { props: { value: '{"a":{"b":1}}' } });
		const group = container.querySelector('[role="radiogroup"]') as HTMLElement;
		const ids = (group.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
		const described = ids.map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
		expect(described).toContain('so edit it as JSON');
	});
});

describe('a refusal that names a key', () => {
	// A label finds its input by id across the whole document, so an editor
	// left from an earlier test under the same id would answer instead.
	beforeEach(cleanup);

	const props = {
		id: 'field-data',
		value: '{"name":"Ada","email":"[redacted-email]"}',
		error: 'The key email holds a masked value.',
		errorKey: 'email',
	};

	it('marks the value of that key and points it at the message', () => {
		const { getAllByLabelText } = within(render(JsonFieldEditor, { props }).container);
		const values = getAllByLabelText('Value');

		expect(values[1].getAttribute('aria-invalid')).toBe('true');
		const ids = (values[1].getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
		const described = ids.map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
		expect(described).toContain('The key email holds a masked value.');
		expect(values[0].getAttribute('aria-invalid')).toBeNull();
		expect(getAllByLabelText('Key').every((k) => k.getAttribute('aria-invalid') === null)).toBe(true);
	});

	it('shows the message once, under the row it marks', () => {
		const { container } = render(JsonFieldEditor, { props });
		expect(container.textContent?.split('The key email holds a masked value.').length).toBe(2);
	});

	it('marks the editor and points at the message when no row holds the key', () => {
		const { getAllByLabelText } = within(render(JsonFieldEditor, { props: { ...props, errorKey: 'phone' } }).container);
		const first = getAllByLabelText('Key')[0];
		expect(first.getAttribute('aria-invalid')).toBe('true');
		const ids = (first.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
		expect(ids.map((id) => document.getElementById(id)?.textContent ?? '').join(' ')).toContain('masked value');
	});
});
