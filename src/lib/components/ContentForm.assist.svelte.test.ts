// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte';
import { flushSync, tick } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { activeAssistForm, type FormAssistController } from '@lyeve-labs/ui-kit';
import type { FieldType, SchemaField } from '@lyeve-labs/client';
import ContentForm from './ContentForm.svelte';

afterEach(cleanup);

const field = (name: string, field_type: FieldType, extra: Partial<SchemaField> = {}): SchemaField => ({
	name,
	field_type,
	required: false,
	unique: false,
	indexed: false,
	...extra,
});

function form(): FormAssistController {
	const found = activeAssistForm();
	expect(found, 'the entry form registered').toBeDefined();
	return found!;
}

async function settle() {
	flushSync();
	await tick();
	flushSync();
}

describe('ContentForm and the assistant', () => {
	it('shows a field help text as the control description', () => {
		const formValues = $state({ summary: '' });
		const { getByRole } = render(ContentForm, {
			props: { fields: [field('summary', 'text', { help_text: 'Two sentences, at most 160 characters.' })], formValues },
		});
		const input = getByRole('textbox');
		const described = (input.getAttribute('aria-describedby') ?? '').split(' ').map((id) => document.getElementById(id)?.textContent);
		expect(described).toContain('Two sentences, at most 160 characters.');
	});

	it('registers every field under its name, with its help text, in a form named for the entry', async () => {
		const formValues = $state({ title: 'Hello', views: 3, featured: false, published_on: '', body: '<p>x</p>', meta: '{}' });
		render(ContentForm, {
			props: {
				label: 'New Articles entry',
				fields: [
					field('title', 'text', { help_text: 'The headline.' }),
					field('views', 'number'),
					field('featured', 'boolean'),
					field('published_on', 'date'),
					field('body', 'rich_text'),
					field('meta', 'json'),
				],
				formValues,
			},
		});
		await settle();
		expect(form().label).toBe('New Articles entry');
		const described = form().describe();
		expect(described.map((f) => (f.withheld ? f.label : f.name))).toEqual(['title', 'views', 'featured', 'published_on', 'body', 'meta']);
		expect(described[0]).toMatchObject({ withheld: false, name: 'title', hint: 'The headline.', value: 'Hello' });
	});

	it('withholds a No AI field, so its value never reaches an assistant', async () => {
		const formValues = $state({ title: 'Hello', notes: 'Call the patient on Monday.' });
		render(ContentForm, {
			props: { fields: [field('title', 'text'), field('notes', 'text', { no_ai: true })], formValues },
		});
		await settle();
		const notes = form().describe()[1];
		expect(notes).toEqual({ withheld: true, label: 'notes', kind: 'text' });
		expect(JSON.stringify(form().describe())).not.toContain('Call the patient');
		const result = form().suggest({ notes: 'Something else.' });
		expect(result.applied).toEqual([]);
		expect(formValues.notes).toBe('Call the patient on Monday.');
	});

	it('writes an accepted suggestion into the form state the page saves', async () => {
		const formValues = $state<Record<string, unknown>>({ title: '', views: 0, featured: false });
		render(ContentForm, {
			props: { fields: [field('title', 'text'), field('views', 'number'), field('featured', 'boolean')], formValues },
		});
		await settle();
		expect(form().suggest({ title: 'Five habits for better sleep', views: 12, featured: true }).applied).toEqual(['title', 'views', 'featured']);
		await settle();
		expect(formValues.title).toBe('Five habits for better sleep');
		expect(formValues.views).toBe(12);
		expect(formValues.featured).toBe(true);
		form().acceptAll();
		await settle();
		expect(form().pending()).toEqual([]);
		expect(formValues.title).toBe('Five habits for better sleep');
	});

	it('puts a rejected suggestion back to what the field held', async () => {
		const formValues = $state<Record<string, unknown>>({ title: 'Mine' });
		render(ContentForm, { props: { fields: [field('title', 'text')], formValues } });
		await settle();
		form().suggest({ title: 'Theirs' });
		await settle();
		form().rejectAll();
		await settle();
		expect(formValues.title).toBe('Mine');
	});
});
