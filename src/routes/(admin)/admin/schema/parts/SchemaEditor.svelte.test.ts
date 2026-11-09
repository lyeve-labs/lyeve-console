// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import { flushSync, tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Schema } from '@lyeve-labs/client';
import type { Problem } from '$lib/schema/editor';
import { DdlHistory } from './ddl-history.svelte';
import SchemaEditor from './SchemaEditor.svelte';

let teardown: (() => void) | undefined;
afterEach(() => {
	cleanup();
	teardown?.();
	teardown = undefined;
});

function posts(): Schema {
	return {
		name: 'posts',
		display_name: 'Posts',
		fields: [
			{ id: 'f-id', name: 'id', field_type: 'uid', required: true, unique: true, indexed: true, system: true },
			{ id: 'f-title', name: 'title', field_type: 'text', required: true, unique: false, indexed: false, localized: true },
		],
	};
}

/**
 * Renders the editor over a state object, the way the page binds it, so a
 * case reads every edit back from the schema it handed in.
 */
function setup(over: Record<string, unknown> = {}) {
	let ddl!: DdlHistory;
	// A case that sets up twice ends the first root before it builds the second.
	teardown?.();
	teardown = $effect.root(() => {
		ddl = new DdlHistory({ table: () => 'posts', isSuperAdmin: () => true, rowCounts: () => ({}) });
	});
	const onrename = vi.fn();
	const props = $state({
		schema: posts(),
		localizedCleared: {} as Record<string, string>,
		saved: posts() as Schema | null,
		schemas: [posts(), { name: 'authors', display_name: 'Authors', fields: [] }] as Schema[],
		canWrite: true,
		isNewSchema: false,
		dirty: false,
		saveError: '',
		problems: [] as Problem[],
		isSuperAdmin: false,
		ddl,
		onrename,
		...over,
	});
	render(SchemaEditor, { props });
	return { props, onrename };
}

describe('SchemaEditor', () => {
	it('adds a field and a typed relation to the schema it was handed', async () => {
		const { props } = setup();
		await fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Add relation' }));
		expect(props.schema.fields.map((f) => f.field_type)).toEqual(['uid', 'text', 'text', 'relation']);
		expect(props.schema.fields[3].relation_type).toBe('belongs_to');
	});

	it('marks a system field required only when it is, as an optional relation key is not', () => {
		const schema = posts();
		schema.fields.push(
			{ id: 'f-author', name: 'author', field_type: 'relation', relation_to: 'authors', relation_type: 'belongs_to', required: false, unique: false, indexed: false },
			{ id: 'f-author-id', name: 'author_id', field_type: 'uid', required: false, unique: false, indexed: true, system: true },
		);
		setup({ schema, saved: structuredClone(schema) });
		const noteOf = (name: string) => screen.getByText(name, { selector: 'span.text-brand' }).nextElementSibling?.textContent;
		expect(noteOf('id')).toBe('system, required, indexed');
		expect(noteOf('author_id')).toBe('system, indexed');
	});

	it('removes a user field and offers no remove on a system one', async () => {
		const { props } = setup();
		expect(screen.queryByRole('button', { name: 'Remove field id' })).toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: 'Remove field title' }));
		expect(props.schema.fields.map((f) => f.name)).toEqual(['id']);
	});

	it('moves a saved table only through Rename, and holds Rename while there are edits', async () => {
		const { props, onrename } = setup();
		expect((screen.getByLabelText('Machine name') as HTMLInputElement).readOnly).toBe(true);
		await fireEvent.click(screen.getByRole('button', { name: /Rename/ }));
		expect(onrename).toHaveBeenCalledTimes(1);
		props.dirty = true;
		flushSync();
		expect((screen.getByRole('button', { name: /Rename/ }) as HTMLButtonElement).disabled).toBe(true);
	});

	it('takes the machine name of a new schema and shows its problem there', () => {
		setup({
			saved: null,
			isNewSchema: true,
			problems: [{ fieldId: null, target: 'schema-name', where: 'Machine name', message: 'Name the schema.' }],
		});
		const name = screen.getByLabelText('Machine name') as HTMLInputElement;
		expect(name.readOnly).toBe(false);
		expect(screen.getByText('Name the schema.')).toBeTruthy();
		expect(screen.queryByRole('button', { name: /Rename/ })).toBeNull();
	});

	it('announces a failed save in a live region that was already there', () => {
		const { props } = setup();
		const region = document.querySelector('[aria-live="assertive"]') as HTMLElement;
		expect(region.textContent?.trim()).toBe('');
		props.saveError = 'The schema could not be saved.';
		flushSync();
		expect(screen.getByTestId('save-error').textContent).toContain('The schema could not be saved.');
	});

	it('names each transport control by id and hint, and stores only what was narrowed', async () => {
		const { props } = setup();
		const group = document.getElementById('transport-rest') as HTMLElement;
		expect(group.getAttribute('role')).toBe('radiogroup');
		expect(document.getElementById(group.getAttribute('aria-describedby') ?? '')?.textContent).toBe('The content API.');
		await fireEvent.click(within(group).getByRole('radio', { name: 'Read only' }));
		expect(props.schema.transports).toEqual({ rest: 'r' });
		await fireEvent.click(within(group).getByRole('radio', { name: 'Read and write' }));
		expect(props.schema.transports).toBeUndefined();
	});

	it('marks the schema for public delivery, and stores no mark once it is cleared', async () => {
		const { props } = setup();
		const box = screen.getByRole('checkbox', { name: 'Serve on public delivery' });
		await fireEvent.click(box);
		expect(props.schema.public_delivery).toBe(true);
		await fireEvent.click(box);
		expect(props.schema.public_delivery).toBeUndefined();
	});

	it('warns that public delivery serves every entry of a schema without draft and publish', () => {
		const warning = /public delivery serves every entry/;
		setup({ schema: { ...posts(), public_delivery: true } });
		expect(screen.getByText(warning)).toBeTruthy();
		cleanup();
		setup({ schema: { ...posts(), public_delivery: true, with_draft_publish: true } });
		expect(screen.queryByText(warning)).toBeNull();
		cleanup();
		setup({ schema: posts() });
		expect(screen.queryByText(warning)).toBeNull();
	});

	it('marks a field private, and offers no private box on a system field', async () => {
		const { props } = setup();
		expect(screen.queryByRole('checkbox', { name: 'Private, id' })).toBeNull();
		const box = screen.getByRole('checkbox', { name: 'Private, title' });
		await fireEvent.click(box);
		expect(props.schema.fields[1].private).toBe(true);
		await fireEvent.click(box);
		expect(props.schema.fields[1].private).toBeUndefined();
	});

	it('marks a field No AI, and offers no No AI box on a system field', async () => {
		const { props } = setup();
		expect(screen.queryByRole('checkbox', { name: 'No AI, id' })).toBeNull();
		const box = screen.getByRole('checkbox', { name: 'No AI, title' });
		await fireEvent.click(box);
		expect(props.schema.fields[1].no_ai).toBe(true);
		await fireEvent.click(box);
		expect(props.schema.fields[1].no_ai).toBeUndefined();
	});

	it('writes help text into the field, capped at 500 characters, and stores none when it is emptied', async () => {
		const { props } = setup();
		expect(screen.queryByRole('button', { name: 'Help text, id' })).toBeNull();
		const toggle = screen.getByRole('button', { name: 'Help text, title' });
		expect(toggle.getAttribute('aria-expanded')).toBe('false');
		await fireEvent.click(toggle);
		expect(toggle.getAttribute('aria-expanded')).toBe('true');
		const input = screen.getByLabelText('Help text') as HTMLInputElement;
		expect(input.maxLength).toBe(500);
		await fireEvent.input(input, { target: { value: 'One sentence a reader understands.' } });
		expect(props.schema.fields[1].help_text).toBe('One sentence a reader understands.');
		await fireEvent.input(input, { target: { value: '' } });
		expect(props.schema.fields[1].help_text).toBeUndefined();
	});

	it('shows the help text a saved field already has', async () => {
		const schema = posts();
		schema.fields[1].help_text = 'At most 120 characters.';
		setup({ schema });
		await fireEvent.click(screen.getByRole('button', { name: 'Help text, title' }));
		expect((screen.getByLabelText('Help text') as HTMLInputElement).value).toBe('At most 120 characters.');
	});

	it('says a relation into a schema that is not public is not served on public delivery', () => {
		const note = 'Public delivery does not serve this relation until Authors is public too.';
		const withRelation = (): Schema => {
			const schema = { ...posts(), public_delivery: true };
			schema.fields.push({ id: 'f-author', name: 'author', field_type: 'relation', relation_type: 'belongs_to', relation_to: 'authors', required: false, unique: false, indexed: false });
			return schema;
		};
		setup({ schema: withRelation() });
		expect(screen.getByText(note)).toBeTruthy();
		cleanup();
		setup({ schema: withRelation(), schemas: [posts(), { name: 'authors', display_name: 'Authors', fields: [], public_delivery: true }] });
		expect(screen.queryByText(note)).toBeNull();
		cleanup();
		setup({ schema: { ...withRelation(), public_delivery: undefined } });
		expect(screen.queryByText(note)).toBeNull();
	});

	it('ties a relation kind problem to its radio group', () => {
		const schema = posts();
		schema.fields.push({ id: 'f-rel', name: 'parent', field_type: 'relation', relation_type: 'belongs_to', relation_to: 'posts', required: false, unique: false, indexed: false });
		setup({
			schema,
			problems: [{ fieldId: 'f-rel', target: 'relation-type-f-rel', where: 'parent', message: 'The kind is wrong here.' }],
		});
		const group = document.getElementById('relation-type-f-rel') as HTMLElement;
		expect(group.getAttribute('role')).toBe('radiogroup');
		expect(document.getElementById(group.getAttribute('aria-describedby') ?? '')?.textContent).toBe('The kind is wrong here.');
	});

	it('records why a localized mark was cleared when the type can no longer carry it', async () => {
		const { props } = setup();
		await fireEvent.click(screen.getByRole('combobox', { name: 'Type, title' }));
		await fireEvent.click(screen.getByRole('option', { name: 'number' }));
		expect(props.schema.fields[1].localized).not.toBe(true);
		expect(props.localizedCleared['f-title']).toBeTruthy();
		expect(screen.getByText(/No longer translated per locale\./)).toBeTruthy();
	});

	it('gives a decimal a precision and a scale inside the engine bounds, and drops both on another type', async () => {
		const { props } = setup();
		await fireEvent.click(screen.getByRole('combobox', { name: 'Type, title' }));
		await fireEvent.click(screen.getByRole('option', { name: 'decimal' }));
		const precision = screen.getByLabelText('Precision') as HTMLInputElement;
		const scale = screen.getByLabelText('Scale') as HTMLInputElement;
		expect(precision.value).toBe('18');
		expect(scale.value).toBe('2');
		expect(precision.min).toBe('1');
		expect(precision.max).toBe('38');

		await fireEvent.input(precision, { target: { value: '50' } });
		expect(props.schema.fields[1].precision).toBe(38);
		await fireEvent.input(scale, { target: { value: '40' } });
		expect(props.schema.fields[1].scale).toBe(30);
		await fireEvent.input(scale, { target: { value: '4' } });
		await fireEvent.input(precision, { target: { value: '4' } });
		expect(props.schema.fields[1].precision).toBe(4);
		expect(props.schema.fields[1].scale).toBe(4);

		await fireEvent.click(screen.getByRole('combobox', { name: 'Type, title' }));
		await fireEvent.click(screen.getByRole('option', { name: 'text' }));
		expect('precision' in props.schema.fields[1]).toBe(false);
		expect('scale' in props.schema.fields[1]).toBe(false);
		expect(screen.queryByLabelText('Precision')).toBeNull();
	});

	it('leaves the scale alone while a precision is typed one digit at a time', async () => {
		const schema = posts();
		schema.fields[1] = { ...schema.fields[1], field_type: 'decimal', precision: 10, scale: 4, localized: undefined };
		const { props } = setup({ schema });
		const precision = screen.getByLabelText('Precision') as HTMLInputElement;
		await fireEvent.input(precision, { target: { value: '2' } });
		await fireEvent.input(precision, { target: { value: '20' } });
		expect(props.schema.fields[1].precision).toBe(20);
		expect(props.schema.fields[1].scale).toBe(4);
	});

	it('shows the value it stored after bringing a typed one inside the bounds', async () => {
		const schema = posts();
		schema.fields[1] = { ...schema.fields[1], field_type: 'decimal', precision: 38, scale: 30, localized: undefined };
		const { props } = setup({ schema });
		const precision = screen.getByLabelText('Precision') as HTMLInputElement;
		const scale = screen.getByLabelText('Scale') as HTMLInputElement;
		precision.value = '50';
		await fireEvent.input(precision);
		scale.value = '45';
		await fireEvent.input(scale);
		await tick();
		expect(props.schema.fields[1].precision).toBe(38);
		expect(precision.value).toBe('38');
		expect(props.schema.fields[1].scale).toBe(30);
		expect(scale.value).toBe('30');
	});

	it('steps from the stored value after bringing a typed one inside the bounds', async () => {
		const schema = posts();
		schema.fields[1] = { ...schema.fields[1], field_type: 'decimal', precision: 38, scale: 2, localized: undefined };
		const { props } = setup({ schema });
		const precision = screen.getByLabelText('Precision') as HTMLInputElement;
		precision.value = '50';
		await fireEvent.input(precision);
		await tick();
		const box = precision.closest('[data-field]') as HTMLElement;
		await fireEvent.click(within(box).getByRole('button', { name: 'Decrease precision' }));
		expect(props.schema.fields[1].precision).toBe(37);
		expect(precision.value).toBe('37');
	});

	it('shows an omitted scale as the precision when the precision is below 2', () => {
		const schema = posts();
		schema.fields[1] = { ...schema.fields[1], field_type: 'decimal', precision: 1, localized: undefined };
		setup({ schema });
		expect((screen.getByLabelText('Scale') as HTMLInputElement).value).toBe('1');
	});

	it('says what precision and scale mean in their hints', () => {
		const schema = posts();
		schema.fields[1] = { ...schema.fields[1], field_type: 'decimal', precision: 10, scale: 2, localized: undefined };
		setup({ schema });
		expect(screen.getByText('The most digits a value can have, from 1 to 38.')).toBeTruthy();
		expect(screen.getByText('How many of those digits come after the decimal point, from 0 to 10.')).toBeTruthy();
	});

	it('shows the scale problem on the scale box', () => {
		const schema = posts();
		schema.fields[1] = { ...schema.fields[1], field_type: 'decimal', precision: 2, scale: 4, localized: undefined };
		setup({
			schema,
			problems: [{ fieldId: 'f-title', target: 'decimal-scale-f-title', where: 'Field title', message: 'Enter a scale of at most 2.' }],
		});
		const scale = screen.getByLabelText('Scale') as HTMLInputElement;
		expect(scale.getAttribute('aria-invalid')).toBe('true');
		expect(screen.getByText('Enter a scale of at most 2.')).toBeTruthy();
	});

	it('finds the integer row, not number, when the type search reads int', async () => {
		setup();
		await fireEvent.click(screen.getByRole('combobox', { name: 'Type, title' }));
		const search = screen.getByPlaceholderText('Search');
		await fireEvent.input(search, { target: { value: 'int' } });
		const names = screen.getAllByRole('option').map((o) => o.textContent?.trim());
		expect(names).toContain('integer');
		expect(names).not.toContain('number');
	});

	it('locks every control for a role that cannot write', () => {
		setup({ canWrite: false });
		expect(screen.getByRole('group', { name: /Definition of Posts/ }).hasAttribute('disabled')).toBe(true);
		expect(screen.queryByRole('button', { name: 'Add field' })).toBeNull();
		expect(screen.queryByRole('button', { name: 'Remove field title' })).toBeNull();
		expect(screen.queryByRole('button', { name: /Rename/ })).toBeNull();
	});

	it('shows a saved table its API, and its history to a super admin only', () => {
		setup();
		expect(screen.getByRole('tab', { name: 'API' })).toBeTruthy();
		expect(screen.queryByRole('tab', { name: /History/ })).toBeNull();
		cleanup();
		setup({ isSuperAdmin: true });
		expect(screen.getByRole('tab', { name: /History/ })).toBeTruthy();
	});

	it('reads the history when its tab is first chosen', async () => {
		const { props } = setup({ isSuperAdmin: true });
		const submit = vi.fn();
		props.ddl.form = { requestSubmit: submit } as unknown as HTMLFormElement;
		expect(submit).not.toHaveBeenCalled();
		await fireEvent.click(screen.getByRole('tab', { name: /History/ }));
		expect(submit).toHaveBeenCalledTimes(1);
		expect(screen.getByTestId('schema-history')).toBeTruthy();
	});

	it('stops asking for the history once another tab is chosen', async () => {
		// The page keeps one history reader for every type it opens, so a reader
		// left open would fetch each later type's history on its definition.
		const { props } = setup({ isSuperAdmin: true });
		await fireEvent.click(screen.getByRole('tab', { name: /History/ }));
		expect(props.ddl.open).toBe(true);
		await fireEvent.click(screen.getByRole('tab', { name: 'Definition' }));
		expect(props.ddl.open).toBe(false);
	});

	it('keeps the relation help on the Definition tab and the routes on the API tab', async () => {
		setup();
		expect(screen.getByRole('button', { name: /How relations work/ })).toBeTruthy();
		expect(screen.queryByText(/^\/api\/v1\/content\/posts/)).toBeNull();
		await fireEvent.click(screen.getByRole('tab', { name: 'API' }));
		expect(screen.queryByRole('button', { name: /How relations work/ })).toBeNull();
		expect(screen.getAllByText(/^\/api\/v1\/content\/posts/).length).toBeGreaterThan(0);
	});

	it('draws no tabs for a table that is not saved yet', () => {
		setup({ saved: null, isNewSchema: true });
		expect(screen.queryByRole('tablist')).toBeNull();
		expect(screen.getByRole('button', { name: /How relations work/ })).toBeTruthy();
	});

	// The row shows a route and the button copies a curl command built from
	// it, so the button's own words say what it copies, and its description
	// names the route that sets it apart from the other rows.
	it('says on each route row that its copy button copies a curl command', async () => {
		setup();
		await fireEvent.click(screen.getByRole('tab', { name: 'API' }));
		const copies = screen.getAllByRole('button', { name: 'curl' });
		expect(copies.length).toBeGreaterThan(1);
		for (const b of copies) expect(b.textContent).toContain('curl');
		expect(screen.getByRole('button', { name: 'curl', description: /^Copy a curl request for POST / })).toBeTruthy();
	});
});

/*
 * The headings are a row of their own above the field rows, so each heading
 * stands over its column only when every row lays out the same fixed widths
 * after the name. jsdom draws no layout, so the case compares the width each
 * row gives its columns, in order.
 */
describe('SchemaEditor column headings', () => {
	/** The fixed width of each cell after the stretching name, sr-only labels skipped. */
	function widths(cells: Element[]): string[] {
		const after = cells.slice(cells.findIndex((c) => c.classList.contains('flex-1')) + 1);
		return after
			.filter((c) => !c.classList.contains('sr-only'))
			.map((c) => [...c.classList].find((k) => /^(@xl:)?w-/.test(k))?.replace('@xl:', '') ?? 'none');
	}

	function header(): HTMLElement {
		return screen.getByText('Field', { selector: 'span' }).parentElement as HTMLElement;
	}

	/** The cells of the editable row for one field, the name input first. */
	function fieldRow(name: string): Element[] {
		const input = screen.getByDisplayValue(name);
		const cells = input.closest('.flex-wrap') as HTMLElement;
		return [...cells.children];
	}

	function lockedRow(name: string): Element[] {
		const row = screen.getByText(name, { selector: 'span.text-brand' }).closest('.rounded-lg') as HTMLElement;
		return [...row.children];
	}

	it('names every column a field row has, the translation, private and No AI boxes included', () => {
		setup();
		const names = [...header().children].map((c) => c.textContent?.trim()).filter(Boolean);
		expect(names).toEqual(['Field', 'Type', 'Req', 'Idx', 'i18n', 'Private', 'No AI']);
	});

	it('gives the headings, a system row and a field row the same columns', () => {
		setup();
		const heads = widths([...header().children]);
		expect(widths(fieldRow('title'))).toEqual(heads);
		expect(widths(lockedRow('id'))).toEqual(heads);
	});

	/*
	 * The editor sits beside the navigation and the schema list, so a window
	 * wide enough for the sm: breakpoint can leave the editor too narrow for
	 * one line of columns. The rows then wrap under headings that stayed on one
	 * line. The headings and the rows' fixed widths have to follow the width of
	 * the list they sit in, through one container breakpoint.
	 */
	it('switches the headings and the row columns on the list width, not the window', () => {
		setup();
		const head = header();
		expect(head.parentElement?.classList.contains('@container')).toBe(true);
		expect(head.classList.contains('@xl:flex')).toBe(true);
		const variants = [...fieldRow('title'), ...lockedRow('id')]
			.flatMap((c) => [...c.classList])
			.filter((k) => /^[a-z@0-9]+:(w-|block|hidden|justify-)/.test(k))
			.map((k) => k.split(':')[0]);
		expect(variants.length).toBeGreaterThan(0);
		expect(new Set(variants)).toEqual(new Set(['@xl']));
	});

	it('keeps the columns in place for a reader who cannot remove a field', () => {
		setup({ canWrite: false });
		const heads = widths([...header().children]);
		expect(widths(fieldRow('title'))).toEqual(heads);
	});
});
