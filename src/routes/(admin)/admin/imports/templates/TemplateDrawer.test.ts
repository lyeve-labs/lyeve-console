// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, tick } from 'svelte';
import TemplateDrawer from './TemplateDrawer.svelte';
import type { MappingTemplate } from '$lib/api/bulk-import';

type After = (o: { result: { type: string }; update: (o?: unknown) => Promise<void> }) => Promise<void>;
type Submit = (input: { cancel: () => void }) => After | Promise<After>;

const forms = vi.hoisted(() => ({ submit: null as Submit | null }));
vi.mock('$app/forms', () => ({
	enhance: (_form: HTMLFormElement, submit: Submit) => {
		forms.submit = submit;
		return { destroy() {} };
	},
}));

afterEach(cleanup);
beforeEach(() => {
	forms.submit = null;
});

const schemas = [{ name: 'order', fields: [{ name: 'placed_at', field_type: 'datetime' }] }];

const orders: MappingTemplate = {
	id: 't1',
	name: 'Orders',
	content_type: 'order',
	mode: 'upsert',
	upsert_key: 'entry.slug',
	field_mappings: [{ source_field: 'Placed', target_field: 'placed_at' }],
	created_at: '2026-10-01T00:00:00Z',
	updated_at: '2026-10-01T00:00:00Z',
} as MappingTemplate;

function setup(props: Record<string, unknown> = {}) {
	return render(TemplateDrawer, { props: { schemas, licensed: true, ...props } as never });
}

const templateForm = () => document.body.querySelector('#template-form') as HTMLFormElement | null;

describe('TemplateDrawer', () => {
	it('stays closed until the page asks it to edit', () => {
		setup();
		expect(templateForm()).toBeNull();
	});

	it('posts a new template to the create action with the only content type chosen', () => {
		const { component } = setup();
		flushSync(() => component.edit(null));
		const form = templateForm() as HTMLFormElement;
		expect(form.getAttribute('action')).toBe('?/createTemplate');
		expect(form.querySelector('input[name="id"]')).toBeNull();
		expect(new FormData(form).get('content_type')).toBe('order');
		expect(new FormData(form).get('mappings')).toBe('[]');
	});

	it('posts a stored template to the update action with its id and mappings', () => {
		const { component } = setup();
		flushSync(() => component.edit(orders));
		const form = templateForm() as HTMLFormElement;
		const sent = new FormData(form);
		expect(form.getAttribute('action')).toBe('?/updateTemplate');
		expect(sent.get('id')).toBe('t1');
		expect(sent.get('name')).toBe('Orders');
		expect(sent.get('mode')).toBe('upsert');
		expect(sent.get('upsert_key')).toBe('entry.slug');
		expect(JSON.parse(String(sent.get('mappings')))).toEqual([
			expect.objectContaining({ source_field: 'Placed', target_field: 'placed_at' }),
		]);
	});

	it('refuses to save a row that names a column but no field', async () => {
		const { component, getByLabelText, getByRole } = setup();
		flushSync(() => component.edit(null));
		await fireEvent.input(getByLabelText('Column in the file'), { target: { value: 'Ref' } });
		expect(templateForm()?.textContent).toContain('Give every row a column in the file and the field it fills.');
		expect((getByRole('button', { name: 'Create' }) as HTMLButtonElement).disabled).toBe(true);
	});

	it('shows the failure it is given first in its form', () => {
		const { component } = setup({ error: 'Map at least one column.' });
		flushSync(() => component.edit(null));
		expect(templateForm()?.querySelector(':scope > div')?.firstElementChild?.textContent).toContain('Map at least one column.');
	});

	it('shows a failure that arrives while it is open', async () => {
		const { component, rerender } = setup();
		flushSync(() => component.edit(null));
		const errors = () => templateForm()?.querySelector(':scope > div')?.firstElementChild?.textContent ?? '';
		expect(errors()).not.toContain('Map at least one column.');
		await rerender({ error: 'Map at least one column.' });
		expect(errors()).toContain('Map at least one column.');
	});

	it('says why it offers no content type when the list was not read', () => {
		const { component } = setup({ schemas: null });
		flushSync(() => component.edit(null));
		expect(templateForm()?.textContent).toContain('Could not load content types');
	});

	it('closes on success and stays open on a failure', async () => {
		const { component } = setup();
		flushSync(() => component.edit(orders));
		const update = vi.fn(async () => {});
		const run = async (type: string) => {
			const after = await (forms.submit as Submit)({ cancel: () => {} });
			await after({ result: { type }, update });
			await tick();
		};
		await run('failure');
		expect(templateForm()).toBeTruthy();
		await run('success');
		await vi.waitFor(() => expect(templateForm()).toBeNull());
	});
});
