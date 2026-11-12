// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import EditorPage from './+page.svelte';
import type { Entitlements } from '$lib/entitlements';
import { blockedFlow, blockedRunError, fixtureCatalog, fixtureFlow, fixtureRun, fixtureTemplates, missingTypeErrors, respondingFlow, withLocked } from '$lib/flow/fixtures';
import { BLOCKED_TEXT } from '$lib/flow/blocked';
import { FOCUS_KEY } from '$lib/flow/prefs';
import { SHELL_KEY, type Shell } from '$lib/shell.svelte';
import { outlineSkips } from '$lib/test-outline';

vi.mock('$app/state', () => ({ page: { url: new URL('http://localhost/admin/flows/f1') } }));
vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));
const nav = vi.hoisted(() => ({ guard: null as null | ((n: unknown) => void), invalidateAll: vi.fn(async () => {}) }));
vi.mock('$app/navigation', () => ({
	beforeNavigate: vi.fn((fn: (n: unknown) => void) => {
		nav.guard = fn;
	}),
	goto: vi.fn(async () => {}),
	invalidateAll: nav.invalidateAll,
}));

// The instance the layout provides, so a refusal has a way to enable to name.
vi.mock('$lib/instance.svelte', async (importOriginal) => {
	const real = await importOriginal<typeof import('$lib/instance.svelte')>();
	const { licensingOf } = await import('$lib/api/license');
	const licensing = licensingOf({ links: [{ rel: 'upgrade', label: 'Turn it on', url: '/admin/settings/license' }], renew: true });
	return { ...real, useInstance: () => real.instanceFrom(() => ({ licensing })) };
});

// The kit's confirm renders through a container the layout mounts and this
// test does not, so the call is captured and answered here.
const kit = vi.hoisted(() => ({ confirm: vi.fn(async () => false) }));
vi.mock('@lyeve-labs/ui-kit', async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	confirm: kit.confirm,
}));

// The page is tested with the list editor whatever the build carries, so the
// suite reads the same with the visual editor mounted and without it. A case
// that needs the page's side of the visual editor sets the flag.
const seam = vi.hoisted(() => ({ visual: false }));
vi.mock('$lib/canvas/flow', async () => {
	const { default: FlowOutline } = await import('$lib/canvas/FlowOutline.svelte');
	return {
		FlowCanvas: FlowOutline,
		get hasFlowCanvas() {
			return seam.visual;
		},
	};
});

afterEach(cleanup);

const licensed: Entitlements = { plan: 'example', state: 'active', features: ['flow'], tenant_quota: 1 };

/** The debounced validate posts through fetch. The answer is recorded, never sent. */
function validFetch() {
	return vi.fn(async () =>
		new Response(JSON.stringify({ ok: true, errors: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
	);
}
/** The validate answers clean. A test run is refused with the given 422 body. */
function refusingTestFetch(body: unknown) {
	return vi.fn(async (url: string) => {
		const refused = String(url).endsWith('/test');
		return new Response(JSON.stringify(refused ? body : { ok: true, errors: [] }), {
			status: refused ? 422 : 200,
			headers: { 'content-type': 'application/json' },
		});
	});
}
let fetchMock: ReturnType<typeof validFetch> | ReturnType<typeof refusingTestFetch> = validFetch();
beforeEach(() => {
	kit.confirm.mockReset();
	kit.confirm.mockResolvedValue(false);
	fetchMock = validFetch();
	vi.stubGlobal('fetch', fetchMock);
	localStorage.clear();
});

/** The layout's half of the focus channel, so the page's ask can be read. */
function shellContext(): { shell: Shell; context: Map<symbol, Shell> } {
	const shell: Shell = { focus: false };
	return { shell, context: new Map([[SHELL_KEY, shell]]) };
}

function setup(form: unknown = null, overrides: Record<string, unknown> = {}, context?: Map<symbol, Shell>) {
	return render(EditorPage, {
		context,
		props: {
			data: {
				locked: false,
				flow: fixtureFlow,
				catalog: fixtureCatalog,
				catalogGate: { state: 'ok' },
				datasources: [{ id: 'd1', name: 'warehouse', kind: 'postgres' }],
				variables: ['region'],
				schemas: [],
				runs: { ok: true, value: { rows: [fixtureRun], limit: 20, offset: 0, total: 1, hasMore: false } },
				versions: { ok: true, value: [] },
				templates: fixtureTemplates,
				entitlements: licensed,
				assistant: 'ready',
				user: { roles: ['admin'] },
				...overrides,
			},
			form,
		} as never,
	});
}

const definitionField = (container: HTMLElement) =>
	JSON.parse((container.querySelector('#flow-save input[name="definition"]') as HTMLInputElement).value);

type Query = (role: string, options: { name: string | RegExp }) => HTMLElement;

/** Opens the toolbar's overflow menu and picks one of its items. */
async function pickOverflow(getByRole: Query, label: string) {
	await fireEvent.click(getByRole('button', { name: 'More actions' }));
	await fireEvent.click(getByRole('menuitem', { name: label }));
}

describe('flow editor page', () => {
	it('renders the palette grouped by category from the catalog, without the triggers', () => {
		const { getByTestId } = setup();
		const palette = getByTestId('node-palette');
		const groups = [...palette.querySelectorAll('section')].map((s) => s.getAttribute('aria-label'));
		expect(groups).toEqual(['Data', 'Transform', 'Control', 'Output', 'Email plugin']);
		expect(palette.querySelector('[data-node-type="content.query"]')).toBeTruthy();
		expect(palette.querySelector('[data-node-type="trigger.http"]')).toBeNull();
		expect(palette.querySelector('[data-node-type="note"]')).toBeTruthy();
	});

	it('filters the palette by the search text', async () => {
		const { getByTestId, getByLabelText } = setup();
		await fireEvent.input(getByLabelText('Filter node types'), { target: { value: 'join' } });
		const palette = getByTestId('node-palette');
		expect(palette.querySelectorAll('[data-node-type]')).toHaveLength(1);
		expect(palette.querySelector('[data-node-type="data.join"]')).toBeTruthy();
	});

	it('draws the fixture flow and shows the flow settings while nothing is selected', () => {
		const { getByTestId, container } = setup();
		expect(getByTestId('flow-outline').querySelectorAll('[data-node-id]')).toHaveLength(4);
		const inspector = getByTestId('flow-inspector');
		expect(inspector.textContent).toContain('Trigger type');
		expect(inspector.textContent).toContain('Run timeout');
		expect(inspector.textContent).toContain('vars.region');
		expect(container.querySelector('#flow-save input[name="name"]')).toBeTruthy();
	});

	it('renders a flow with a response node although its spec lists no outputs', () => {
		const { getByTestId } = setup(null, { flow: { ...fixtureFlow, draft: respondingFlow } });
		const canvas = getByTestId('flow-outline');
		expect(canvas.querySelectorAll('[data-node-id]')).toHaveLength(5);
		expect(canvas.querySelector('[data-node-id="respond"]')).toBeTruthy();
	});

	it('renders the selected node\'s form from its schema and writes edits into the definition', async () => {
		const { getByTestId, container } = setup();
		const header = getByTestId('flow-outline').querySelector('[data-node-id="join"] button') as HTMLElement;
		await fireEvent.click(header);

		const inspector = getByTestId('flow-inspector');
		expect(inspector.textContent).toContain('data.join');
		const leftKey = inspector.querySelector('#node-join-left_key') as HTMLInputElement;
		expect(leftKey.value).toBe('id');
		expect(inspector.querySelector('#node-join-how')).toBeTruthy();

		await fireEvent.input(leftKey, { target: { value: 'order_number' } });
		const name = inspector.querySelector('#node-name') as HTMLInputElement;
		await fireEvent.input(name, { target: { value: 'Join orders' } });

		const def = definitionField(container);
		const join = def.nodes.find((n: { id: string }) => n.id === 'join');
		expect(join.config.left_key).toBe('order_number');
		expect(join.name).toBe('Join orders');
		expect(container.textContent).toContain('Unsaved changes');
	});

	it('reseeds the canvas from the draft a rollback answered with', () => {
		const draft = { ...fixtureFlow.draft!, name: 'Rolled back', nodes: fixtureFlow.draft!.nodes.slice(0, 1), edges: [] };
		const { container, getByTestId } = setup({
			reloaded: { draft, status: 'draft', version: 1, updated_at: '2026-09-02T00:00:00Z', name: 'Rolled back', slug: 'x' },
		});
		expect(definitionField(container).name).toBe('Rolled back');
		expect(getByTestId('flow-outline').querySelectorAll('[data-node-id]')).toHaveLength(2);
		expect(container.textContent).toContain('v1');
		expect(container.textContent).not.toContain('Unsaved changes');
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('posts an import to its own route with the flow slug', async () => {
		const { container, getByRole } = setup();
		await pickOverflow(getByRole, 'Import');
		const form = container.querySelector('[role="dialog"] form') as HTMLFormElement;
		expect(form.getAttribute('action')).toBe('?/import');
		expect((form.querySelector('[name="slug"]') as HTMLInputElement).value).toBe(fixtureFlow.slug);
	});

	// The import drawer and the rest of the editor share one form result.
	it('keeps a failed save out of the import drawer opened after it', async () => {
		const { container, getByRole } = setup({ error: 'Enter a name for the flow.' });
		expect(container.textContent).toContain('Enter a name for the flow.');
		await pickOverflow(getByRole, 'Import');
		const form = container.querySelector('#flow-import-form') as HTMLFormElement;
		expect(form.textContent).not.toContain('Enter a name for the flow.');
	});

	it('shows a failed import inside the import drawer and not above the canvas', async () => {
		const { container, getByRole, rerender } = setup();
		await pickOverflow(getByRole, 'Import');
		await rerender({ form: { action: 'import', error: 'Paste a definition or choose a file.' } } as never);
		const form = container.querySelector('#flow-import-form') as HTMLFormElement;
		expect(form.textContent).toContain('Paste a definition or choose a file.');
		expect(document.body.textContent?.split('Paste a definition or choose a file.').length).toBe(2);
	});

	// The notice above the canvas leaves an import's refusal to the drawer, so
	// the way to enable it is drawn there.
	it('names the way to enable a refused import inside the import drawer', async () => {
		const { container, getByRole, rerender } = setup();
		await pickOverflow(getByRole, 'Import');
		await rerender({
			form: { action: 'import', error: '7 of 7 flows are in use, the most this instance keeps.', refusal: { nodeIds: [], limit: 7, current: 7 } },
		} as never);
		const form = container.querySelector('#flow-import-form') as HTMLFormElement;
		expect(form.textContent).toContain('7 of 7 flows are in use');
		expect(form.querySelector('a[href="/admin/settings/license"]')?.textContent).toContain('Turn it on');
	});

	it('validates the draft 500 ms after a change through the flow endpoint', async () => {
		vi.useFakeTimers();
		try {
			const { container } = setup();
			const name = container.querySelector('#flow-name') as HTMLInputElement;
			await fireEvent.input(name, { target: { value: 'Renamed' } });
			expect(fetchMock).not.toHaveBeenCalled();
			await vi.advanceTimersByTimeAsync(600);
			expect(fetchMock).toHaveBeenCalledTimes(1);
			const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
			expect(url).toBe('/api/admin/flows/f1/validate');
			expect(init.method).toBe('POST');
			expect(JSON.parse(String(init.body)).name).toBe('Renamed');
		} finally {
			vi.useRealTimers();
		}
	});

	it('shows a run\'s steps in the Test tab with the failed step open', () => {
		const { getByTestId } = setup({ run: fixtureRun });
		const viewer = getByTestId('run-viewer');
		const steps = viewer.querySelectorAll('li');
		expect(steps).toHaveLength(3);
		expect(steps[2].textContent).toContain('join');
		expect(steps[2].textContent).toContain('failed');
		expect(viewer.textContent).toContain('right_key missing on 3 rows');
		expect(viewer.querySelector('[aria-pressed="true"]')?.textContent).toContain('join');
		expect([...viewer.querySelectorAll('h3')].map((h) => h.textContent?.trim())).toEqual(['Input', 'Output']);
		// The failing step's status is painted on its canvas node.
		expect(getByTestId('flow-outline').querySelector('[data-node-id="join"]')?.textContent).toContain('failed');
	});

	it('collapses the drawer from a kit button', async () => {
		const { getByLabelText, getByTestId } = setup();
		const toggle = getByLabelText('Collapse drawer');
		// Every kit control carries the kit's touch class, and the raw-button rule
		// refuses a hand-styled copy of a kit button.
		expect(toggle.className).toContain('coarse:min-h-control');
		await fireEvent.click(toggle);
		expect(getByTestId('editor-drawer').style.height).toBe('');
	});

	it('collapses a palette category and reopens it for a search', async () => {
		const { getByTestId, getByRole, getByLabelText } = setup();
		const palette = getByTestId('node-palette');
		await fireEvent.click(getByRole('button', { name: /^Data/ }));
		expect(getByRole('button', { name: /^Data/ }).getAttribute('aria-expanded')).toBe('false');
		await fireEvent.input(getByLabelText('Filter node types'), { target: { value: 'query' } });
		expect(getByRole('button', { name: /^Data/ }).getAttribute('aria-expanded')).toBe('true');
		expect(palette.querySelector('[data-node-type="content.query"]')).toBeTruthy();
	});

	it('keeps the keyboard hints behind the overflow menu', async () => {
		const { queryByTestId, getByRole } = setup();
		expect(queryByTestId('keyboard-hints')).toBeNull();
		await pickOverflow(getByRole, 'Shortcuts');
		expect(queryByTestId('keyboard-hints')?.textContent).toContain('remove the selection');
	});

	it('keeps the toolbar to the way back, the shortcuts, a menu, the name, the status, focus, delete and three actions', () => {
		const { getByRole, queryByRole, getByTestId } = setup();
		const toolbar = getByRole('toolbar', { name: 'Flow editor' });
		const names = [...toolbar.querySelectorAll('button')].map((b) => b.getAttribute('aria-label') ?? b.textContent?.trim());
		expect(names).toEqual(['More actions', 'Node palette', 'Inspector', 'Focus mode', 'Delete flow', 'Test', 'Save', 'Publish']);
		// The layout, file and guide actions sit behind the one menu.
		expect(queryByRole('button', { name: 'Auto layout' })).toBeNull();
		expect(queryByRole('button', { name: 'Export' })).toBeNull();
		expect(getByTestId('flow-status').textContent).toContain('Draft');
		expect(toolbar.textContent).not.toContain('unpublished');
		expect(toolbar.textContent).not.toContain('valid');
	});

	it('lists the file and help actions in the overflow menu, and no layout action for the list editor', async () => {
		const { getByRole, getAllByRole } = setup();
		await fireEvent.click(getByRole('button', { name: 'More actions' }));
		// The lifecycle is in the toolbar.
		expect(getAllByRole('menuitem').map((m) => m.textContent?.trim())).toEqual([
			'Use a template',
			'Import',
			'Export',
			'Shortcuts',
			'Guide',
		]);
	});

	it('draws no datasource or variable shortcut for a role those routes refuse', () => {
		const { queryByTestId } = setup(null, { user: { roles: ['editor'] } });
		expect(queryByTestId('flow-datasources')).toBeNull();
		expect(queryByTestId('flow-variables')).toBeNull();
	});

	it('links the datasources and variables from the toolbar, carrying the way back to this flow', () => {
		const { getByTestId } = setup();
		expect(getByTestId('flow-datasources').getAttribute('href')).toBe('/admin/flows/datasources?flow=f1');
		expect(getByTestId('flow-datasources').getAttribute('aria-label')).toBe('Datasources');
		expect(getByTestId('flow-variables').getAttribute('href')).toBe('/admin/flows/variables?flow=f1');
	});

	it('deletes the flow from an icon in the danger tone, behind a confirmation', async () => {
		// A text button at the foot of the inspector would read as part of the
		// versions list above it.
		const { getByRole, queryByTestId } = setup();
		expect(queryByTestId('flow-inspector')?.textContent ?? '').not.toContain('Delete flow');
		const remove = getByRole('button', { name: 'Delete flow' });
		expect(remove.className).toContain('text-danger');
		const form = document.querySelector('form[action="?/delete"]') as HTMLFormElement;
		const submit = vi.spyOn(form, 'requestSubmit').mockImplementation(() => {});

		kit.confirm.mockResolvedValueOnce(false);
		await fireEvent.click(remove);
		await tick();
		// The title names the flow. The body says what the delete takes with it.
		expect(kit.confirm).toHaveBeenCalledWith(`Delete flow ${fixtureFlow.name}?`, expect.stringContaining('run history'), { confirmLabel: 'Delete' });
		expect(submit).not.toHaveBeenCalled();

		kit.confirm.mockResolvedValueOnce(true);
		await fireEvent.click(remove);
		await tick();
		expect(submit).toHaveBeenCalled();
	});

	it('names the save state beside the status, as the schema builder does', async () => {
		const { container, getByTestId } = setup();
		const status = getByTestId('flow-status');
		const text = () => status.textContent?.replace(/\s+/g, ' ').trim();
		expect(text()).toBe('orders_with_shipments Draft Saved');
		const name = container.querySelector('#flow-name') as HTMLInputElement;
		await fireEvent.input(name, { target: { value: 'Renamed' } });
		expect(text()).toBe('orders_with_shipments Draft Unsaved changes');
	});

	it('names the published version in the pill and keeps Publish live over unsaved changes', async () => {
		const { container, getByTestId, getByRole } = setup(null, { flow: { ...fixtureFlow, status: 'active', version: 2 } });
		expect(getByTestId('flow-status').textContent).toContain('Published v2');
		await fireEvent.input(container.querySelector('#flow-name') as HTMLInputElement, { target: { value: 'Renamed' } });
		expect(getByTestId('flow-status').textContent).toContain('Unsaved changes');
		expect((getByRole('button', { name: 'Publish' }) as HTMLButtonElement).disabled).toBe(false);
		expect(getByRole('button', { name: 'Disable flow' }).className).toContain('text-danger');
		expect(container.querySelector('form#flow-disable')?.getAttribute('action')).toBe('?/disable');
	});

	it('shows the problem count only while the draft is invalid, and opens the problems list from it', async () => {
		const { getByRole, queryByRole, getByTestId, queryByTestId, container } = setup({
			errors: [
				{ node_id: 'join', path: '/config/left_key', message: 'required' },
				{ path: '/settings/timeout', message: 'not a duration' },
			],
		});
		expect(queryByTestId('flow-problems')).toBeNull();
		expect(container.querySelector('[data-node-id="join"]')?.className).toContain('border-danger');
		await fireEvent.click(getByRole('button', { name: '2 problems' }));
		const list = getByTestId('flow-problems');
		// Where, in the words the canvas uses, and what, as one sentence.
		expect(list.textContent).toContain('Join');
		expect(list.textContent).toContain('Left key is required.');
		expect(list.textContent).toContain('Flow settings');
		expect(list.textContent).toContain('Timeout: not a duration.');
		expect((getByRole('button', { name: 'Publish' }) as HTMLButtonElement).disabled).toBe(true);
		// A problem selects what it names, so the inspector shows the field.
		await fireEvent.click(getByRole('button', { name: /Left key is required/ }));
		expect(getByTestId('flow-inspector').textContent).toContain('data.join');
		expect(container.querySelector('[data-node-id="join"]')?.className).toContain('border-brand');
		expect(queryByTestId('flow-problems')).toBeNull();
		expect(queryByRole('button', { name: /problem/ })).toBeTruthy();
	});

	it('prints a run failure once, on the failing step', () => {
		const { getByTestId } = setup({ run: fixtureRun });
		const viewer = getByTestId('run-viewer');
		const message = (fixtureRun.steps ?? []).find((s) => s.status === 'failed')?.error ?? '';
		expect(message).not.toBe('');
		expect(viewer.textContent?.split(message)).toHaveLength(2);
		expect(getByTestId('run-failure').textContent).toContain('Run failed at join');
		expect(getByTestId('run-failure').textContent).not.toContain(message);
	});

	it('hides the side panels below the xl breakpoint until the toolbar opens one', async () => {
		const { getByRole, getByLabelText } = setup();
		const palette = getByLabelText('Palette', { selector: 'aside' });
		const inspector = getByLabelText('Inspector', { selector: 'aside' });
		expect(palette.className).toContain('invisible');
		expect(palette.className).toContain('xl:visible');
		await fireEvent.click(getByRole('button', { name: 'Node palette' }));
		expect(palette.className).not.toContain('invisible');
		await fireEvent.click(getByRole('button', { name: 'Inspector' }));
		expect(inspector.className).not.toContain('invisible');
		expect(palette.className).toContain('invisible');
	});

	describe('an empty canvas offers three equal starts, none required', () => {
		const blank = { ...fixtureFlow, draft: { ...fixtureFlow.draft!, nodes: [], edges: [], notes: [] } };

		it('names the palette, a template and an import, as three secondary buttons', () => {
			const { getByTestId } = setup(null, { flow: blank });
			expect(getByTestId('outline-empty').textContent).toContain('No nodes yet');
			const offers = [...getByTestId('empty-offers').querySelectorAll('button')];
			expect(offers.map((b) => b.textContent?.trim())).toEqual(['Start from the palette', 'Use a template', 'Import YAML or JSON']);
			expect(new Set(offers.map((b) => b.className)).size).toBe(1);
		});

		it('opens the palette from the first offer and puts the cursor in its filter', async () => {
			const { getByRole, getByLabelText } = setup(null, { flow: blank });
			await fireEvent.click(getByRole('button', { name: 'Collapse Palette' }));
			const palette = getByLabelText('Palette', { selector: 'aside' });
			expect(palette.getAttribute('data-open')).toBe('false');
			await fireEvent.click(getByRole('button', { name: 'Start from the palette' }));
			expect(palette.getAttribute('data-open')).toBe('true');
			expect(palette.className).not.toContain('hidden');
			expect(document.activeElement?.id).toBe('palette-search');
		});

		it('opens a gallery from the second offer and applies a template in place', async () => {
			const { getByTestId, getByRole, getByText, container, queryByTestId } = setup(null, { flow: blank });
			expect(queryByTestId('template-gallery')).toBeNull();
			await fireEvent.click(getByRole('button', { name: 'Use a template' }));
			const gallery = getByTestId('template-gallery');
			// Each card offers one Use button rather than being a button itself, so a
			// saved template's delete can sit on the same card.
			const uses = [...gallery.querySelectorAll('button')].filter((b) => b.textContent?.trim() === 'Use');
			expect(uses).toHaveLength(fixtureTemplates.length);
			for (const t of fixtureTemplates) expect(gallery.textContent).toContain(t.description);
			const card = getByText('Nightly sheet export').closest('[data-testid="template-gallery"] > *') as HTMLElement;
			await fireEvent.click([...card.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Use') as HTMLElement);
			const def = definitionField(container);
			expect(def.nodes).toHaveLength(3);
			// The flow keeps its own identity. Only the graph comes from the template.
			expect(def.name).toBe(fixtureFlow.name);
			expect(def.slug).toBe(fixtureFlow.slug);
			expect(queryByTestId('template-gallery')).toBeNull();
			expect(queryByTestId('outline-empty')).toBeNull();
		});

		it('says so when the engine offered no templates, and leaves the other two doors open', async () => {
			const { getByRole, container } = setup(null, { flow: blank, templates: [] });
			await fireEvent.click(getByRole('button', { name: 'Use a template' }));
			const dialog = container.ownerDocument.querySelector('[role="dialog"]') as HTMLElement;
			expect(dialog.textContent).toContain('No templates');
		});

		it('opens the import from the third offer, on this flow\'s slug', async () => {
			const { getByRole, container } = setup(null, { flow: blank });
			await fireEvent.click(getByRole('button', { name: 'Import YAML or JSON' }));
			const form = container.querySelector('form[action="?/import"]') as HTMLFormElement;
			expect(form).toBeTruthy();
			expect(new FormData(form).get('slug')).toBe(fixtureFlow.slug);
		});
	});

	describe('one header row', () => {
		it('renders no title row: the way back and the name share the toolbar, and the h1 is for assistive technology', () => {
			const { getByRole, getByTestId, container } = setup();
			const toolbar = getByRole('toolbar', { name: 'Flow editor' });
			const back = toolbar.querySelector('[data-testid="page-back"]') as HTMLAnchorElement;
			expect(back.getAttribute('href')).toBe('/admin/flows');
			expect(back.textContent?.trim()).toBe('Flows');
			expect(toolbar.querySelector('#flow-name')).toBeTruthy();
			expect(container.querySelectorAll('h1')).toHaveLength(1);
			expect(getByTestId('page-title').className).toContain('sr-only');
			expect(container.querySelector('header')).toBeNull();
		});
	});

	describe('focus mode', () => {
		it('asks the shell for the frame from the toolbar toggle, remembers it, and withdraws the ask on leaving', async () => {
			const { shell, context } = shellContext();
			const { getByTestId, unmount } = setup(null, {}, context);
			expect(shell.focus).toBe(false);
			const toggle = getByTestId('focus-toggle');
			expect(toggle.getAttribute('aria-pressed')).toBe('false');
			await fireEvent.click(toggle);
			expect(shell.focus).toBe(true);
			expect(toggle.getAttribute('aria-pressed')).toBe('true');
			expect(toggle.getAttribute('aria-label')).toBe('Exit focus mode');
			expect(localStorage.getItem(FOCUS_KEY)).toBe('1');
			// The way back never leaves the toolbar.
			expect(getByTestId('page-back')).toBeTruthy();
			unmount();
			expect(shell.focus).toBe(false);
		});

		it('opens in focus mode when the viewer left it on', async () => {
			localStorage.setItem(FOCUS_KEY, '1');
			const { shell, context } = shellContext();
			const { getByTestId } = setup(null, {}, context);
			await tick();
			expect(shell.focus).toBe(true);
			expect(getByTestId('focus-toggle').getAttribute('aria-pressed')).toBe('true');
		});

		it('toggles from Ctrl+Shift+F and lists the shortcut', async () => {
			const { shell, context } = shellContext();
			const { getByRole, queryByTestId } = setup(null, {}, context);
			await fireEvent.keyDown(window, { key: 'F', ctrlKey: true, shiftKey: true });
			expect(shell.focus).toBe(true);
			await fireEvent.keyDown(window, { key: 'f', ctrlKey: true, shiftKey: true });
			expect(shell.focus).toBe(false);
			await pickOverflow(getByRole, 'Shortcuts');
			expect(queryByTestId('keyboard-hints')?.textContent).toContain('focus mode');
		});

		it('renders without the layout, where nothing listens', async () => {
			const { getByTestId } = setup();
			await fireEvent.click(getByTestId('focus-toggle'));
			expect(getByTestId('focus-toggle').getAttribute('aria-pressed')).toBe('true');
		});
	});

	describe('the side panels collapse to strips', () => {
		it('collapses each to a strip that names it, and the strip brings it back', async () => {
			const { getByRole, getByTestId, getByLabelText } = setup();
			await fireEvent.click(getByRole('button', { name: 'Collapse Palette' }));
			await fireEvent.click(getByRole('button', { name: 'Collapse Inspector' }));
			expect(getByLabelText('Palette', { selector: 'aside' }).getAttribute('data-open')).toBe('false');
			expect(getByLabelText('Inspector', { selector: 'aside' }).getAttribute('data-open')).toBe('false');
			expect(getByTestId('panel-palette-strip').textContent).toContain('Palette');
			expect(getByTestId('panel-inspector-strip').textContent).toContain('Inspector');
			await fireEvent.click(getByRole('button', { name: 'Expand Inspector' }));
			expect(getByLabelText('Inspector', { selector: 'aside' }).getAttribute('data-open')).toBe('true');
		});
	});

	it('shows the node icon, type and a guide link in the inspector header', async () => {
		const { getByTestId, getByRole, container } = setup();
		const header = container.querySelector('[data-node-id="join"] button') as HTMLElement;
		await fireEvent.click(header);
		const head = getByTestId('inspector-header');
		expect(head.textContent).toContain('Join');
		expect(head.textContent).toContain('data.join');
		expect(head.querySelector('svg')).toBeTruthy();
		await fireEvent.click(getByRole('button', { name: 'Open the guide' }));
		expect(getByRole('tab', { name: 'Guide' }).getAttribute('aria-selected')).toBe('true');
	});

	it('renders the run output as a tree with a copy per step and a Run again', () => {
		const { getByTestId, getByRole } = setup({ run: fixtureRun });
		const viewer = getByTestId('run-viewer');
		expect(viewer.querySelector('[data-testid="json-tree"]')).toBeTruthy();
		expect(getByRole('button', { name: 'Copy step' })).toBeTruthy();
		expect(getByRole('button', { name: 'Run again' })).toBeTruthy();
	});

	it('passes the schemas to the inspector so the schema key is a picker', async () => {
		const { getByRole, container } = setup(null, {
			schemas: [{ name: 'orders', display_name: 'Orders', fields: ['total'] }],
		});
		const header = container.querySelector('[data-node-id="orders"] button') as HTMLElement;
		await fireEvent.click(header);
		expect(getByRole('combobox', { name: /content type/i })).toBeTruthy();
	});

	it('lists recent runs in the Runs tab', async () => {
		const { getByRole, container } = setup();
		await fireEvent.click(getByRole('tab', { name: /Runs/ }));
		const rows = container.querySelectorAll('[data-testid="editor-drawer"] tbody tr');
		expect(rows).toHaveLength(1);
		expect(rows[0].textContent).toContain('failed');
		expect(rows[0].textContent).toContain('test');
		expect(rows[0].querySelector('form[action="?/run"] input[name="run_id"]')?.getAttribute('value')).toBe('r1');
	});

	// The tab is a table of runs, named for what it lists.
	it('names the runs table for its runs and pages past the first twenty', async () => {
		const runs = { ok: true, value: { rows: [fixtureRun], limit: 20, offset: 20, total: 41, hasMore: true } };
		const { getByRole, container } = setup(null, { runs });
		await fireEvent.click(getByRole('tab', { name: /Runs/ }));
		const drawer = container.querySelector('[data-testid="editor-drawer"]') as HTMLElement;
		expect(getByRole('region', { name: 'Runs' })).toBeTruthy();
		const next = [...drawer.querySelectorAll('a')].map((a) => a.getAttribute('href'));
		expect(next).toContain('/admin/flows/f1?limit=20&offset=40');
		expect(getByRole('tab', { name: /Runs/ }).textContent).toContain('41');
	});

	it('says the runs could not be read rather than that none were recorded', async () => {
		const { getByRole, container } = setup(null, { runs: { ok: false, gate: { state: 'unavailable' } } });
		await fireEvent.click(getByRole('tab', { name: /Runs/ }));
		const drawer = container.querySelector('[data-testid="editor-drawer"]') as HTMLElement;
		expect(drawer.textContent).toContain('the runs did not load');
		expect(drawer.textContent).not.toContain('No runs yet.');
	});

	it('says the node types could not be read rather than that none matches', () => {
		const { getByTestId } = setup(null, { catalog: [], catalogGate: { state: 'error', message: 'Could not load node types.' } });
		expect(getByTestId('flow-catalog-unread').textContent).toContain('Could not load node types');
		expect(getByTestId('node-palette').textContent).toContain('Could not load node types');
		expect(getByTestId('node-palette').textContent).not.toContain('No node type matches.');
	});

	// The export panel said Loading under its own error, so the reader could
	// not tell the read had ended.
	it('says the export could not be loaded and stops saying it is loading', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string) =>
				String(url).includes('/export')
					? new Response('{"error":"down"}', { status: 503, headers: { 'content-type': 'application/json' } })
					: new Response(JSON.stringify({ ok: true, errors: [] }), { status: 200, headers: { 'content-type': 'application/json' } }),
			),
		);
		const { getByRole } = setup();
		await pickOverflow(getByRole, 'Export');
		await vi.waitFor(() => expect(document.body.textContent).toContain('Could not load the export.'));
		expect(document.body.textContent).not.toContain('Loading the export.');
		expect(document.body.querySelector('pre')).toBeNull();
	});

	// A page of runs is this editor at another address, and the draft survives it.
	it('pages the runs with an unsaved draft and asks nothing', async () => {
		const { container } = setup();
		await fireEvent.input(container.querySelector('#flow-name') as HTMLInputElement, { target: { value: 'Renamed' } });
		const cancel = vi.fn();
		nav.guard?.({
			cancel,
			type: 'link',
			to: { url: new URL('http://localhost/admin/flows/f1?limit=20&offset=20'), route: { id: '/(admin)/admin/flows/[id]' }, params: { id: 'f1' } },
		});
		await tick();
		expect(cancel).not.toHaveBeenCalled();
		expect(kit.confirm).not.toHaveBeenCalled();

		nav.guard?.({ cancel, type: 'link', to: { url: new URL('http://localhost/admin/flows'), route: { id: '/(admin)/admin/flows' }, params: {} } });
		await tick();
		expect(cancel).toHaveBeenCalled();
		expect(kit.confirm).toHaveBeenCalledWith(expect.stringContaining('Discard the changes'), expect.anything(), { confirmLabel: 'Discard' });
	});

	it('carries the in-product guide', async () => {
		const { getByRole, container } = setup();
		await fireEvent.click(getByRole('tab', { name: 'Guide' }));
		expect(container.textContent).toContain('nodes.<id>.output');
		expect(container.textContent).toContain('never includes a secret');
	});

	it('renders the not-enabled state when the engine answered 402', () => {
		const { getByTestId } = setup(null, { locked: true, flow: null, catalog: [] });
		expect(getByTestId('not-enabled')).toBeTruthy();
	});

	it('shows a blocked flow as a warn pill, a banner and a Publish it cannot press', () => {
		const { getByTestId, getByRole, queryByTestId } = setup(null, { flow: blockedFlow });
		const pill = getByTestId('flow-status');
		expect(pill.textContent).toContain('Blocked v2');
		expect(pill.querySelector('[class*="rounded-full"]')?.className).toContain('warn');
		expect(pill.parentElement?.querySelector('[role="tooltip"]')?.textContent).toContain(BLOCKED_TEXT);
		expect(getByTestId('flow-blocked').textContent).toContain(BLOCKED_TEXT);
		const publish = getByRole('button', { name: 'Publish' }) as HTMLButtonElement;
		expect(publish.disabled).toBe(true);
		expect(publish.parentElement?.textContent).toContain(BLOCKED_TEXT);
		expect(queryByTestId('flow-problems')).toBeNull();
	});

	it('disables Save with nothing to save and makes it the one primary once there is', async () => {
		const { container, getByRole } = setup();
		const save = () => getByRole('button', { name: 'Save' }) as HTMLButtonElement;
		const publish = () => getByRole('button', { name: 'Publish' }) as HTMLButtonElement;
		expect(save().disabled).toBe(true);
		expect(publish().className).toContain('bg-brand');
		await fireEvent.input(container.querySelector('#flow-name') as HTMLInputElement, { target: { value: 'Renamed' } });
		expect(save().disabled).toBe(false);
		expect(save().className).toContain('bg-brand');
		expect(publish().className).not.toContain('bg-brand');
	});

	it('disables Publish while the saved draft is the live version, and offers it again after an edit', async () => {
		const live = { ...fixtureFlow, status: 'active', version: 2 };
		const { container, getByRole } = setup(null, {
			flow: live,
			versions: { ok: true, value: [{ flow_id: live.id, version: 2, checksum: 'x', created_by: 'a', created_at: live.updated_at }] },
		});
		const publish = () => getByRole('button', { name: 'Publish' }) as HTMLButtonElement;
		expect(publish().disabled).toBe(true);
		expect(publish().parentElement?.textContent).toContain('This draft is already live');
		await fireEvent.input(container.querySelector('#flow-name') as HTMLInputElement, { target: { value: 'Renamed' } });
		expect(publish().disabled).toBe(false);
	});

	it('draws no banner and keeps Publish live for a published flow', () => {
		const { getByRole, queryByTestId } = setup(null, { flow: { ...fixtureFlow, status: 'active', version: 2 } });
		expect(queryByTestId('flow-blocked')).toBeNull();
		expect((getByRole('button', { name: 'Publish' }) as HTMLButtonElement).disabled).toBe(false);
	});

	it('puts the 422 naming a missing plugin on the node it names, and names the plugin in the banner', async () => {
		const { getByRole, getByTestId, container } = setup({ errors: missingTypeErrors }, { flow: blockedFlow });
		expect(container.querySelector('[data-node-id="render"]')?.className).toContain('border-danger');
		await fireEvent.click(getByRole('button', { name: '1 problem' }));
		const list = getByTestId('flow-problems');
		expect(list.textContent).toContain('render');
		expect(list.textContent).toContain('Node type "email.render" is not available');
		expect(list.textContent).toContain('needs the email plugin');
		expect(getByTestId('flow-blocked').textContent).toContain('It needs the email plugin');
		expect(getByTestId('flow-status').parentElement?.querySelector('[role="tooltip"]')?.textContent).toContain('email');
	});

	it('shows a test run the engine refused as blocked as the banner, not as a run failure', async () => {
		fetchMock = refusingTestFetch(blockedRunError);
		vi.stubGlobal('fetch', fetchMock);
		const { getByRole, getByTestId, queryByTestId, queryByText } = setup(null, { flow: { ...fixtureFlow, status: 'active', version: 1 } });
		expect(queryByTestId('flow-blocked')).toBeNull();
		await fireEvent.click(getByRole('button', { name: 'Test' }));
		await vi.waitFor(() => expect(getByTestId('flow-blocked')).toBeTruthy());
		expect(getByTestId('flow-blocked').textContent).toContain(BLOCKED_TEXT);
		expect(queryByText(blockedRunError.error)).toBeNull();
		expect((getByRole('button', { name: 'Publish' }) as HTMLButtonElement).disabled).toBe(true);
	});

	it('puts a test run refused for a missing type on the node, not in the run drawer', async () => {
		fetchMock = refusingTestFetch({ ok: false, errors: missingTypeErrors });
		vi.stubGlobal('fetch', fetchMock);
		const { getByRole, getByTestId, queryByTestId, container } = setup(null, { flow: { ...blockedFlow, status: 'active' } });
		await fireEvent.click(getByRole('button', { name: 'Test' }));
		await vi.waitFor(() => expect(getByTestId('flow-problems')).toBeTruthy());
		expect(getByTestId('flow-problems').textContent).toContain('needs the email plugin');
		expect(container.querySelector('[data-node-id="render"]')?.className).toContain('border-danger');
		expect(queryByTestId('flow-blocked')).toBeNull();
		expect(queryByTestId('run-failure')).toBeNull();
	});

	it('names the nodes this instance does not enable when a test run is refused with 402', async () => {
		const refusal = {
			error: 'payment_required',
			plugin: 'flow',
			feature: 'feature:example_feature',
			upgrade_url: '',
			ok: false,
			errors: [{ node_id: 'orders', path: '/type', message: 'db.query needs example_feature' }],
		};
		fetchMock = vi.fn(async (url: string) => {
			const refused = String(url).endsWith('/test');
			return new Response(JSON.stringify(refused ? refusal : { ok: true, errors: [] }), {
				status: refused ? 402 : 200,
				headers: { 'content-type': 'application/json' },
			});
		});
		vi.stubGlobal('fetch', fetchMock);
		const { getByRole, getByTestId, container, queryByText } = setup(null, { flow: { ...fixtureFlow, status: 'active', version: 1 } });
		await fireEvent.click(getByRole('button', { name: 'Test' }));
		await vi.waitFor(() => expect(getByTestId('flow-problems')).toBeTruthy());
		expect(container.textContent).toContain('One element uses a feature that is not enabled on this instance: orders.');
		expect(container.querySelector('[data-node-id="orders"]')?.className).toContain('border-danger');
		expect(queryByText('payment_required')).toBeNull();
	});

	// The console renews the engine's short token only on a request its own
	// server handles, so a test run sent straight to the engine can carry one
	// that lapsed on a live session. Rerunning the loads renews it.
	describe('a test run the engine answers with 401', () => {
		function answeringTest(statuses: number[]) {
			return vi.fn(async (url: string) => {
				if (!String(url).endsWith('/test')) {
					return new Response(JSON.stringify({ ok: true, errors: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
				}
				const status = statuses.shift() ?? 200;
				const body = status === 401 ? { error: 'unauthorized' } : fixtureRun;
				return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
			});
		}

		it('renews the session and runs the test again, keeping the draft in place', async () => {
			nav.invalidateAll.mockClear();
			fetchMock = answeringTest([401]);
			vi.stubGlobal('fetch', fetchMock);
			const { getByRole, queryByText } = setup();
			await fireEvent.click(getByRole('button', { name: 'Test' }));
			await vi.waitFor(() => expect(fetchMock.mock.calls.filter((c) => String(c[0]).endsWith('/test'))).toHaveLength(2));
			expect(nav.invalidateAll).toHaveBeenCalledTimes(1);
			await vi.waitFor(() => expect(queryByText('unauthorized')).toBeNull());
			vi.unstubAllGlobals();
		});

		it('says to sign in again when the renewed run is refused too', async () => {
			fetchMock = answeringTest([401, 401]);
			vi.stubGlobal('fetch', fetchMock);
			const { getByRole, container } = setup();
			await fireEvent.click(getByRole('button', { name: 'Test' }));
			await vi.waitFor(() => expect(container.textContent).toContain('Your session ended. Sign in again in another tab, then try again here.'));
			expect(container.textContent).not.toContain('unauthorized');
			vi.unstubAllGlobals();
		});
	});

	it('says the versions could not be read, offers no rollback and never calls the draft unpublished', () => {
		const live = { ...fixtureFlow, status: 'active', version: 2 };
		const { getByTestId, queryByRole, getByRole } = setup(null, { flow: live, versions: { ok: false, gate: { state: 'unavailable' } } });
		expect(getByTestId('versions-unread').textContent).toContain('Could not load versions');
		expect(queryByRole('button', { name: 'Roll back' })).toBeNull();
		const publish = getByRole('button', { name: 'Publish' }) as HTMLButtonElement;
		expect(publish.disabled).toBe(false);
		expect(publish.className).not.toContain('bg-brand');
		expect(publish.parentElement?.textContent).toContain('This draft may already be live');
	});

	it('seeds the test trigger of a contributed trigger with its type alone and says where the payload keys go', () => {
		const flow = { ...fixtureFlow, draft: { ...fixtureFlow.draft, trigger: { type: 'email.bounced', config: { template: 'welcome' } } } };
		const { container } = setup(null, { flow });
		const field = container.querySelector('#test-trigger') as HTMLTextAreaElement;
		expect(JSON.parse(field.value)).toEqual({ type: 'email.bounced' });
		expect(field.parentElement?.parentElement?.textContent).toContain('beside the type key');
	});

	it('keeps the built-in hint under the test trigger of a built-in trigger', () => {
		const { container } = setup();
		const field = container.querySelector('#test-trigger') as HTMLTextAreaElement;
		expect(field.parentElement?.parentElement?.textContent).not.toContain('beside the type key');
	});

	/** Opens the drawer's Assistant tab. */
	async function openAssistant(getByRole: Query) {
		await fireEvent.click(getByRole('tab', { name: 'Assistant' }));
	}

	const cleanDraft = {
		definition: { ...fixtureFlow.draft!, name: 'Drafted', slug: 'drafted', nodes: fixtureFlow.draft!.nodes.slice(0, 1), edges: [] },
		yaml: 'name: Drafted\nnodes:\n  - id: orders\n',
		problems: [],
		conversation_id: 'c1',
		model: 'gpt-4.1',
		tokens: 1234,
		cost: '0.003100',
	};

	it('hides the Assistant tab when the catalog for a model answered 402', () => {
		const { queryByRole } = setup(null, { assistant: 'hidden' });
		expect(queryByRole('tab', { name: 'Assistant' })).toBeNull();
	});

	it('posts the prompt with the canvas definition to the assist action, and holds Send until there is one', async () => {
		const { getByRole, getByTestId, getByLabelText } = setup();
		await openAssistant(getByRole);
		const form = getByTestId('assist-form') as HTMLFormElement;
		expect(form.getAttribute('action')).toBe('?/assist');
		expect(JSON.parse((form.querySelector('[name="definition"]') as HTMLInputElement).value).nodes).toHaveLength(3);
		expect((form.querySelector('[name="conversation_id"]') as HTMLInputElement).value).toBe('');
		const send = getByRole('button', { name: 'Send' }) as HTMLButtonElement;
		expect(send.disabled).toBe(true);
		await fireEvent.input(getByLabelText('Describe the flow'), { target: { value: 'Join orders to shipments' } });
		expect(send.disabled).toBe(false);
		expect((form.querySelector('[name="prompt"]') as HTMLTextAreaElement).value).toBe('Join orders to shipments');
		expect(getByTestId('assist-empty')).toBeTruthy();
	});

	it('shows a draft read-only with its problems, the usage line, and an Accept it cannot press while problems remain', async () => {
		const { getByRole, getByTestId, container } = setup({
			assist: {
				prompt: 'Join them',
				draft: { ...cleanDraft, problems: [{ node_id: 'join', path: '/config/left_key', message: 'required' }] },
			},
		});
		expect(getByRole('tab', { name: 'Assistant', selected: true })).toBeTruthy();
		const yaml = container.querySelector('#assist-yaml') as HTMLTextAreaElement;
		expect(yaml.value).toContain('name: Drafted');
		expect(yaml.readOnly).toBe(true);
		expect(getByTestId('assist-problems').textContent).toContain('join/config/left_key');
		expect(getByTestId('assist-usage').textContent).toBe('gpt-4.1, 1,234 tokens, $0.0031');
		const accept = getByRole('button', { name: 'Accept' }) as HTMLButtonElement;
		expect(accept.disabled).toBe(true);
		expect(getByTestId('accept-reason').textContent).toContain('1 problem');
		// The follow-up carries the conversation, and the prompt is labeled as a refinement.
		expect((getByTestId('assist-form').querySelector('[name="conversation_id"]') as HTMLInputElement).value).toBe('c1');
		expect(container.querySelector('label[for="assist-prompt"]')?.textContent).toContain('Refine the draft');
		// A problem naming a node on the canvas selects it there.
		await fireEvent.click(getByRole('button', { name: /join\/config\/left_key/ }));
		expect(container.querySelector('[data-node-id="join"]')?.className).toContain('border-brand');
		// The canvas is untouched until Accept.
		expect(definitionField(container).name).toBe(fixtureFlow.draft?.name);
	});

	it('holds Accept when the assistant answered with no definition', () => {
		const { getByRole, getByTestId } = setup({ assist: { prompt: 'x', draft: { ...cleanDraft, definition: null } } });
		expect((getByRole('button', { name: 'Accept' }) as HTMLButtonElement).disabled).toBe(true);
		expect(getByTestId('accept-reason').textContent).toContain('did not return a flow');
	});

	it('accepts a clean draft into the editor, keeping the flow slug and marking it unsaved', async () => {
		const { getByRole, getByTestId, queryByTestId, container } = setup({ assist: { prompt: 'Join them', draft: cleanDraft } });
		await fireEvent.click(getByRole('button', { name: 'Accept' }));
		const def = definitionField(container);
		expect(def.name).toBe('Drafted');
		expect(def.slug).toBe(fixtureFlow.slug);
		expect(def.nodes).toHaveLength(1);
		expect(def.settings).toBeTruthy();
		expect(getByTestId('flow-outline').querySelectorAll('[data-node-id]')).toHaveLength(2);
		expect(container.textContent).toContain('Unsaved changes');
		expect(queryByTestId('assist-draft')).toBeNull();
	});

	it('discards a draft and starts the conversation over', async () => {
		const { getByRole, getByTestId, queryByTestId, container } = setup({ assist: { prompt: 'Join them', draft: cleanDraft } });
		await fireEvent.click(getByRole('button', { name: 'Discard' }));
		expect(queryByTestId('assist-draft')).toBeNull();
		expect((getByTestId('assist-form').querySelector('[name="conversation_id"]') as HTMLInputElement).value).toBe('');
		expect(definitionField(container).name).toBe(fixtureFlow.draft?.name);
	});

	it('shows each refusal as its own state: locked, off with the settings link, unavailable with the engine text, error', () => {
		const locked = setup({ assistRefused: { state: 'locked' } });
		expect(locked.getByTestId('assistant-panel').querySelector('[data-testid="not-enabled"]')).toBeTruthy();
		expect((locked.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);
		cleanup();
		const off = setup({ assistRefused: { state: 'off' } });
		expect(off.getByRole('link', { name: 'AI settings' }).getAttribute('href')).toBe('/admin/ai/settings');
		expect((off.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);
		cleanup();
		const unavailable = setup({ assistRefused: { state: 'unavailable', message: 'flow validator is not registered' } });
		expect(unavailable.getByTestId('assistant-panel').textContent).toContain('flow validator is not registered');
		cleanup();
		const failed = setup({ assistRefused: { state: 'error', message: 'The assistant did not answer. Try again.' } });
		expect(failed.getByTestId('assistant-panel').textContent).toContain('The assistant did not answer. Try again.');
		expect(failed.queryByTestId('assist-empty')).toBeNull();
	});

	it('renders an answer as elements, never as HTML', () => {
		const { getByTestId } = setup({
			explain: {
				subject: 'join',
				answer: { answer: '## Join\n\nIt **joins** `orders` to shipments.\n\n<img src=x onerror="alert(1)">\n\n- left key\n- right key', model: 'm', tokens: 40, cost: '0.000200' },
			},
		});
		const panel = getByTestId('assist-answer');
		expect(panel.querySelector('h4')?.textContent).toBe('Join');
		expect(panel.querySelector('strong')?.textContent).toBe('joins');
		expect(panel.querySelector('code')?.textContent).toBe('orders');
		expect(panel.querySelectorAll('li')).toHaveLength(2);
		expect(panel.querySelector('img')).toBeNull();
		expect(panel.textContent).toContain('<img src=x onerror="alert(1)">');
	});

	it('asks about the selected node and about a problem through the explain form', async () => {
		const { getByRole, getByTestId, container } = setup({ errors: [{ node_id: 'join', path: '/config/left_key', message: 'required' }] });
		const form = container.querySelector('#flow-explain') as HTMLFormElement;
		expect(form.getAttribute('action')).toBe('?/explain');
		const submitted: number[] = [];
		form.addEventListener('submit', (e) => {
			e.preventDefault();
			submitted.push(1);
		});
		const header = getByTestId('flow-outline').querySelector('[data-node-id="join"] button') as HTMLElement;
		await fireEvent.click(header);
		await fireEvent.click(getByRole('button', { name: 'Ask the assistant about this node' }));
		await new Promise((r) => setTimeout(r, 0));
		expect((form.querySelector('[name="node_id"]') as HTMLInputElement).value).toBe('join');
		expect((form.querySelector('[name="problem"]') as HTMLInputElement).value).toBe('');
		expect(submitted).toHaveLength(1);

		await fireEvent.click(getByRole('button', { name: '1 problem' }));
		await fireEvent.click(getByRole('button', { name: 'Ask the assistant about this problem' }));
		await new Promise((r) => setTimeout(r, 0));
		expect((form.querySelector('[name="node_id"]') as HTMLInputElement).value).toBe('');
		expect(JSON.parse((form.querySelector('[name="problem"]') as HTMLInputElement).value)).toEqual({ node_id: 'join', path: '/config/left_key', message: 'required' });
		expect(submitted).toHaveLength(2);
	});

	it('offers no ask action when the assistant is hidden', async () => {
		const { getByTestId, queryByRole, container } = setup({ errors: [{ node_id: 'join', path: '/config/left_key', message: 'required' }] }, { assistant: 'hidden' });
		const header = getByTestId('flow-outline').querySelector('[data-node-id="join"] button') as HTMLElement;
		await fireEvent.click(header);
		expect(queryByRole('button', { name: 'Ask the assistant about this node' })).toBeNull();
		expect(container.querySelector('#flow-explain')).toBeNull();
	});
});

describe('flow editor refusal', () => {
	it('renders a refusal inline with the node ids, and marks the nodes as problems', () => {
		const form = {
			error: '2 elements use what this instance does not enable: the trigger, orders.',
			refusal: { nodeIds: ['trigger', 'orders'], limit: null, current: null, upgradeUrl: '' },
			errors: [
				{ node_id: 'trigger', path: '/trigger/type', message: 'not enabled here' },
				{ node_id: 'orders', path: '/type', message: 'not enabled here' },
			],
		};
		const { getByTestId, getByRole, container } = setup(form);
		const alert = getByTestId('flow-refusal');
		expect(alert.textContent).toContain('Not enabled on this instance');
		expect(alert.textContent).toContain('the trigger, orders');
		expect(getByRole('button', { name: /2 problems/ })).toBeTruthy();
		// One notice, not the warn alert and the danger one both saying it.
		expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1);
	});
});

describe('flow editor locked types', () => {
	it('marks what the catalog says is not enabled in the palette and the trigger picker', () => {
		const { container, getByTestId } = setup(null, { catalog: withLocked(fixtureCatalog, ['trigger.http', 'data.join']) });
		expect(container.querySelector('[data-node-type="data.join"] [data-testid="node-locked"]')).not.toBeNull();
		expect(container.querySelector('[data-node-type="content.query"] [data-testid="node-locked"]')).toBeNull();
		expect(getByTestId('trigger-locked')).toBeTruthy();
	});

	it('marks a template the plugin says is not enabled, and still offers it', async () => {
		const templates = [{ ...fixtureTemplates[0], enabled: false }, { ...fixtureTemplates[1], enabled: true }];
		const blank = { ...fixtureFlow, draft: { ...fixtureFlow.draft!, nodes: [], edges: [], notes: [] } };
		const { getByRole, getByTestId, getAllByTestId } = setup(null, { flow: blank, templates });
		await fireEvent.click(getByRole('button', { name: 'Use a template' }));
		expect(getAllByTestId('template-locked')).toHaveLength(1);
		const uses = [...getByTestId('template-gallery').querySelectorAll('button')].filter((b) => b.textContent?.trim() === 'Use');
		expect(uses).toHaveLength(2);
	});
});

describe('flow editor role grants', () => {
	const version = { flow_id: 'f1', version: 1, checksum: 'x', created_by: 'u1', created_at: '2026-09-01T00:00:00Z' };
	const toolbarNames = (getByRole: Query) =>
		[...getByRole('toolbar', { name: 'Flow editor' }).querySelectorAll('button')].map((b) => b.getAttribute('aria-label') ?? b.textContent?.trim());

	it('draws save for a flow the caller may update and hides test, publish, rollback and delete', () => {
		const { getByRole, queryByRole } = setup(null, { flow: { ...fixtureFlow, actions: ['read', 'update'] }, versions: { ok: true, value: [version] } });
		expect(toolbarNames(getByRole)).toEqual(['More actions', 'Node palette', 'Inspector', 'Focus mode', 'Save']);
		expect(queryByRole('button', { name: 'Delete flow' })).toBeNull();
		expect(queryByRole('button', { name: 'Roll back' })).toBeNull();
	});

	it('draws publish, test and rollback for a flow the caller may activate', () => {
		const { getByRole, queryByRole } = setup(null, { flow: { ...fixtureFlow, actions: ['read', 'activate'] }, versions: { ok: true, value: [version] } });
		expect(toolbarNames(getByRole)).toEqual(['More actions', 'Node palette', 'Inspector', 'Focus mode', 'Test', 'Publish']);
		expect(getByRole('button', { name: 'Roll back' })).toBeTruthy();
		expect(queryByRole('button', { name: 'Save' })).toBeNull();
	});

	it('draws everything when the engine carries no grants on the flow', () => {
		const { getByRole } = setup(null, { flow: { ...fixtureFlow, actions: undefined } });
		expect(toolbarNames(getByRole)).toEqual(['More actions', 'Node palette', 'Inspector', 'Focus mode', 'Delete flow', 'Test', 'Save', 'Publish']);
	});

	it('renders a 403 inline as a role refusal', () => {
		const { getByTestId } = setup({ error: 'permission denied: activate on flow:orders_with_shipments', forbidden: true });
		expect(getByTestId('flow-forbidden').textContent).toContain('Your role cannot do that');
		expect(getByTestId('flow-forbidden').textContent).toContain('activate on flow:orders_with_shipments');
	});
});

describe('flow editor page with a visual editor in the build', () => {
	beforeEach(() => {
		seam.visual = true;
	});
	afterEach(() => {
		seam.visual = false;
	});

	it('offers undo and redo in the toolbar and auto layout in the overflow menu', async () => {
		const { getByRole, getAllByRole } = setup();
		const toolbar = getByRole('toolbar', { name: 'Flow editor' });
		const names = [...toolbar.querySelectorAll('button')].map((b) => b.getAttribute('aria-label') ?? b.textContent?.trim());
		expect(names).toEqual(['More actions', 'Node palette', 'Inspector', 'Undo', 'Redo', 'Focus mode', 'Delete flow', 'Test', 'Save', 'Publish']);
		await fireEvent.click(getByRole('button', { name: 'More actions' }));
		expect(getAllByRole('menuitem').map((m) => m.textContent?.trim())[0]).toBe('Auto layout');
	});

	it('lists the history and viewport shortcuts', async () => {
		const { getByRole, queryByTestId } = setup();
		await pickOverflow(getByRole, 'Shortcuts');
		expect(queryByTestId('keyboard-hints')?.textContent).toContain('undo');
		expect(queryByTestId('keyboard-hints')?.textContent).toContain('drag to pan');
	});
});

describe('heading outline', () => {
	// A collapsed side panel hides its header from xl up through the stylesheet,
	// which the test document does not apply, so the test hides it the same way.
	it('keeps the runs notice one level under the title with both side panels collapsed', async () => {
		const { getByRole, container } = setup(null, { runs: { ok: false, gate: { state: 'locked', upgradeUrl: '' } } });
		await fireEvent.click(getByRole('button', { name: 'Collapse Palette' }));
		await fireEvent.click(getByRole('button', { name: 'Collapse Inspector' }));
		await fireEvent.click(getByRole('tab', { name: /Runs/ }));
		for (const el of container.querySelectorAll('.xl\\:hidden')) el.setAttribute('hidden', '');
		expect(container.querySelector('[data-testid="not-enabled"]')).toBeTruthy();
		expect(outlineSkips(container)).toEqual([]);
	});
});
