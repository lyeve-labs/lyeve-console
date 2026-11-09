// @vitest-environment jsdom
import { render, cleanup, fireEvent } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import FieldInput from './FieldInput.svelte';
import type { Content, FieldType, SchemaField } from '@lyeve-labs/client';

afterEach(cleanup);

const field = (field_type: FieldType, extra: Partial<SchemaField> = {}): SchemaField => ({
	name: 'f',
	field_type,
	required: false,
	unique: false,
	indexed: false,
	...extra,
});

const content = (id: string, data: Record<string, unknown>): Content => ({
	id,
	schema_name: 'posts',
	data,
	created_at: '',
	updated_at: '',
});

describe('FieldInput', () => {
	it('renders a text input for a text field', () => {
		const { getByRole } = render(FieldInput, {
			props: { field: field('text'), value: 'abc' },
		});
		const input = getByRole('textbox') as HTMLInputElement;
		expect(input.getAttribute('type')).toBe('text');
		expect(input.value).toBe('abc');
	});

	it('renders a numeric text input for an integer field that shows every digit', async () => {
		const { getByRole } = render(FieldInput, {
			props: { field: field('integer'), value: '9007199254740993' },
		});
		const input = getByRole('textbox') as HTMLInputElement;
		expect(input.getAttribute('type')).toBe('text');
		expect(input.getAttribute('inputmode')).toBe('numeric');
		expect(input.value).toBe('9007199254740993');
		await fireEvent.input(input, { target: { value: '9223372036854775807' } });
		expect(input.value).toBe('9223372036854775807');
	});

	it('renders a decimal text input that keeps the trailing zeros', () => {
		const { getByRole } = render(FieldInput, {
			props: { field: field('decimal', { precision: 10, scale: 2 }), value: '19.90' },
		});
		const input = getByRole('textbox') as HTMLInputElement;
		expect(input.getAttribute('type')).toBe('text');
		expect(input.getAttribute('inputmode')).toBe('decimal');
		expect(input.value).toBe('19.90');
		expect(input.getAttribute('placeholder')).toBe('0.00');
	});

	it('renders a number input for a number field', () => {
		const { getByRole } = render(FieldInput, {
			props: { field: field('number'), value: 7 },
		});
		expect((getByRole('spinbutton') as HTMLInputElement).getAttribute('type')).toBe('number');
	});

	// A switch inside a div that carries the field's id is not labelable, so the
	// label above it would point at nothing.
	it('renders a checkbox for a boolean field reflecting the value', () => {
		const { getByRole } = render(FieldInput, {
			props: { field: field('boolean'), value: true, id: 'field-f' },
		});
		const box = getByRole('checkbox') as HTMLInputElement;
		expect(box.checked).toBe(true);
		expect(box.id).toBe('field-f');
	});

	it('names the boolean checkbox after the field', () => {
		const { getByRole } = render(FieldInput, {
			props: { field: field('boolean'), value: false, id: 'field-f' },
		});
		expect(getByRole('checkbox', { name: 'f' })).toBeTruthy();
	});

	it('renders an email input for an email field', () => {
		const { container } = render(FieldInput, {
			props: { field: field('email'), value: '' },
		});
		expect(container.querySelector('input[type="email"]')).toBeTruthy();
	});

	it('renders a url input with an https placeholder for a url field', () => {
		const { container } = render(FieldInput, {
			props: { field: field('url'), value: '' },
		});
		const input = container.querySelector('input[type="url"]');
		expect(input).toBeTruthy();
		expect(input?.getAttribute('placeholder')).toBe('https://');
	});

	// A library file is stored by its public path, which is not a URL a url
	// input would accept, so the field is a text box with a picker beside it.
	it('renders a text input and the library picker for a media field', () => {
		const { container, getByText, getByRole } = render(FieldInput, {
			props: { field: field('media'), value: '' },
		});
		expect(container.querySelector('input[type="url"]')).toBeNull();
		expect(getByText(/Choose a published file from the library/)).toBeTruthy();
		expect(getByRole('button', { name: 'Choose from library' })).toBeTruthy();
	});

	it('hands a library read that failed to the picker, which says so', async () => {
		const { getByRole, findByText, queryByText } = render(FieldInput, {
			props: { field: field('media'), value: '', mediaChoices: null },
		});
		await fireEvent.click(getByRole('button', { name: 'Choose from library' }));
		expect(await findByText('Could not load the library')).toBeTruthy();
		expect(queryByText('No published files')).toBeNull();
	});

	// The server assigns a uid. An editable box could only be used to type a
	// value the write would refuse.
	it('renders a readonly monospace input for a uid field', () => {
		const { container, getByText } = render(FieldInput, {
			props: { field: field('uid'), value: 'ac91' },
		});
		const input = container.querySelector('input') as HTMLInputElement;
		expect(input.readOnly).toBe(true);
		expect(input.value).toBe('ac91');
		expect(getByText(/Set automatically/)).toBeTruthy();
	});

	it('renders a date picker showing the field value for a date field', () => {
		const { getByRole } = render(FieldInput, {
			props: { field: field('date'), value: '2026-03-04' },
		});
		// ui-kit 0.13 gives the DatePicker trigger role="combobox" with
		// aria-haspopup="dialog": it is a control whose popup sets its value,
		// not a plain button.
		expect(getByRole('combobox').textContent).toContain('2026');
	});

	// The value on both sides of this component stays the local wall clock the
	// form utilities convert to and from the stored UTC instant.
	it('splits a datetime across a date picker and a time picker', () => {
		const { getByRole } = render(FieldInput, {
			props: { field: field('datetime'), value: '2026-03-04T15:30' },
		});
		// ui-kit 0.13 gives the DatePicker trigger role="combobox" with
		// aria-haspopup="dialog": it is a control whose popup sets its value,
		// not a plain button.
		expect(getByRole('combobox').textContent).toContain('2026');
		expect((getByRole('spinbutton', { name: 'Hour' }) as HTMLInputElement).value).toBe('15');
		expect((getByRole('spinbutton', { name: 'Minute' }) as HTMLInputElement).value).toBe('30');
	});

	it('shows a stored datetime with seconds, dropping only the fraction from the display', () => {
		const { getByRole } = render(FieldInput, {
			props: { field: field('datetime'), value: '2026-03-04T15:30:45.120' },
		});
		expect((getByRole('spinbutton', { name: 'Hour' }) as HTMLInputElement).value).toBe('15');
		expect((getByRole('spinbutton', { name: 'Second' }) as HTMLInputElement).value).toBe('45');
	});

	// A flat object opens as key and value rows, the shape a person can edit
	// without writing a brace. The raw text is one switch away.
	it('opens a flat json value as key and value rows', () => {
		const { getAllByRole } = render(FieldInput, {
			props: { field: field('json'), value: '{"x":1}' },
		});
		const boxes = getAllByRole('textbox') as HTMLInputElement[];
		expect(boxes.map((b) => b.value)).toEqual(['x', '1']);
	});

	it('opens a nested json value as text', () => {
		const { getByRole } = render(FieldInput, {
			props: { field: field('json'), value: '{"x":{"y":1}}' },
		});
		expect((getByRole('textbox') as HTMLTextAreaElement).value).toContain('"y"');
	});

	// A native select over up to 500 related rows can only be scrolled. The
	// combobox is searchable and carries the keyboard model with it.
	it('renders a searchable combobox of related items for a belongs_to relation', async () => {
		const items = [content('id-1', { title: 'One' }), content('id-2', { name: 'Two' })];
		const { getByRole } = render(FieldInput, {
			props: {
				field: field('relation', { relation_type: 'belongs_to', relation_to: 'posts' }),
				value: '',
				relationItems: items,
			},
		});
		const box = getByRole('combobox') as HTMLInputElement;
		expect(box.getAttribute('aria-expanded')).toBe('false');

		await fireEvent.focus(box);
		expect(getByRole('option', { name: 'One' })).toBeTruthy();
		expect(getByRole('option', { name: 'Two' })).toBeTruthy();
	});

	it('filters the relation combobox as the operator types', async () => {
		const items = [content('id-1', { title: 'One' }), content('id-2', { name: 'Two' })];
		const { getByRole, queryByRole } = render(FieldInput, {
			props: {
				field: field('relation', { relation_type: 'belongs_to', relation_to: 'posts' }),
				value: '',
				relationItems: items,
			},
		});
		const box = getByRole('combobox') as HTMLInputElement;
		await fireEvent.focus(box);
		await fireEvent.input(box, { target: { value: 'Tw' } });

		expect(getByRole('option', { name: 'Two' })).toBeTruthy();
		expect(queryByRole('option', { name: 'One' })).toBeNull();
	});

	it('names a relation option with no title by its short id', async () => {
		const { getByRole } = render(FieldInput, {
			props: {
				field: field('relation', { relation_type: 'belongs_to', relation_to: 'posts' }),
				value: '',
				relationItems: [content('3f2b1c9a-7d4e-4a11-9c3d-0b1e', {})],
			},
		});
		await fireEvent.focus(getByRole('combobox'));
		expect(getByRole('option', { name: '3f2b1c9a' })).toBeTruthy();
	});

	it('falls back to a manual ID input for a belongs_to relation with no entries', () => {
		const { getByText } = render(FieldInput, {
			props: {
				field: field('relation', { relation_type: 'belongs_to', relation_to: 'posts' }),
				value: '',
				relationItems: [],
				relationTotal: 0,
			},
		});
		expect(getByText(/posts has no entries yet. Enter an ID by hand/)).toBeTruthy();
	});

	it('says a failed read failed instead of calling the related collection empty', () => {
		const { getByText, queryByText } = render(FieldInput, {
			props: {
				field: field('relation', { relation_type: 'belongs_to', relation_to: 'posts' }),
				value: '',
				relationItems: [],
				relationFailed: true,
			},
		});
		expect(getByText(/Could not load the entries in posts/)).toBeTruthy();
		expect(queryByText(/no entries/)).toBeNull();
	});

	it('says when the picker offers only part of the related collection', () => {
		const { getByText } = render(FieldInput, {
			props: {
				field: field('relation', { relation_type: 'belongs_to', relation_to: 'posts' }),
				value: '',
				relationItems: [content('id-1', { title: 'One' })],
				relationTotal: 1200,
			},
		});
		expect(getByText('Showing the first 1 of 1,200 entries in posts.')).toBeTruthy();
	});

	it('says nothing about a cut when the picker holds the whole collection', () => {
		const { queryByText } = render(FieldInput, {
			props: {
				field: field('relation', { relation_type: 'belongs_to', relation_to: 'posts' }),
				value: '',
				relationItems: [content('id-1', { title: 'One' })],
				relationTotal: 1,
			},
		});
		expect(queryByText(/Only the first/)).toBeNull();
	});

	// Without the id, the field's label would point at an element that does not
	// exist.
	it('puts the field id on the manual ID fallback input', () => {
		const { container } = render(FieldInput, {
			props: {
				field: field('relation', { relation_type: 'belongs_to', relation_to: 'posts' }),
				value: '',
				relationItems: [],
				id: 'field-f',
			},
		});
		expect(container.querySelector('input#field-f')).toBeTruthy();
	});

	// The trigger is a combobox, not a button. It owns a popup listbox and
	// announces its expanded state, which is what the combobox role is for. A
	// button role tells a screen reader nothing about either.
	it('renders a multi-select of related items for a many_to_many relation', async () => {
		const items = [content('id-1', { title: 'One' }), content('id-2', { title: 'Two' })];
		const { getByRole, getAllByRole } = render(FieldInput, {
			props: {
				field: field('relation', { relation_type: 'many_to_many', relation_to: 'posts' }),
				value: [],
				relationItems: items,
			},
		});
		const trigger = getByRole('combobox', { expanded: false });
		await fireEvent.click(trigger);

		expect(getAllByRole('option')).toHaveLength(2);
	});

	it('shows the selected relations as chips', () => {
		const items = [content('id-1', { title: 'One' }), content('id-2', { title: 'Two' })];
		const { getByRole } = render(FieldInput, {
			props: {
				field: field('relation', { relation_type: 'many_to_many', relation_to: 'posts' }),
				value: ['id-2'],
				relationItems: items,
			},
		});
		expect(getByRole('combobox', { expanded: false }).textContent).toContain('Two');
	});

	it('shows an empty-state message for a many_to_many relation with no entries', () => {
		const { getByText } = render(FieldInput, {
			props: {
				field: field('relation', { relation_type: 'many_to_many', relation_to: 'posts' }),
				value: [],
				relationItems: [],
				relationTotal: 0,
			},
		});
		expect(getByText(/has no entries yet/)).toBeTruthy();
	});

	it('says a many_to_many picker could not be read', () => {
		const { getByText, queryByText } = render(FieldInput, {
			props: {
				field: field('relation', { relation_type: 'many_to_many', relation_to: 'posts' }),
				value: [],
				relationItems: [],
				relationFailed: true,
			},
		});
		expect(getByText(/Could not load the entries in/)).toBeTruthy();
		expect(queryByText(/has no entries yet/)).toBeNull();
	});

	// The key of a has_one or has_many lives on the other table. A control
	// here would either fail the save (has_one would go to the insert as a
	// column that does not exist) or lose the selection (has_many never
	// reaches the request), so there is nothing to offer but what points here.
	it('renders a has_many read-only, naming the rows that point here', () => {
		const items = [content('id-1', { title: 'One' }), content('id-2', { title: 'Two' })];
		const { queryByRole, getByText, getByTestId } = render(FieldInput, {
			props: {
				field: field('relation', { relation_type: 'has_many', relation_to: 'posts' }),
				value: ['id-2'],
				relationItems: items,
			},
		});
		expect(queryByRole('combobox')).toBeNull();
		expect(getByTestId('inverse-relation').textContent).toContain('Two');
		expect(getByText(/Change it there, not here/)).toBeTruthy();
	});

	it('renders a has_one read-only with no control to type into', () => {
		const { queryByRole, getByText } = render(FieldInput, {
			props: {
				field: field('relation', { relation_type: 'has_one', relation_to: 'posts' }),
				value: '',
				relationItems: [content('id-1', { title: 'One' })],
			},
		});
		expect(queryByRole('combobox')).toBeNull();
		expect(queryByRole('textbox')).toBeNull();
		expect(getByText('No linked entries yet.')).toBeTruthy();
	});
});

// A validation message printed beside a control is a paragraph nothing points
// at. Handed to the control it reaches aria-invalid and the described-by
// paragraph the kit already wires.
describe('FieldInput reports validation on the control', () => {
	it('marks a text control invalid and describes it', () => {
		const { getByRole, container } = render(FieldInput, {
			props: { field: field('text'), value: '', id: 'field-f', error: 'This field is required' },
		});
		const input = getByRole('textbox');
		expect(input.getAttribute('aria-invalid')).toBe('true');
		expect(input.getAttribute('aria-describedby')).toBe('field-f-error');
		expect(container.querySelector('#field-f-error')?.textContent).toBe('This field is required');
	});

	it('marks a boolean control invalid', () => {
		const { getByRole } = render(FieldInput, {
			props: { field: field('boolean'), value: false, id: 'field-f', error: 'Required' },
		});
		expect(getByRole('checkbox').getAttribute('aria-invalid')).toBe('true');
	});

	it('describes a relation combobox with its error', () => {
		const { getByRole } = render(FieldInput, {
			props: {
				field: field('relation', { relation_type: 'belongs_to', relation_to: 'posts' }),
				value: '',
				relationItems: [content('id-1', { title: 'One' })],
				id: 'field-f',
				error: 'Pick one',
			},
		});
		expect(getByRole('combobox').getAttribute('aria-describedby')).toBe('field-f-error');
	});
});
