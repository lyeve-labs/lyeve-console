// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/svelte';
import { flushSync, tick } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { activeAssistForm, type FormAssistController } from '@lyeve-labs/ui-kit';
import type { Content, FieldType, HttpClient, SchemaField } from '@lyeve-labs/client';
import ContentForm from './ContentForm.svelte';
import { fieldKey } from '$lib/utils/content-form';
import { formContext } from '$lib/assistant/request';
import { readRelationChoices } from '$lib/server/relation-choices';

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

	const entries = [
		{ id: 'r1', data: { title: 'One' } },
		{ id: 'r2', data: { title: 'Two' } },
	] as unknown as Content[];
	const choices = { authors: { items: entries, total: 2, failed: false } };
	const related = (relation_type: 'belongs_to' | 'many_to_many') => ({ relation_type, relation_to: 'authors' }) as Partial<SchemaField>;

	// Every control an editor can type into, one row per kind, so a control
	// that loses its No AI mark fails here. A uid is read-only and an inverse
	// relation is shown, not edited, so neither registers at all.
	it.each([
		['text', 'text', 'Call the patient on Monday.', 'Something else.', {}, {}],
		['rich text', 'rich_text', '<p>Call the patient on Monday.</p>', '<p>Something else.</p>', {}, {}],
		['number', 'number', 7, 8, {}, {}],
		['integer', 'integer', 7, 8, {}, {}],
		['decimal', 'decimal', 7.5, 8.5, {}, {}],
		['boolean', 'boolean', true, false, {}, {}],
		['date', 'date', '2026-03-14', '2026-04-01', {}, {}],
		['datetime', 'datetime', '2026-03-14T09:30', '2026-04-01T10:00', {}, {}],
		['json', 'json', '{"diagnosis":"private"}', '{"a":1}', {}, {}],
		['email', 'email', 'patient@example.com', 'other@example.com', {}, {}],
		['url', 'url', 'https://example.com/private', 'https://example.com/other', {}, {}],
		['media', 'media', '/api/v1/media/scan.png', '/api/v1/media/other.png', {}, {}],
		['relation picker', 'relation', 'r1', 'r2', related('belongs_to'), choices],
		['relation by ID', 'relation', 'r1', 'r2', related('belongs_to'), {}],
		['many-to-many relation', 'relation', ['r1'], ['r2'], related('many_to_many'), choices],
	] as const)('withholds a No AI %s field, so its value never reaches an assistant', async (_, type, held, other, extra, relations) => {
		const secret = field('secret', type as FieldType, { ...extra, no_ai: true });
		const key = fieldKey(secret);
		const formValues = $state<Record<string, unknown>>({ [key]: held });
		render(ContentForm, { props: { fields: [secret], formValues, relations } });
		await settle();
		const described = form().describe();
		expect(described).toEqual([{ withheld: true, label: 'secret', kind: expect.any(String) }]);
		const result = form().suggest({ secret: other as never });
		expect(result.applied).toEqual([]);
		await settle();
		expect(formValues[key]).toEqual(held);
		expect(form().pending()).toEqual([]);
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

	it('sends the assistant no value of a private field, and the value of an unmarked one', async () => {
		const formValues = $state<Record<string, unknown>>({ diagnosis: 'Fractured left wrist', room: 'Room 4' });
		render(ContentForm, {
			props: { fields: [field('diagnosis', 'text', { private: true }), field('room', 'text')], formValues },
		});
		await settle();
		const sent = JSON.stringify(formContext(form()));
		expect(sent).not.toContain('Fractured left wrist');
		expect(sent).toContain('Room 4');
	});

	const patients = '11111111-aaaa-4aaa-8aaa-111111111111';
	// The second case falls back to a name field the type leaves unmarked.
	it.each([
		['title', { private: true }, 'ward', 'East', '11111111'],
		['name', { no_ai: true }, 'label', 'Bed 12', 'Bed 12'],
	] as const)('names a related entry to the assistant without its %s when the related type marks it', async (marked, mark, other, otherValue, expected) => {
		const client = {
			get: async (path: string) => {
				if (path === '/api/admin/schemas/patients') {
					return { name: 'patients', fields: [field(marked, 'text', mark), field(other, 'text')] };
				}
				return {
					data: [{ id: patients, title: 'Jane Doe', slug: 'jane-doe-x7k2p1', body: { [marked]: 'Jane Doe', [other]: otherValue } }],
					total_count: 1,
				};
			},
		} as unknown as HttpClient;
		const patient = field('patient', 'relation', { relation_type: 'belongs_to', relation_to: 'patients' });
		const relations = await readRelationChoices(client, [patient]);
		const formValues = $state<Record<string, unknown>>({ [fieldKey(patient)]: '' });
		render(ContentForm, { props: { fields: [patient], formValues, relations } });
		await settle();
		// The person still reads the name in the picker.
		expect(form().describe()[0]).toMatchObject({ options: [{ value: patients, label: 'Jane Doe' }] });
		const sent = formContext(form());
		expect(JSON.stringify(sent)).not.toMatch(/jane/i);
		expect(sent?.fields[0].options).toEqual([{ value: patients, label: expected }]);
	});
});
