// @vitest-environment jsdom
import { render, cleanup } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { tick } from 'svelte';
import ContentForm from './ContentForm.svelte';
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

describe('ContentForm', () => {
	it('shows an empty-state message when there are no fields', () => {
		const formValues = $state({});
		const { getByText } = render(ContentForm, {
			props: { fields: [], formValues },
		});
		expect(getByText('This content type has no editable fields.')).toBeTruthy();
	});

	it('renders a labeled input for each field seeded from formValues', () => {
		const formValues = $state({ title: 'Hello' });
		const { getByText, getByRole } = render(ContentForm, {
			props: { fields: [field('text', { name: 'title' })], formValues },
		});
		expect(getByText('Title')).toBeTruthy();
		expect((getByRole('textbox') as HTMLInputElement).value).toBe('Hello');
	});

	it('binds a belongs_to by its foreign key, the key the form state carries', () => {
		// buildEmpty and serialize key a belongs_to as tag_id. Bound as tag,
		// the value would start undefined and Svelte would throw
		// props_invalid_value, taking every field after it off the page.
		const formValues = $state<Record<string, unknown>>({ title: 'Hello', tag_id: 'id-2' });
		const items = [content('id-1', { title: 'One' }), content('id-2', { title: 'Two' })];
		const { getByRole, getByText } = render(ContentForm, {
			props: {
				fields: [
					field('relation', { name: 'tag', relation_type: 'belongs_to', relation_to: 'tags' }),
					field('text', { name: 'title' }),
				],
				formValues,
				relations: { tags: { items, total: items.length, failed: false } },
			},
		});
		expect(getByText('Title')).toBeTruthy();
		expect((getByRole('combobox') as HTMLInputElement).value).toBe('Two');
	});

	it('renders a per-field validation error', () => {
		const formValues = $state({ title: '' });
		const { getByText } = render(ContentForm, {
			props: {
				fields: [field('text', { name: 'title' })],
				formValues,
				validationErrors: { title: 'Title is required' },
			},
		});
		expect(getByText('Title is required')).toBeTruthy();
	});

	// A loose paragraph with no id beside the control is referenced by
	// nothing, so a screen reader announces the control as valid and never
	// reads the reason it was rejected.
	it('wires the validation error to the control it belongs to', () => {
		const formValues = $state({ title: '' });
		const { getByRole, container } = render(ContentForm, {
			props: {
				fields: [field('text', { name: 'title' })],
				formValues,
				validationErrors: { title: 'Title is required' },
			},
		});
		const input = getByRole('textbox');
		expect(input.getAttribute('aria-invalid')).toBe('true');
		const describedBy = input.getAttribute('aria-describedby');
		expect(describedBy).toBe('field-title-error');
		expect(container.querySelector(`#${describedBy}`)?.textContent).toBe('Title is required');
	});

	it('renders a server error alert', () => {
		const formValues = $state({});
		const { getByText, getByRole } = render(ContentForm, {
			props: { fields: [], formValues, error: 'Save failed' },
		});
		expect(getByText('Save failed')).toBeTruthy();
		expect(getByRole('alert')).toBeTruthy();
	});

	it('binds every field label to the control it names', () => {
		// A label whose `for` names an id nothing carries labels nothing:
		// clicking it focuses nothing and a screen reader announces the input
		// with no name.
		//
		// A button is labelable, which is why the date and datetime pickers can
		// take the `for`: their trigger is a button, and clicking the label opens
		// the calendar. Boolean renders a checkbox, which is labelable too.
		const labelable: FieldType[] = [
			'text',
			'number',
			'boolean',
			'date',
			'datetime',
			'email',
			'url',
			'media',
			'uid',
			'json',
		];
		for (const t of labelable) {
			const formValues = $state({ f: '' });
			const { container, unmount } = render(ContentForm, {
				props: { fields: [field(t)], formValues },
			});
			const label = container.querySelector('label[for]') as HTMLLabelElement;
			expect(label, `${t} has no label`).toBeTruthy();
			const target = container.querySelector(`[id="${label.htmlFor}"]`);
			expect(target, `${t} label points at a missing element`).toBeTruthy();
			expect(['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON']).toContain(target!.tagName);
			unmount();
		}
	});

	it('names the controls a label cannot bind to', () => {
		// A contenteditable and a chip well are not labelable, so they carry their
		// own accessible name rather than a `for` that points at nothing.
		const richValues = $state({ f: '' });
		const rich = render(ContentForm, {
			props: { fields: [field('rich_text')], formValues: richValues },
		});
		const box = rich.container.querySelector('[role="textbox"]');
		expect(box?.getAttribute('aria-label')).toBe('f');
		expect(rich.container.querySelector('label[for]')).toBeNull();
		rich.unmount();

		const manyValues = $state({ f: [] });
		const many = render(ContentForm, {
			props: {
				fields: [field('relation', { relation_type: 'many_to_many', relation_to: 'posts' })],
				formValues: manyValues,
				relations: { posts: { items: [content('id-1', { title: 'One' })], total: 1, failed: false } },
			},
		});
		const group = many.container.querySelector('[role="group"]');
		expect(group?.getAttribute('aria-label')).toBe('f');
		expect(many.container.querySelector('label[for]')).toBeNull();
		many.unmount();
	});
});

describe('ContentForm failures', () => {
	const fields = [field('text', { name: 'title' }), field('text', { name: 'summary', required: true })];

	it('puts the server error above the first field', () => {
		const formValues = $state({ title: '', summary: '' });
		const { getByText, container } = render(ContentForm, {
			props: { fields, formValues, error: 'The entry could not be saved.' },
		});
		const alert = getByText('The entry could not be saved.');
		const first = container.querySelector('[data-field-name="title"]') as Node;
		expect(alert.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
	});

	it('counts the fields that need attention at the top of the form', () => {
		const formValues = $state({ title: '', summary: '' });
		const { getByText } = render(ContentForm, {
			props: { fields, formValues, validationErrors: { summary: 'Required' } },
		});
		expect(getByText('1 field needs attention.')).toBeTruthy();
	});

	it('moves focus to the first field a refused submit names', async () => {
		const formValues = $state({ title: '', summary: '' });
		const { container, rerender } = render(ContentForm, { props: { fields, formValues } });
		await rerender({ fields, formValues, validationErrors: { summary: 'Required' } });
		await tick();
		expect(document.activeElement).toBe(container.querySelector('#field-summary'));
	});

	it('moves focus to the key a refused submit names inside a json field', async () => {
		const jsonFields = [field('text', { name: 'status' }), field('json', { name: 'data' })];
		const formValues = $state({ status: 'new', data: '{"name":"Ada","email":"[redacted-email]"}' });
		const { getAllByLabelText, rerender } = render(ContentForm, { props: { fields: jsonFields, formValues } });
		await rerender({
			fields: jsonFields,
			formValues,
			validationErrors: { data: 'The key email holds a masked value.' },
			errorKeys: { data: 'email' },
		});
		await tick();
		expect(document.activeElement).toBe(getAllByLabelText('Value')[1]);
	});

	it('leaves focus where it is when the fields are derived again under the same refusal', async () => {
		// One props object, the way a page holds them: the refusal stays the
		// same object while the page's data is read again and its fields are
		// derived anew.
		const props = $state({
			fields,
			formValues: { title: '', summary: '' } as Record<string, unknown>,
			validationErrors: {} as Record<string, string>,
		});
		const { container } = render(ContentForm, { props });
		props.validationErrors = { summary: 'Required' };
		await tick();
		const title = container.querySelector('#field-title') as HTMLInputElement;
		title.focus();

		props.fields = fields.map((f) => ({ ...f }));
		await tick();

		expect(document.activeElement).toBe(title);
	});
});
