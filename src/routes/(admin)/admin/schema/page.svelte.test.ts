// @vitest-environment jsdom
import { render, cleanup, fireEvent, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import type { PageData } from './$types';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));
const state = vi.hoisted(() => ({ page: { url: new URL('http://localhost/admin/schema') } }));
vi.mock('$app/state', () => state);
vi.mock('$app/navigation', () => ({ beforeNavigate: vi.fn(), goto: vi.fn(async () => {}), invalidateAll: vi.fn(async () => {}) }));

// The builder is tested as a build without the diagram, whatever the tree
// carries. A case that needs the page's side of the diagram sets the flag.
const seam = vi.hoisted(() => ({ diagram: false, canvas: null as unknown }));
vi.mock('$lib/canvas/schema', () => ({
	get SchemaCanvas() {
		return seam.canvas;
	},
	get hasSchemaCanvas() {
		return seam.diagram;
	},
}));

import SchemaPage from './+page.svelte';
import { outlineSkips } from '$lib/test-outline';

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

// Each case renders the whole page, and the first one in the file also pays
// for warming the worker: about 430 ms run alone against 100 ms for the next,
// and 1.2 to 1.8 s in a full suite. On a machine busy with other work the
// first case took 5.9 s and failed at the 5 s default. Fifteen seconds is
// about eight times a full-suite run and still ends a case that hangs.
vi.setConfig({ testTimeout: 15_000 });

/**
 * The page reads only the entitlements, the schema list and the row counts, so
 * the fixture carries those and is asserted against PageData once.
 *
 * Every field carries an id. The page mints one for a field that arrives
 * without, and svelte-dnd-action needs a stable id per item to keep a row under
 * the pointer while the list reorders.
 */
/** The kit's copy control: the frame that holds the button, its tooltip and its live region. */
function copyFrame(button: HTMLElement): HTMLElement {
	let node = button.parentElement;
	while (node && !node.querySelector(':scope > [aria-live="polite"]')) node = node.parentElement;
	return node!;
}

function data(overrides: Record<string, unknown> = {}): PageData {
	return {
		entitlements: { plan: 'example', state: 'active', features: ['schema'], tenant_quota: 1 },
		schemas: [
			{
				name: 'posts',
				display_name: 'Posts',
				with_created_at: true,
				fields: [
					{ id: 'f-title', name: 'title', field_type: 'text', required: true, unique: false, indexed: false },
					{ id: 'f-created', name: 'created_at', field_type: 'datetime', required: false, unique: false, indexed: false, system: true },
				],
			},
			{ name: 'authors', display_name: 'Authors', fields: [] },
		],
		rowCounts: { posts: 12 },
		presets: [],
		presetsGate: null,
		canWrite: true,
		loadGate: null,
		...overrides,
	} as unknown as PageData;
}

/**
 * Picks a row in one of the kit's listboxes.
 *
 * The pickers are not native selects, so `change` on the element sets
 * nothing: the trigger is a button and the rows only exist while it is open.
 */
async function pickOption(trigger: HTMLElement, label: string | RegExp) {
	await fireEvent.click(trigger);
	await fireEvent.click(screen.getByRole('option', { name: label }));
}

async function pickType(field: string, type: string) {
	await pickOption(screen.getByRole('combobox', { name: `Type, ${field}` }), type);
}

async function openPosts(overrides: Record<string, unknown> = {}) {
	const view = render(SchemaPage, { props: { data: data(overrides), form: null } });
	await fireEvent.click(screen.getByRole('button', { name: 'Posts' }));
	return view;
}

describe('schema builder field rows', () => {
	it('names each row box by its column heading and its field', async () => {
		await openPosts();

		expect(screen.getByRole('checkbox', { name: 'Required, title' })).toBeTruthy();
		expect(screen.getByRole('checkbox', { name: 'Indexed, title' })).toBeTruthy();
	});

	it('names each row picker by what it sets and the field it belongs to', async () => {
		await openPosts();

		// The kit's listbox, not a native select: the trigger is a button that
		// carries the combobox role and shows the value as its own text.
		const type = screen.getByRole('combobox', { name: 'Type, title' });
		expect(type.tagName).toBe('BUTTON');
		expect(type.textContent).toContain('text');
	});

	it('carries the required state of the field into its box', async () => {
		await openPosts();

		const required = screen.getByRole('checkbox', { name: 'Required, title' }) as HTMLInputElement;
		const indexed = screen.getByRole('checkbox', { name: 'Indexed, title' }) as HTMLInputElement;
		expect(required.checked).toBe(true);
		expect(indexed.checked).toBe(false);
	});

	it('offers the relation pickers only for a relation field', async () => {
		await openPosts();

		expect(screen.queryByRole('combobox', { name: 'Target content type' })).toBeNull();

		await pickType('title', 'relation');

		// A relation saved with no type is a relation to nothing, so the field
		// takes the kind its picker already reads as.
		expect(screen.getByRole('radio', { name: 'Belongs to one' }).getAttribute('aria-checked')).toBe('true');
		expect(screen.getByRole('combobox', { name: 'Target content type' })).toBeTruthy();
	});
});

describe('schema builder relation panel', () => {
	it('says which table the relation writes and what saving it creates', async () => {
		await openPosts();
		await pickType('title', 'relation');
		await pickOption(screen.getByRole('combobox', { name: 'Target content type' }), 'Authors');

		// The engine derives the column from the field name and the table from
		// the schema name, so the panel has to spell both or it is guidance the
		// reader cannot check.
		expect(screen.getByText('Many Posts rows point at one Authors row.')).toBeTruthy();
		expect(screen.getByText('_posts.title_id')).toBeTruthy();
		expect(screen.getByText(/Column title_id on _posts/)).toBeTruthy();
	});

	it('reports an inverse relation the other schema cannot answer', async () => {
		// has_many is read through a column named after THIS schema on the other
		// table. Nothing in the row that declares it can show whether that column
		// exists, which is the whole reason the check is here.
		await openPosts();
		await pickType('title', 'relation');
		await fireEvent.click(screen.getByRole('radio', { name: 'Has many' }));
		await pickOption(screen.getByRole('combobox', { name: 'Target content type' }), 'Authors');

		expect(screen.getByTestId('relation-problems')).toBeTruthy();
		expect(screen.getAllByText(/_authors\.posts_id does not exist/).length).toBeGreaterThan(0);
	});

	it('flags nothing while the schema has no relation field', async () => {
		await openPosts();
		expect(screen.queryByTestId('relation-problems')).toBeNull();
	});

	it('offers one way to start a schema, in the page header', async () => {
		// The page header is where every page keeps its primary action, not
		// beside the filter or in the canvas toolbar.
		const { container } = render(SchemaPage, { props: { data: data(), form: null } });
		const buttons = screen.getAllByRole('button', { name: 'New content type' });
		expect(buttons).toHaveLength(1);
		expect(container.querySelector('aside')?.contains(buttons[0])).toBe(false);
	});

	it('folds the list to its header below lg once a schema is open, and brings it back', async () => {
		render(SchemaPage, { props: { data: data(), form: null } });
		expect(screen.queryByRole('button', { name: 'Show the list' })).toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: 'Posts' }));
		const rail = document.getElementById('schema-rail') as HTMLElement;
		expect(rail.className).toContain('max-lg:hidden');
		const show = screen.getByRole('button', { name: 'Show the list' });
		expect(show.getAttribute('aria-expanded')).toBe('false');
		await fireEvent.click(show);
		expect(rail.className).not.toContain('max-lg:hidden');
		expect(screen.getByRole('button', { name: 'Hide the list' }).getAttribute('aria-expanded')).toBe('true');
		await fireEvent.click(screen.getByRole('button', { name: 'Authors' }));
		expect(rail.className).toContain('max-lg:hidden');
	});

	it('moves focus to the list toggle when a pick below lg folds the list away', async () => {
		vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }));
		try {
			render(SchemaPage, { props: { data: data(), form: null } });
			const pick = screen.getByRole('button', { name: 'Posts' });
			pick.focus();
			await fireEvent.click(pick);
			await tick();
			await tick();
			expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Show the list' }));
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it('leaves focus on the list button when the list stays beside the editor', async () => {
		vi.stubGlobal('matchMedia', (query: string) => ({ matches: true, media: query, addEventListener() {}, removeEventListener() {} }));
		try {
			render(SchemaPage, { props: { data: data(), form: null } });
			const pick = screen.getByRole('button', { name: 'Posts' });
			pick.focus();
			await fireEvent.click(pick);
			await tick();
			await tick();
			expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Posts' }));
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it('opens another content type on its definition, whichever tab the last one showed', async () => {
		// The tab is held by the page, so without a reset a type opened after
		// the API tab, or a new type once it is saved, hid its fields behind it.
		await openPosts();
		await fireEvent.click(screen.getByRole('tab', { name: 'API' }));
		expect(screen.getByRole('tab', { name: 'API' }).getAttribute('aria-selected')).toBe('true');
		await fireEvent.click(screen.getByRole('button', { name: 'Authors' }));
		await tick();
		expect(screen.getByRole('tab', { name: 'Definition' }).getAttribute('aria-selected')).toBe('true');
	});

	it('shows the selected collection its own API, with a request to copy', async () => {
		await openPosts();
		await fireEvent.click(screen.getByRole('tab', { name: 'API' }));
		const paths = screen.getAllByText(/^\/api\/v1\/content\/posts/);
		expect(paths.length).toBeGreaterThanOrEqual(6);
		expect(screen.queryByText(/\{schema\}/)).toBeNull();
		expect(screen.getByRole('button', { name: 'curl', description: 'Copy a curl request for POST /api/v1/content/posts' })).toBeTruthy();
	});

	it('copies a collection request and confirms for a second and a half', async () => {
		const writeText = vi.fn(async (_text: string) => {});
		Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
		await openPosts();
		await fireEvent.click(screen.getByRole('tab', { name: 'API' }));
		vi.useFakeTimers();
		const copy = screen.getByRole('button', { name: 'curl', description: 'Copy a curl request for POST /api/v1/content/posts' });
		const status = copyFrame(copy).querySelector('[aria-live="polite"]')!;

		await fireEvent.click(copy);
		await vi.advanceTimersByTimeAsync(0);
		expect(writeText).toHaveBeenCalledTimes(1);
		expect(writeText.mock.calls[0][0]).toContain('/api/v1/content/posts');
		expect(status.textContent).toBe('Copied');

		await vi.advanceTimersByTimeAsync(1500);
		expect(status.textContent).toBe('');
	});

	it('shows a tooltip on a collection request copy control', async () => {
		await openPosts();
		await fireEvent.click(screen.getByRole('tab', { name: 'API' }));
		const description = 'Copy a curl request for POST /api/v1/content/posts';
		const button = screen.getByRole('button', { name: 'curl', description });
		expect(copyFrame(button).textContent).toContain(description);
		// The name is the word on the button, so the tooltip, which names the
		// route, is read as its description.
		expect(button.hasAttribute('aria-describedby')).toBe(true);
	});

	it('turns off the boxes that do nothing for a relation', async () => {
		// Idx on a relation would index a column that does not exist and fail
		// the save. Req on an inverse kind has no column to make NOT NULL.
		await openPosts();
		const req = () => screen.getByRole('checkbox', { name: 'Required, title' }) as HTMLInputElement;
		const idx = () => screen.getByRole('checkbox', { name: 'Indexed, title' }) as HTMLInputElement;
		expect(req().disabled).toBe(false);
		expect(idx().disabled).toBe(false);

		await pickType('title', 'relation');
		expect(req().disabled).toBe(false);
		expect(idx().disabled).toBe(true);

		await fireEvent.click(screen.getByRole('radio', { name: 'Has many' }));
		expect(req().disabled).toBe(true);
		expect(req().checked).toBe(false);
	});

	it('turns off Idx for a json field and clears it', async () => {
		// MySQL refuses an index on a JSON column and SQL Server cannot key
		// one, so the engine refuses the save. The box says so first.
		await openPosts();
		const idx = () => screen.getByRole('checkbox', { name: 'Indexed, title' }) as HTMLInputElement;
		await fireEvent.click(idx());
		expect(idx().checked).toBe(true);

		await pickType('title', 'json');
		expect(idx().disabled).toBe(true);
		expect(idx().checked).toBe(false);

		await pickType('title', 'text');
		expect(idx().disabled).toBe(false);
	});

	it('adds a relation already typed, with its panel open', async () => {
		// One click has to land the operator in front of the target picker,
		// without a trip through the type picker.
		await openPosts();
		expect(screen.queryByRole('combobox', { name: 'Target content type' })).toBeNull();

		await fireEvent.click(screen.getByRole('button', { name: 'Add relation' }));

		expect(screen.getByRole('radio', { name: 'Belongs to one' }).getAttribute('aria-checked')).toBe('true');
		expect(screen.getByRole('combobox', { name: 'Target content type' })).toBeTruthy();
	});

	it('says how to add one before it says what the kinds do', async () => {
		await openPosts();
		await fireEvent.click(screen.getByRole('button', { name: /How relations work/ }));

		const lead = screen.getByText(/set any field's type to/);
		const table = screen.getByRole('table');
		expect(lead.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
	});
});

describe('schema builder system columns', () => {
	it('removes a column at once and reads the change as unsaved', async () => {
		await openPosts();
		await fireEvent.click(screen.getByRole('button', { name: /Table settings/ }));
		const box = screen.getByRole('checkbox', { name: 'created_at' }) as HTMLInputElement;
		await fireEvent.click(box);
		expect(box.checked).toBe(false);
		expect(screen.getByText('Unsaved changes')).toBeTruthy();
	});

	it('reads as saved again once the box is put back', async () => {
		await openPosts();
		await fireEvent.click(screen.getByRole('button', { name: /Table settings/ }));
		const box = screen.getByRole('checkbox', { name: 'created_at' }) as HTMLInputElement;
		await fireEvent.click(box);
		await fireEvent.click(box);
		expect(screen.getByText('Saved')).toBeTruthy();
	});
});

describe('schema builder saving', () => {
	it('sends a renamed field as a rename, not as a new column', async () => {
		const { container } = await openPosts();
		await fireEvent.input(screen.getByRole('textbox', { name: 'Field name' }), { target: { value: 'headline' } });
		const renames = container.querySelector('form[action="?/save"] input[name="renames"]') as HTMLInputElement;
		expect(JSON.parse(renames.value)).toEqual([{ from: 'title', to: 'headline' }]);
		const original = container.querySelector('form[action="?/save"] input[name="original"]') as HTMLInputElement;
		expect(original.value).toBe('posts');
	});

	it('names what blocks a save and keeps Save off until it is fixed', async () => {
		await openPosts();
		await fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
		expect(screen.getByRole('button', { name: /1 problem/ })).toBeTruthy();
		expect((screen.getByRole('button', { name: /^Save/ }) as HTMLButtonElement).disabled).toBe(true);
		await fireEvent.click(screen.getByRole('button', { name: /1 problem/ }));
		const list = screen.getByTestId('schema-problems');
		expect(list.textContent).toContain('New text field, row 2');
		expect(list.textContent).toContain('Enter a field name.');
	});

	it('takes the reader from a problem to the control that fixes it', async () => {
		await openPosts();
		await fireEvent.click(screen.getByRole('button', { name: 'Add relation' }));
		await fireEvent.click(screen.getByRole('button', { name: /2 problems/ }));
		const list = screen.getByTestId('schema-problems');
		expect(list.textContent).toContain('New relation field, row 2');
		expect(list.textContent).toContain('Pick the content type this relation points at.');
		await fireEvent.click(screen.getByRole('button', { name: /Pick the content type this relation points at/ }));
		await new Promise((r) => setTimeout(r, 0));
		expect(screen.queryByTestId('schema-problems')).toBeNull();
		expect(document.activeElement?.id).toMatch(/^relation-target-/);
		expect(document.activeElement?.getAttribute('aria-invalid')).toBe('true');
	});

	it('shows the Definition tab before it takes the reader to a problem', async () => {
		await openPosts();
		await fireEvent.click(screen.getByRole('button', { name: 'Add relation' }));
		await fireEvent.click(screen.getByRole('tab', { name: 'API' }));
		expect(screen.queryByRole('button', { name: 'Add relation' })).toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: /2 problems/ }));
		await fireEvent.click(screen.getByRole('button', { name: /Pick the content type this relation points at/ }));
		await new Promise((r) => setTimeout(r, 0));
		expect(screen.getByRole('tab', { name: 'Definition' }).getAttribute('aria-selected')).toBe('true');
		expect(document.activeElement?.id).toMatch(/^relation-target-/);
	});

	it('disables Save with nothing to save, as the flow editor does', async () => {
		await openPosts();
		expect((screen.getByRole('button', { name: /^Save/ }) as HTMLButtonElement).disabled).toBe(true);
		await fireEvent.input(screen.getByRole('textbox', { name: 'Field name' }), { target: { value: 'headline' } });
		expect((screen.getByRole('button', { name: /^Save/ }) as HTMLButtonElement).disabled).toBe(false);
	});

	it('undoes an edit back to the saved state', async () => {
		await openPosts();
		await fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
		expect(screen.getAllByRole('textbox', { name: 'Field name' })).toHaveLength(2);
		await fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
		expect(screen.getAllByRole('textbox', { name: 'Field name' })).toHaveLength(1);
		expect(screen.getByText('Saved')).toBeTruthy();
	});

	it('moves a saved table only through Rename', async () => {
		await openPosts();
		const name = screen.getByLabelText('Machine name') as HTMLInputElement;
		expect(name.readOnly).toBe(true);
		expect(screen.getByRole('button', { name: /Rename/ })).toBeTruthy();
	});
});

describe('schema builder for a role that cannot write', () => {
	it('shows the definitions without a control that ends in a 403', async () => {
		render(SchemaPage, { props: { data: data({ canWrite: false }), form: null } });
		expect(screen.queryByRole('button', { name: /New content type/ })).toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: 'Posts' }));
		expect(screen.queryByRole('button', { name: /^Save/ })).toBeNull();
		expect(screen.queryByRole('button', { name: 'Add field' })).toBeNull();
		expect((screen.getByRole('textbox', { name: 'Field name' }) as HTMLInputElement).closest('fieldset')?.disabled).toBe(true);
		expect(screen.getByText(/Changing one needs the admin or super_admin role/)).toBeTruthy();
	});
});

describe('schema builder localization flag', () => {
	it('offers no localization box for a schema that does not carry it', async () => {
		await openPosts();
		expect(screen.queryByRole('checkbox', { name: /localization/ })).toBeNull();
	});

	it('offers none for a new schema either', async () => {
		render(SchemaPage, { props: { data: data(), form: null } });
		await fireEvent.click(screen.getByRole('button', { name: /New content type/ }));
		expect(screen.getByRole('checkbox', { name: 'created_at' })).toBeTruthy();
		expect(screen.queryByRole('checkbox', { name: /localization/ })).toBeNull();
	});

	it('shows the flag read-only on a schema that carries it', async () => {
		const view = render(SchemaPage, {
			props: {
				data: data({
					schemas: [{ name: 'pages', display_name: 'Pages', with_localization: true, fields: [] }],
				}),
				form: null,
			},
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Pages' }));
		const box = screen.getByRole('checkbox', { name: /localization/ }) as HTMLInputElement;
		expect(box.checked).toBe(true);
		expect(box.disabled).toBe(true);
		expect(view.container.textContent).toContain('Not used. Translations are stored per entry and locale.');
		// The planned column stays listed with a note that nothing reads it, so
		// nobody takes the row for a column in use.
		expect(screen.getByText('_locale')).toBeTruthy();
		expect(view.container.textContent).toContain('This column is not used.');
	});
});

describe('schema builder rail', () => {
	it('narrows the list to the schemas that match the filter', async () => {
		render(SchemaPage, { props: { data: data(), form: null } });

		await fireEvent.input(screen.getByPlaceholderText('Filter content types'), {
			target: { value: 'auth' },
		});

		expect(screen.getByRole('button', { name: 'Authors' })).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Posts' })).toBeNull();
	});

	it('offers a way out when the filter matches nothing', async () => {
		render(SchemaPage, { props: { data: data(), form: null } });

		await fireEvent.input(screen.getByPlaceholderText('Filter content types'), {
			target: { value: 'nothing' },
		});

		expect(screen.getByText('No content types match this filter.')).toBeTruthy();
	});
});

describe('schema builder drag zone', () => {
	it('keeps a keystroke aimed at a control out of the row that carries it', async () => {
		await openPosts();

		const name = screen.getByRole('textbox', { name: 'Field name' });
		const row = name.closest('[role="listitem"]');
		expect(row).not.toBeNull();

		// svelte-dnd-action listens on the row and reads Space as "pick this up".
		// The page stops the key on the element around the controls, so a row
		// listener of our own stands in for the library's here.
		let reached = 0;
		row?.addEventListener('keydown', () => (reached += 1));

		await fireEvent.keyDown(name, { key: ' ' });
		expect(reached).toBe(0);

		await fireEvent.keyDown(screen.getByRole('checkbox', { name: 'Required, title' }), { key: ' ' });
		expect(reached).toBe(0);

		// The row itself still hears the key, which is what makes a keyboard drag
		// possible at all.
		await fireEvent.keyDown(row as Element, { key: ' ' });
		expect(reached).toBe(1);
	});

	it('gives every draggable row a stable id', async () => {
		await openPosts();

		const name = screen.getByRole('textbox', { name: 'Field name' });
		expect(name.getAttribute('name')).toBe('field-name-f-title');
	});
});

/*
 * The shell's own 224px sidebar arrives at md:, and a list docked beside the
 * editor from there would leave it 256px at one pixel over the breakpoint. The
 * list stacks over the editor until lg:, and from there it is the shared
 * resizable aside at whatever width the viewer last gave it.
 */
describe('the content type list beside the editor', () => {
	function aside() {
		render(SchemaPage, { props: { data: data(), form: null } });
		return screen.getByTestId('schema-list');
	}

	it('stacks over the editor until lg: and docks at the remembered width from there', () => {
		const classes = aside().className.split(/\s+/);
		expect(classes).toContain('border-b');
		expect(classes).toContain('lg:border-b-0');
		expect(classes).toContain('lg:w-(--panel-w)');
		expect(classes.some((c) => /^(md|lg|xl):w-\d+$/.test(c))).toBe(false);
	});

	it('drags, locks and collapses like the flow editor\'s panels', () => {
		aside();
		expect(screen.getByTestId('schema-list-handle').getAttribute('aria-label')).toBe('Resize Content types');
		expect(screen.getByRole('button', { name: 'Lock Content types width' })).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Collapse Content types' })).toBeTruthy();
	});

	it('keeps the filter on the list it narrows, and draws no view switch without a diagram', () => {
		render(SchemaPage, { props: { data: data(), form: null } });
		expect(screen.getByTestId('schema-list').contains(screen.getByPlaceholderText('Filter content types'))).toBe(true);
		expect(screen.queryByRole('radio', { name: 'Canvas' })).toBeNull();
	});

	it('puts the view switch in the toolbar when the build carries a diagram', () => {
		seam.diagram = true;
		try {
			const { container } = render(SchemaPage, { props: { data: data(), form: null } });
			const toolbar = container.querySelector('[role="toolbar"]') as HTMLElement;
			expect(toolbar.contains(screen.getByRole('radio', { name: 'Canvas' }))).toBe(true);
			expect(toolbar.contains(screen.getByRole('radio', { name: 'List' }))).toBe(true);
		} finally {
			seam.diagram = false;
		}
	});
});

const presets = [
	{
		id: 'notes',
		name: 'Notes',
		description: 'Short notes on any content, with tags.',
		schemas: [
			{ name: 'notes', fields: [{ name: 'body', field_type: 'text', required: true, unique: false, indexed: false }] },
			{ name: 'note_tags', fields: [] },
		],
	},
	{
		id: 'surveys',
		name: 'Surveys',
		description: 'Survey definitions and the responses they collect.',
		schemas: [
			{ name: 'surveys', fields: [] },
			{ name: 'survey_responses', fields: [] },
		],
	},
];

describe('schema builder presets', () => {
	it('offers a preset from the empty state and lists what each one creates', async () => {
		render(SchemaPage, { props: { data: data({ schemas: [], rowCounts: {}, presets }), form: null } });

		expect(screen.getByText('No content types yet')).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Use a preset' }));

		expect(screen.getByRole('heading', { name: 'Notes' })).toBeTruthy();
		expect(screen.getByText('Short notes on any content, with tags.')).toBeTruthy();
		const created = screen.getByRole('list', { name: 'Content types Notes creates' });
		expect([...created.querySelectorAll('code')].map((c) => c.textContent)).toEqual(['notes', 'note_tags']);
		expect(screen.getAllByRole('button', { name: 'Create' })).toHaveLength(2);
		const form = screen.getAllByRole('button', { name: 'Create' })[1].closest('form');
		expect(form?.getAttribute('action')).toBe('?/preset');
		expect((form?.querySelector('input[name="id"]') as HTMLInputElement).value).toBe('surveys');
	});

	it('keeps the offer out of an empty state when the engine ships no presets', () => {
		render(SchemaPage, { props: { data: data({ schemas: [], rowCounts: {} }), form: null } });

		expect(screen.getByText('No content types yet')).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Use a preset' })).toBeNull();
		expect(screen.queryByRole('button', { name: 'Presets' })).toBeNull();
	});

	it('opens the gallery from the header when schemas exist', async () => {
		render(SchemaPage, { props: { data: data({ presets }), form: null } });

		await fireEvent.click(screen.getByRole('button', { name: 'Presets' }));
		expect(screen.getByRole('heading', { name: 'Surveys' })).toBeTruthy();
	});

	it('says why the gallery is empty when the presets could not be read', async () => {
		render(SchemaPage, {
			props: { data: data({ presetsGate: { state: 'unavailable' } }), form: null },
		});

		await fireEvent.click(screen.getByRole('button', { name: 'Presets' }));
		expect(screen.getByText(/so presets did not load/)).toBeTruthy();
		expect(screen.queryByText('No presets')).toBeNull();
		expect(screen.queryByRole('button', { name: 'Create' })).toBeNull();
	});

	it('shows a refusal under the preset it belongs to', async () => {
		render(SchemaPage, {
			props: {
				data: data({ presets }),
				form: { action: 'preset', error: 'schema notes already exists', preset: 'notes' },
			},
		});

		await fireEvent.click(screen.getByRole('button', { name: 'Presets' }));
		const [notes, surveys] = [...screen.getByTestId('preset-gallery').children];
		expect(notes.textContent).toContain('schema notes already exists');
		expect(surveys.textContent).not.toContain('already exists');
		// The drawer stays open: the refusal reads beside the card it names.
		expect(screen.getAllByRole('button', { name: 'Create' })).toHaveLength(2);
	});

	it('offers saving a preset only where the plugin accepts one', async () => {
		render(SchemaPage, { props: { data: data({ presets, canSavePresets: false }), form: null } });
		await fireEvent.click(screen.getByRole('button', { name: 'Presets' }));
		expect(screen.getByTestId('preset-save-locked')).toBeTruthy();
		expect(screen.queryByText('Save a preset from a URL or a file')).toBeNull();
		cleanup();

		render(SchemaPage, { props: { data: data({ presets, canSavePresets: true }), form: null } });
		await fireEvent.click(screen.getByRole('button', { name: 'Presets' }));
		expect(screen.queryByTestId('preset-save-locked')).toBeNull();
		expect(screen.getByText('Save a preset from a URL or a file')).toBeTruthy();
	});

	it('names the schemas a preset created once they are in the list', async () => {
		render(SchemaPage, {
			props: {
				data: data({ presets }),
				form: { preset: 'notes', created: ['notes', 'note_tags'] },
			},
		});

		expect(await screen.findByText('Preset created')).toBeTruthy();
		expect(screen.getByText(/Created 2 content types: notes, note_tags/)).toBeTruthy();
	});
});

describe('schema builder rail at scale', () => {
	it('draws a page of schemas and offers the rest', async () => {
		const many = Array.from({ length: 150 }, (_, i) => ({ name: `s${i}`, display_name: `S${i}`, fields: [] }));
		render(SchemaPage, { props: { data: data({ schemas: many, rowCounts: {} }), form: null } });
		const rail = screen.getByTestId('schema-list');
		expect(rail.querySelectorAll('button[aria-label^="S"]')).toHaveLength(100);
		await fireEvent.click(screen.getByRole('button', { name: 'Show 50 more of 50' }));
		expect(rail.querySelectorAll('button[aria-label^="S"]')).toHaveLength(150);
	});

	it('paints the list before the row counts arrive, then shows them', async () => {
		let resolve!: (v: Record<string, number>) => void;
		const counts = new Promise<Record<string, number>>((r) => (resolve = r));
		render(SchemaPage, { props: { data: data({ rowCounts: counts }), form: null } });
		expect(screen.getByRole('button', { name: 'Posts' }).textContent).not.toMatch(/rows/);
		resolve({ posts: 12 });
		await counts;
		await new Promise((r) => setTimeout(r, 0));
		expect(screen.getByRole('button', { name: 'Posts' }).textContent).toMatch(/12 rows/);
	});
});

describe('schema builder history and transfer', () => {
	it('shows a saved table its history to a super admin only', async () => {
		const { unmount } = render(SchemaPage, { props: { data: data({ isSuperAdmin: true }), form: null } });
		await fireEvent.click(screen.getByRole('button', { name: 'Posts' }));
		expect(screen.getByRole('tab', { name: /History/ })).toBeTruthy();
		unmount();

		render(SchemaPage, { props: { data: data({ isSuperAdmin: false }), form: null } });
		await fireEvent.click(screen.getByRole('button', { name: 'Posts' }));
		expect(screen.queryByRole('tab', { name: /History/ })).toBeNull();
	});

	it('offers export to an admin and import to a super admin', async () => {
		const { unmount } = render(SchemaPage, { props: { data: data({ isSuperAdmin: false }), form: null } });
		await fireEvent.click(screen.getByRole('button', { name: 'Import and export' }));
		expect(screen.getByRole('menuitem', { name: /Export as YAML/ })).toBeTruthy();
		expect(screen.queryByRole('menuitem', { name: /^Import$/ })).toBeNull();
		unmount();

		render(SchemaPage, { props: { data: data({ isSuperAdmin: true }), form: null } });
		await fireEvent.click(screen.getByRole('button', { name: 'Import and export' }));
		await fireEvent.click(screen.getByRole('menuitem', { name: /^Import$/ }));
		expect(screen.getByRole('button', { name: 'Check' })).toBeTruthy();
		expect((screen.getByRole('button', { name: 'Check' }) as HTMLButtonElement).disabled).toBe(true);
	});
});

describe('schema builder localized mark', () => {
	function localizedTitle(overrides: Record<string, unknown> = {}) {
		const d = data();
		const posts = (d.schemas as unknown as { fields: Record<string, unknown>[] }[])[0];
		posts.fields[0] = { ...posts.fields[0], localized: true, ...overrides };
		return d;
	}

	async function openLocalizedPosts(overrides: Record<string, unknown> = {}) {
		render(SchemaPage, { props: { data: localizedTitle(overrides), form: null } });
		await fireEvent.click(screen.getByRole('button', { name: 'Posts' }));
	}

	const box = () => screen.getByRole('checkbox', { name: 'Translated per locale, title' }) as HTMLInputElement;

	it('clears the mark and says why when the type changes to one that cannot carry it', async () => {
		await openLocalizedPosts();
		expect(box().checked).toBe(true);

		await pickType('title', 'number');

		expect(box().checked).toBe(false);
		expect(box().disabled).toBe(true);
		expect(screen.getByText(/No longer translated per locale\. A number field/)).toBeTruthy();
	});

	it('keeps the mark and shows no note when the field stays localizable', async () => {
		await openLocalizedPosts();

		await pickType('title', 'rich_text');

		expect(box().checked).toBe(true);
		expect(box().disabled).toBe(false);
		expect(screen.queryByText(/No longer translated per locale/)).toBeNull();
	});

	it('drops the note once the field can carry the mark again', async () => {
		await openLocalizedPosts();
		await pickType('title', 'number');
		await pickType('title', 'text');

		expect(box().disabled).toBe(false);
		expect(screen.queryByText(/No longer translated per locale/)).toBeNull();
	});

	it('disables the box on a unique field and says it is a key', async () => {
		await openLocalizedPosts({ unique: true, localized: false });

		expect(box().disabled).toBe(true);
		expect(box().closest('[title]')?.getAttribute('title')).toContain('key');
	});
});

describe('schema builder failures stay with their action', () => {
	it('keeps a failed preset delete out of the cards that create', async () => {
		const saved = [{ ...presets[0], source: 'saved' }, presets[1]];
		render(SchemaPage, {
			props: {
				data: data({ presets: saved }),
				form: { action: 'deletePreset', error: 'The preset could not be deleted.', preset: saved[0].id },
			} as never,
		});

		await fireEvent.click(screen.getByRole('button', { name: 'Presets' }));
		const [first] = [...screen.getByTestId('preset-gallery').children];
		expect(first.textContent).not.toContain('could not be deleted');
		expect(screen.getByText('The preset could not be deleted.')).toBeTruthy();
	});
});

describe('schema builder read failures', () => {
	it('says the list could not be read and offers no new schema over it', () => {
		render(SchemaPage, {
			props: { data: data({ schemas: [], loadGate: { state: 'unavailable' } }), form: null },
		});
		expect(screen.getByText(/so content types did not load/)).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'New content type' })).toBeNull();
		expect(screen.queryByText('No content types yet')).toBeNull();
	});
});

describe('schema builder relation kind', () => {
	it('names the cardinality the short label leaves out', async () => {
		await openPosts();
		await pickType('title', 'relation');
		await pickOption(screen.getByRole('combobox', { name: 'Target content type' }), 'Authors');
		const facts = screen.getByTestId(/^relation-panel-/).querySelector('dl') as HTMLElement;
		expect(facts.textContent).toContain('Cardinality');
		expect(facts.textContent).toContain('many to one');
	});

	it('ties a problem with the kind to its radio group and focuses the chosen radio from the problem list', async () => {
		await openPosts();
		await pickType('title', 'relation');
		await fireEvent.click(screen.getByRole('radio', { name: 'Has many' }));
		await pickOption(screen.getByRole('combobox', { name: 'Target content type' }), 'Posts');
		await fireEvent.click(screen.getByRole('radio', { name: 'Belongs to one' }));

		const group = screen.getByRole('radiogroup', { name: 'Relation' });
		const describedBy = group.getAttribute('aria-describedby') ?? '';
		expect(document.getElementById(describedBy)?.textContent).toContain('has to be Has many');

		await fireEvent.click(screen.getByRole('button', { name: /problem/ }));
		const jump = [...document.querySelectorAll<HTMLButtonElement>('[data-problem]')].find((b) =>
			(b.textContent ?? '').includes('has to be Has many'),
		) as HTMLButtonElement;
		await fireEvent.click(jump);
		await new Promise((r) => setTimeout(r, 0));
		expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Belongs to one' }));
	});
});

describe('schema builder over a failed list read', () => {
	it('offers no import beside a list it could not read', async () => {
		render(SchemaPage, {
			props: { data: data({ schemas: [], isSuperAdmin: true, loadGate: { state: 'unavailable' } }), form: null },
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Import and export' }));
		expect(screen.getByRole('menuitem', { name: /Export as YAML/ })).toBeTruthy();
		expect(screen.queryByRole('menuitem', { name: /^Import$/ })).toBeNull();
	});

	it('says only that the role was refused when an editor cannot read the list', () => {
		render(SchemaPage, {
			props: { data: data({ schemas: [], canWrite: false, loadGate: { state: 'forbidden' } }), form: null },
		});
		expect(screen.getByText(/Your role cannot open content types/)).toBeTruthy();
		expect(screen.queryByText(/Your role can view content types/)).toBeNull();
	});
});

describe('schema builder transports', () => {
	it('lays out each transport as its four modes side by side', async () => {
		await openPosts();
		await fireEvent.click(screen.getByRole('button', { name: /Table settings/ }));
		const rest = screen.getByRole('radiogroup', { name: 'REST' });
		expect([...rest.querySelectorAll('[role=radio], input[type=radio]')].length).toBe(4);
		expect(screen.getByRole('radiogroup', { name: 'GraphQL' })).toBeTruthy();
		expect(screen.queryByRole('combobox', { name: 'REST' })).toBeNull();
		expect(document.getElementById(rest.getAttribute('aria-describedby') ?? '')?.textContent).toBe('The content API.');
	});
});

describe('heading outline', () => {
	// A collapsed list hides its header from lg up through the stylesheet,
	// which the test document does not apply, so the test hides it the same way.
	async function canvasWithListCollapsed(overrides: Record<string, unknown>) {
		const view = render(SchemaPage, { props: { data: data(overrides), form: null } });
		await fireEvent.click(screen.getByRole('radio', { name: 'Canvas' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Collapse Content types' }));
		for (const el of view.container.querySelectorAll('.lg\\:hidden')) el.setAttribute('hidden', '');
		return view;
	}

	for (const [state, overrides] of [
		['the license leaves the canvas out', { canvas: { licensed: false } }],
		['the canvas read is refused for the license', { canvasGate: { state: 'locked', upgradeUrl: '' } }],
	] as const) {
		it(`keeps the canvas notice one level under the title with the list collapsed when ${state}`, async () => {
			seam.diagram = true;
			seam.canvas = {};
			try {
				const { container } = await canvasWithListCollapsed(overrides);
				expect(container.querySelector('[data-testid="not-enabled"]')).toBeTruthy();
				expect(outlineSkips(container)).toEqual([]);
			} finally {
				seam.diagram = false;
				seam.canvas = null;
			}
		});
	}
});
