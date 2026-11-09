<script lang="ts">
	import {
		Alert,
		Badge,
		Button,
		ButtonGroup,
		Dropdown,
		EmptyState,
		PageShell,
		SegmentedControl,
		confirm,
		toast,
		Toolbar,
	} from '@lyeve-labs/ui-kit';
	import type { ActionData, PageData } from './$types';
	import type { DryRunStatement } from './+page.server';
	import { enhance } from '$app/forms';
	import { beforeNavigate, goto, invalidate, invalidateAll } from '$app/navigation';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { tick, untrack } from 'svelte';
	import type { Schema } from '@lyeve-labs/client';
	import {
		Download,
		Ellipsis,
		Eye,
		LayoutTemplate,
		List,
		Network,
		Plus,
		Redo2,
		Save,
		Table2,
		Trash2,
		Undo2,
		Upload,
	} from '@lucide/svelte';
	import { tableName } from '$lib/relations';
	import { MIGRATIONS_DEPENDENCY } from '$lib/api/migrate';
	import {
		canonical,
		changesOf,
		createSchemaHistory,
		isRisky,
		problemsOf,
		wireSchema,
		type SchemaHistory,
	} from '$lib/schema/editor';
	import ResizableAside from '$lib/components/ResizableAside.svelte';
	import { SchemaCanvas, hasSchemaCanvas } from '$lib/canvas/schema';
	import NotEnabled from '$lib/components/NotEnabled.svelte';
	import type { Positions } from '$lib/api/schema-canvas-layout';
	import type { SchemaCanvasApi } from '$lib/canvas/contract';
	import ProblemsMenu from '$lib/components/ProblemsMenu.svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import { ICON } from '$lib/icon';
	import DdlPreview from './parts/DdlPreview.svelte';
	import ImportDrawer from './parts/ImportDrawer.svelte';
	import PresetsDrawer from './parts/PresetsDrawer.svelte';
	import RenameModal from './parts/RenameModal.svelte';
	import SchemaEditor, { type EditorTab } from './parts/SchemaEditor.svelte';
	import SchemaRail from './parts/SchemaRail.svelte';
	import { DdlHistory } from './parts/ddl-history.svelte';
	import { addField, addRelation } from './parts/schema-fields';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	// The schema plugin says whether this install draws the canvas and saves
	// a custom preset. Without either the list editor is the whole builder and
	// the built-in presets stay.
	const canvasLicensed = $derived(data.canvas?.licensed === true);
	const canSavePresets = $derived(data.canSavePresets === true);

	// The canvas reports every position after a gesture that moves a node,
	// and the layout is saved on the instance for every admin of the tenant.
	// A burst of moves sends the last one, and nothing reloads the page.
	let layoutForm = $state<HTMLFormElement>();
	let layoutJSON = $state('{}');
	let layoutTimer: ReturnType<typeof setTimeout> | undefined;
	function saveLayout(positions: Positions) {
		layoutJSON = JSON.stringify(positions);
		clearTimeout(layoutTimer);
		layoutTimer = setTimeout(() => layoutForm?.requestSubmit(), 400);
	}
	const layoutSubmit: SubmitFunction = () => {
		return async ({ result }) => {
			if (result.type === 'failure') toast.error(String((result.data as { layoutError?: string })?.layoutError ?? 'Could not save the layout. Try again.'));
		};
	};

	// Every schema write takes admin or super_admin. An editor reads the
	// definitions and is not handed controls that end in a 403.
	const canWrite = $derived(data.canWrite === true);

	function withIds(s: Schema): Schema {
		return {
			...s,
			fields: s.fields.map((f) => (f.id ? f : { ...f, id: crypto.randomUUID() })),
		};
	}

	// svelte-ignore state_referenced_locally
	let schemas = $state<Schema[]>((data.schemas ?? []).map(withIds));
	// svelte-ignore state_referenced_locally
	let loadedSchemas = data.schemas;

	// The list is local state so a save or a delete edits it in place, and
	// the load reruns only after a preset action or a partial save, when the
	// engine holds schemas this page has not seen. That rerun is the one time
	// the server's list replaces the local one.
	$effect(() => {
		if (data.schemas === loadedSchemas) return;
		loadedSchemas = data.schemas;
		schemas = (data.schemas ?? []).map(withIds);
	});

	/**
	 * Row counts arrive after the page paints. The load streams them, so a
	 * tenant with many schemas sees the list at once and the figures a moment
	 * later. A count that could not be read is left out rather than shown as 0.
	 */
	let rowCounts = $state<Record<string, number>>({});
	$effect(() => {
		const pending = data.rowCounts;
		let live = true;
		void Promise.resolve(pending).then((counts) => {
			if (live) rowCounts = counts ?? {};
		});
		return () => {
			live = false;
		};
	});

	// The presets are offered from the empty state and from the toolbar.
	let showPresets = $state(false);
	// Applying and deleting a preset share the one `form` result, so each
	// failure is read by the action that caused it and shown where that
	// action was asked for.
	const presetError = $derived(form && 'action' in form && form.action === 'preset' && form.error ? form : null);
	const presetDeleteError = $derived(form && 'action' in form && form.action === 'deletePreset' && form.error ? String(form.error) : '');
	const presetCreated = $derived(form && 'created' in form && Array.isArray(form.created) ? form.created : null);
	// A plugin that serves no presets route has none to offer. Any other
	// failure still opens the drawer, which says why it is empty.
	const hasPresets = $derived((data.presets?.length ?? 0) > 0 || (data.presetsGate != null && data.presetsGate.state !== 'absent'));

	/**
	 * The schema being edited, and the one the server holds for it.
	 *
	 * Dirty is the difference between the two rather than a flag set on the
	 * first keystroke, so an undo back to what was saved reads as saved. A new
	 * schema has no saved side and is dirty until it is.
	 */
	let selected = $state<Schema | null>(null);
	let saved = $state<(Schema & { version?: string }) | null>(null);
	const isNewSchema = $derived(selected !== null && saved === null);
	const dirty = $derived(selected !== null && (saved === null || canonical(selected) !== canonical(saved)));

	let view = $state<'list' | 'canvas'>('list');
	/** The editor's tab, held here so a switch between the list and the canvas keeps it. */
	let editorTab = $state<EditorTab>('definition');

	/**
	 * Below lg the list sits above the editor, so once a schema is open it
	 * folds to its header and the editor gets the screen. The header keeps a
	 * button that brings the list back, and opening a schema folds it again.
	 */
	let listShown = $state(false);
	const listFolded = $derived(selected !== null && !listShown);
	let saveError = $state('');
	/** The last save was refused because the content type changed since it was opened. */
	let stale = $state(false);

	/**
	 * The undo stack for the schema on screen. Rebuilt whenever another schema
	 * is opened, so an undo never reaches into the one before.
	 */
	let history: SchemaHistory | null = null;
	let historyState = $state({ canUndo: false, canRedo: false });
	let restoring = false;

	function resetHistory(s: Schema | null) {
		history = s ? createSchemaHistory(JSON.parse(JSON.stringify(s)) as Schema) : null;
		historyState = { canUndo: false, canRedo: false };
	}

	$effect(() => {
		if (!selected) return;
		const snap = JSON.parse(JSON.stringify(selected)) as Schema;
		untrack(() => {
			if (restoring || !history) return;
			history.push(snap);
			historyState = { canUndo: history.canUndo(), canRedo: history.canRedo() };
		});
	});

	function undo() {
		const prev = history?.undo();
		if (prev) restore(prev);
	}

	function redo() {
		const next = history?.redo();
		if (next) restore(next);
	}

	function restore(s: Schema) {
		restoring = true;
		selected = s;
		historyState = { canUndo: history?.canUndo() ?? false, canRedo: history?.canRedo() ?? false };
		queueMicrotask(() => (restoring = false));
	}

	/**
	 * Deep-clone a schema. JSON round-trip, not structuredClone: the schema on
	 * screen is a Svelte state proxy and structuredClone throws on one.
	 */
	function cloneSchema(s: Schema): Schema {
		return withIds(JSON.parse(JSON.stringify(s)));
	}

	/** Opens a schema, and a saved copy of it for dirty and for what a save changes. */
	function open(s: Schema | null, asSaved = true) {
		selected = s ? cloneSchema(s) : null;
		saved = s && asSaved ? JSON.parse(JSON.stringify(selected)) : null;
		saveError = '';
		stale = false;
		// Below lg the fold hides the list button just pressed, and focus would
		// drop to the page. It moves to the button that shows the list again.
		const fromRail = document.getElementById('schema-rail')?.contains(document.activeElement) ?? false;
		listShown = false;
		resetHistory(selected);
		if (s && fromRail && typeof window.matchMedia === 'function' && !window.matchMedia('(min-width: 64rem)').matches) {
			void tick().then(() => document.querySelector<HTMLElement>('[aria-controls="schema-rail"]')?.focus());
		}
	}

	/** Asks before throwing away edits. True when there is nothing to lose or the answer is yes. */
	async function mayDiscard(): Promise<boolean> {
		if (!dirty || !selected) return true;
		return confirm(
			`Discard the changes to ${selected.display_name || selected.name || 'the new schema'}?`,
			'They have not been saved. Save first to keep them.',
			{ confirmLabel: 'Discard' },
		);
	}

	async function selectSchema(s: Schema) {
		// Picking a schema opens its editor where the reader is: beside the rail
		// in the list, beside the diagram on the canvas.
		if (selected && saved?.name === s.name) return;
		if (!(await mayDiscard())) return;
		open(s);
	}

	/** What would make a save fail, checked as the operator types. */
	const problems = $derived(
		selected ? problemsOf(selected, schemas.filter((s) => s.name !== saved?.name), isNewSchema) : [],
	);
	const problemItems = $derived(problems.map((p, i) => ({ key: `${i}:${p.target}`, where: p.where, what: p.message, target: p.target })));
	let showProblems = $state(false);
	let canvasPanelOpen = $state(true);
	let schemaCanvas = $state<SchemaCanvasApi>();

	/**
	 * Takes the reader to the control that fixes a problem. On the canvas the
	 * editor is the panel beside the diagram, which may be folded to its
	 * strip, so it is opened first and the schema's node brought into view.
	 * Every problem sits on the editor's Definition tab, so that tab is shown.
	 */
	async function focusProblem(target: string) {
		if (editorTab !== 'definition') {
			editorTab = 'definition';
			await tick();
		}
		if (view === 'canvas') {
			canvasPanelOpen = true;
			if (saved?.name) schemaCanvas?.reveal(saved.name);
			await tick();
		}
		const found = document.getElementById(target);
		// A radio group takes focus on its chosen radio, the way Tab enters it.
		const el =
			found?.getAttribute('role') === 'radiogroup'
				? (found.querySelector<HTMLElement>('[aria-checked="true"]') ?? found.querySelector<HTMLElement>('[role="radio"]'))
				: found;
		el?.focus();
		el?.scrollIntoView?.({ block: 'center' });
	}

	/** What a save does to columns that already exist, and how many rows they hold. */
	const change = $derived(selected ? changesOf(saved, selected) : changesOf(null, { name: '', display_name: '', fields: [] }));
	// Undefined while the count is on its way or when it could not be read.
	// Either way it is unknown, and an unknown count is never shown as 0.
	const rowsAtRisk = $derived<number | undefined>(saved ? rowCounts[saved.name] : undefined);

	/**
	 * Why a row's localized mark was just cleared, by row id. It stays beside
	 * the row until the field can carry the mark again, so the change the
	 * operator did not ask for is never silent. Held here so a switch between
	 * the list and the canvas keeps it.
	 */
	let localizedCleared = $state<Record<string, string>>({});

	// The writes. Each is a hidden form the toolbar submits, so a save goes
	// through the server the way every other write in the admin does, and the
	// engine's refusals come back as sentences rather than response bodies.
	let saveForm = $state<HTMLFormElement>();
	let previewForm = $state<HTMLFormElement>();
	let deleteForm = $state<HTMLFormElement>();
	let saving = $state(false);
	let previewing = $state(false);
	let previewIntent = $state<'look' | 'save'>('look');

	const schemaJSON = $derived(selected ? JSON.stringify(wireSchema(selected)) : '');
	const renamesJSON = $derived(JSON.stringify(change.renames));

	/**
	 * The one way into a save. A save that renames, retypes or drops a column
	 * on a table that exists shows the DDL and the row count first. Any other
	 * save goes straight through.
	 */
	function requestSave() {
		if (!selected || !canWrite || saving) return;
		if (problems.length > 0) {
			showProblems = true;
			focusProblem(problems[0].target);
			return;
		}
		if (!isNewSchema && isRisky(change)) {
			previewIntent = 'save';
			previewForm?.requestSubmit();
			return;
		}
		saveForm?.requestSubmit();
	}

	function requestPreview() {
		if (!selected?.name) return;
		previewIntent = 'look';
		previewForm?.requestSubmit();
	}

	const submitSave: SubmitFunction = () => {
		saving = true;
		saveError = '';
		stale = false;
		return async ({ result }) => {
			saving = false;
			// The confirmation belongs to the save that asked for it, whatever the
			// answer. Left open it would read as a second, unrelated preview.
			closeDDLPreview();
			if (result.type === 'success' && result.data && 'saved' in result.data) {
				const stored = withIds(result.data.saved as Schema);
				const idx = schemas.findIndex((s) => s.name === stored.name);
				if (idx >= 0) schemas[idx] = stored;
				else schemas = [...schemas, stored];
				open(stored);
				toast.success(`Saved ${stored.display_name || stored.name}`);
				// A save that removes a field queues its drop, and the header counts the queue.
				void invalidate(MIGRATIONS_DEPENDENCY);
			} else if (result.type === 'failure') {
				const d = (result.data ?? {}) as { error?: string; renamed?: { from: string; to: string }[]; version?: string; stale?: boolean };
				saveError = d.error ?? 'Could not save the schema. Try again.';
				stale = d.stale === true;
				// A rename the engine already ran is part of the saved side now, or
				// the next save would ask it to rename a column that has moved. The
				// version it stored is the one the next save names.
				if (saved && d.renamed?.length) {
					for (const r of d.renamed) {
						const f = saved.fields.find((x) => x.name === r.from);
						if (f) f.name = r.to;
					}
					if (d.version) saved.version = d.version;
				}
			} else if (result.type === 'error') {
				saveError = 'Could not save the schema. Try again.';
			}
		};
	};

	/**
	 * Opens the content type again as the engine holds it now, after a save
	 * was refused because someone changed it since it was opened. The edits on
	 * screen are dropped, which is what the operator asked for.
	 */
	let reloading = $state(false);
	async function reloadSchema() {
		const name = saved?.name;
		if (!name || reloading) return;
		reloading = true;
		try {
			await invalidateAll();
		} finally {
			reloading = false;
		}
		const fresh = data.loadGate ? undefined : (data.schemas ?? []).find((s) => s.name === name);
		if (fresh) {
			open(fresh);
			return;
		}
		saveError = data.loadGate ? 'Could not reload the schema. Try again.' : `The schema ${name} no longer exists.`;
	}

	// The preview result, for the read-only dialog and for the save that asked.
	let ddlPreview = $state<DryRunStatement[] | null>(null);
	let ddlPreviewError = $state('');
	let riskOpen = $state(false);

	const submitPreview: SubmitFunction = () => {
		previewing = true;
		return async ({ result }) => {
			previewing = false;
			if (result.type === 'success' && result.data && 'statements' in result.data) {
				ddlPreview = result.data.statements as DryRunStatement[];
				ddlPreviewError = '';
			} else {
				ddlPreview = [];
				ddlPreviewError =
					result.type === 'failure' && result.data && 'error' in result.data
						? String(result.data.error)
						: 'Could not preview the DDL. Try again.';
			}
			if (previewIntent === 'save') riskOpen = true;
		};
	};

	function closeDDLPreview() {
		ddlPreview = null;
		ddlPreviewError = '';
		riskOpen = false;
	}

	/** Permanently deletes the schema definition and drops its table with every row. */
	async function deleteSchema() {
		if (!saved?.name) return;
		const name = saved.name;
		const rows = rowCounts[name];
		const ok = await confirm(
			`Delete schema ${name}?`,
			rows === undefined
				? 'This deletes the definition, its table and every row in it. Could not count the rows. This cannot be undone.'
				: rows > 0
					? `This deletes the definition, its table and all ${rows} ${rows === 1 ? 'row' : 'rows'} in it. This cannot be undone.`
					: 'This deletes the definition and its table. This cannot be undone.',
			{ confirmLabel: 'Delete' },
		);
		if (ok) deleteForm?.requestSubmit();
	}

	const submitDelete: SubmitFunction = () => {
		return async ({ result }) => {
			if (result.type === 'success' && result.data && 'deleted' in result.data) {
				const name = String(result.data.deleted);
				schemas = schemas.filter((s) => s.name !== name);
				open(null);
				toast.success(`Deleted ${name}`);
				// The last definition's delete clears its table's queued rows from the log.
				void invalidate(MIGRATIONS_DEPENDENCY);
			} else if (result.type === 'failure') {
				saveError = String((result.data as { error?: string })?.error ?? 'Could not delete the schema. Try again.');
			}
		};
	};

	// Renaming moves the table, so it has its own dialog and form. The page
	// takes the stored schema back and opens it under its new name.
	let renameModal = $state<ReturnType<typeof RenameModal>>();

	function renamed(from: string, raw: Schema) {
		const stored = withIds(raw);
		schemas = schemas.map((s) => (s.name === from ? stored : s));
		open(stored);
	}

	function newSchema() {
		void (async () => {
			if (!(await mayDiscard())) return;
			open({
				name: '', display_name: '', fields: [],
				with_created_at: false, with_updated_at: false,
				with_soft_delete: false, with_localization: false,
			}, false);
			view = 'list';
		})();
	}

	const isSuperAdmin = $derived(data.isSuperAdmin === true);
	const ddl = new DdlHistory({
		table: () => saved?.name,
		isSuperAdmin: () => isSuperAdmin,
		rowCounts: () => rowCounts,
	});

	/** Starts a download without leaving the page, so no unsaved-changes prompt runs. */
	function download(href: string) {
		const a = document.createElement('a');
		a.href = href;
		a.download = '';
		document.body.append(a);
		a.click();
		a.remove();
	}

	// Import has its own drawer and its own two-step form. The menu opens it.
	let importDrawer = $state<ReturnType<typeof ImportDrawer>>();

	const transferItems = $derived([
		{ label: 'Export as YAML', icon: Download, onclick: () => download('/admin/schema/export') },
		{ label: 'Export as JSON', icon: Download, onclick: () => download('/admin/schema/export?format=json') },
		// Import creates schemas, so it is not offered beside a list that could not be read.
		...(isSuperAdmin && !data.loadGate ? [{ label: 'Import', icon: Upload, onclick: () => importDrawer?.show() }] : []),
	]);

	/** Whether focus is in a control that owns its own undo. */
	function editingText(): boolean {
		const el = document.activeElement as HTMLElement | null;
		if (!el) return false;
		return el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA';
	}

	function onKey(e: KeyboardEvent) {
		if (!(e.ctrlKey || e.metaKey) || !selected) return;
		const key = e.key.toLowerCase();
		if (key === 's') {
			e.preventDefault();
			requestSave();
		} else if (!editingText() && key === 'z') {
			e.preventDefault();
			if (e.shiftKey) redo();
			else undo();
		} else if (!editingText() && key === 'y') {
			e.preventDefault();
			redo();
		}
	}

	function beforeUnload(e: BeforeUnloadEvent) {
		if (dirty) e.preventDefault();
	}

	// A link out of the page asks first while there are edits. The navigation
	// is canceled, the question asked, and the same destination taken again
	// once the answer is yes.
	let leaving = false;
	beforeNavigate(({ cancel, to, type }) => {
		if (leaving || !dirty || type === 'leave' || !to) return;
		cancel();
		void (async () => {
			if (!(await mayDiscard())) return;
			leaving = true;
			await goto(to.url);
			leaving = false;
		})();
	});
</script>

<svelte:window onkeydown={onKey} onbeforeunload={beforeUnload} />

<!-- The editor for one schema, beside the rail in the list and beside the
     diagram on the canvas, so both edit the same way. -->
{#snippet editorBody()}
	{#if selected}
		<SchemaEditor
			bind:schema={selected}
			bind:localizedCleared
			{saved}
			{schemas}
			{canWrite}
			{isNewSchema}
			{dirty}
			{saveError}
			onreload={stale ? reloadSchema : undefined}
			{reloading}
			{problems}
			{isSuperAdmin}
			{ddl}
			bind:tab={editorTab}
			onrename={() => renameModal?.show()}
		/>
	{/if}
{/snippet}

<!-- The toolbar is the header, as it is in the flow editor: the shell's title
     row is not drawn, so the list and the fields start one row below the
     frame. The h1 stays, for assistive technology. -->
<PageShell title="Schema builder" fill titleHidden>
	<div class="flex min-h-0 flex-1 flex-col overflow-hidden">
		{#if selected}
			<form method="POST" action="?/save" use:enhance={submitSave} bind:this={saveForm} class="hidden">
				<input type="hidden" name="schema" value={schemaJSON} />
				<input type="hidden" name="original" value={saved?.name ?? ''} />
				<input type="hidden" name="version" value={saved?.version ?? ''} />
				<input type="hidden" name="renames" value={renamesJSON} />
			</form>
			<form method="POST" action="?/preview" use:enhance={submitPreview} bind:this={previewForm} class="hidden">
				<input type="hidden" name="schema" value={schemaJSON} />
				<input type="hidden" name="intent" value={previewIntent} />
				<input type="hidden" name="renames" value={renamesJSON} />
			</form>
			<form method="POST" action="?/delete" use:enhance={submitDelete} bind:this={deleteForm} class="hidden">
				<input type="hidden" name="name" value={saved?.name ?? ''} />
			</form>
			{#if isSuperAdmin}
				<form method="POST" action="?/history" use:enhance={ddl.submit} bind:this={ddl.form} class="hidden">
					<input type="hidden" name="name" value={saved?.name ?? ''} />
				</form>
				<form method="POST" action="?/applyPending" use:enhance={ddl.submitApply} bind:this={ddl.applyForm} class="hidden">
					<input type="hidden" name="name" value={saved?.name ?? ''} />
				</form>
			{/if}
		{/if}

		<div class="shrink-0 border-b border-line px-3 py-2">
			<Toolbar label="Schema builder">
				<!-- The list editor is the whole builder. The switch is drawn only
				     when the build carries a diagram to switch to. -->
				{#if hasSchemaCanvas}
					<SegmentedControl
						label="View"
						labelHidden
						bind:value={view}
						options={[
							{ value: 'list', label: 'List', icon: List },
							{ value: 'canvas', label: 'Canvas', icon: Network },
						]}
					/>
				{/if}
				{#if canWrite}
					<!-- The one place a schema is started from. A list that could
					     not be read offers no create beside it. -->
					{#if !data.loadGate}
						<Button variant="secondary" size="sm" onclick={newSchema}>
							<Plus size={ICON.sm} /> New schema
						</Button>
					{/if}
					{#if hasPresets && !data.loadGate}
						<Button variant="ghost" size="sm" onclick={() => (showPresets = true)}>
							<LayoutTemplate size={ICON.sm} /> Presets
						</Button>
					{/if}
					<!-- Moving content types between instances. Export is a read an admin
					     may make. Import runs DDL, so the engine holds it to super_admin. -->
					<Dropdown items={transferItems}>
						{#snippet trigger({ open, toggle })}
							<Button variant="ghost" size="sm" aria-label="Import and export" aria-haspopup="menu" aria-expanded={open} onclick={toggle}>
								<Ellipsis size={ICON.sm} />
							</Button>
						{/snippet}
					</Dropdown>
				{/if}
				{#if selected}
					<span class="flex min-w-0 items-baseline gap-2" data-testid="schema-status">
						<span class="truncate text-sm font-medium text-fg">
							{selected.display_name || selected.name || 'New schema'}
						</span>
						{#if selected.name}
							<code class="truncate font-mono text-xs text-faint">{tableName(selected.name)}</code>
						{/if}
						{#if dirty}
							<Badge tone="warn" dot>{isNewSchema ? 'Not saved yet' : 'Unsaved changes'}</Badge>
						{:else}
							<Badge tone="success" dot>Saved</Badge>
						{/if}
					</span>
					<ProblemsMenu
						id="schema-problems"
						title="Fix these before saving"
						problems={problemItems}
						bind:open={showProblems}
						onjump={(p) => {
							const target = problemItems.find((x) => x.key === p.key)?.target;
							if (target) void focusProblem(target);
						}}
					/>
				{/if}
				{#snippet actions()}
					{#if selected && canWrite}
						<ButtonGroup>
							<Button variant="ghost" size="sm" disabled={!historyState.canUndo} onclick={undo} aria-label="Undo" hint="Undo (Ctrl+Z)">
								<Undo2 size={ICON.sm} />
							</Button>
							<Button variant="ghost" size="sm" disabled={!historyState.canRedo} onclick={redo} aria-label="Redo" hint="Redo (Ctrl+Shift+Z)">
								<Redo2 size={ICON.sm} />
							</Button>
						</ButtonGroup>
						<Button
							variant="secondary"
							size="sm"
							onclick={requestPreview}
							loading={previewing && previewIntent === 'look'}
							disabled={!selected.name}
							hint="The DDL a save would run"
						>
							<Eye size={ICON.sm} /> Preview DDL
						</Button>
						{#if saved}
							<Button variant="ghost" size="sm" class="text-danger" onclick={deleteSchema} aria-label="Delete schema {saved.name}" hint="Delete the schema and its table">
								<Trash2 size={ICON.sm} />
							</Button>
						{/if}
						<Button
							variant="primary"
							size="sm"
							onclick={requestSave}
							disabled={!dirty || problems.length > 0}
							loading={saving || (previewing && previewIntent === 'save')}
							hint={!dirty ? 'No unsaved changes' : problems.length > 0 ? 'Fix the problems first' : 'Save (Ctrl+S)'}
						>
							<Save size={ICON.sm} /> Save
						</Button>
					{/if}
				{/snippet}
			</Toolbar>
		</div>

		{#if data.loadGate}
			<div class="shrink-0 px-3 pt-3">
				<GateNotice
					level={2}
					gate={data.loadGate}
					title="Schemas"
					absent="Schemas are not included in this build."
				/>
			</div>
		{/if}
		{#if !canWrite && !data.loadGate}
			<div class="shrink-0 px-3 pt-3">
				<Alert tone="brand">Your role can view schemas but not change them. Changing one needs the admin or super_admin role.</Alert>
			</div>
		{/if}
		{#if presetCreated}
			<div class="shrink-0 px-3 pt-3">
				<Alert tone="success" title="Preset created" autoDismiss>
					{#snippet children()}
						{presetCreated.length === 1 ? 'Created one schema' : `Created ${presetCreated.length} schemas`}: {presetCreated.join(', ')}. {presetCreated.length === 1 ? 'Select it' : 'Select one'} to see its fields.
					{/snippet}
				</Alert>
			</div>
		{/if}

		<!-- One column below lg: the list on top and the editor under it, each
		     scrolling on its own. The list keeps the whole height until a schema is
		     picked or the canvas is shown. An open schema folds it to its header,
		     and the canvas alone takes three fifths of it. Side by side, a 400px screen would give the editor 112px, and the
		     shell's own 224px sidebar arrives at md: and takes the room out of the
		     editor, so the pair docks only from lg:, where there is room for both. -->
		<div class="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
			<ResizableAside
				storageKey="lyeve-schema-list"
				label="Content types"
				side="start"
				width={288}
				min={200}
				max={480}
				breakpoint="lg"
				collapsible
				class={listFolded ? 'shrink-0' : selected || view === 'canvas' ? 'max-h-2/5 shrink-0' : 'flex-1'}
				testId="schema-list"
			>
				{#snippet meta()}
					<span class="flex items-center gap-2">
						<!-- A count the engine did not answer is not a zero. -->
						{#if !data.loadGate}
							<span class="text-xs tabular-nums text-faint">{schemas.length}</span>
						{/if}
						{#if selected}
							<Button
								variant="ghost"
								size="sm"
								class="lg:hidden"
								aria-expanded={!listFolded}
								aria-controls="schema-rail"
								onclick={() => (listShown = !listShown)}
							>
								{listFolded ? 'Show the list' : 'Hide the list'}
							</Button>
						{/if}
					</span>
				{/snippet}

				<div id="schema-rail" class={listFolded ? 'max-lg:hidden' : ''}>
					<SchemaRail {schemas} {rowCounts} current={saved?.name} onselect={selectSchema} />
				</div>
			</ResizableAside>

			{#if view === 'canvas' && SchemaCanvas && data.canvasGate}
				<div class="flex min-h-0 min-w-0 flex-1 items-center justify-center p-6" data-testid="schema-canvas-unread">
					<GateNotice level={2} gate={data.canvasGate} title="Schema canvas" absent="The schema canvas is not included in this build. You can do everything in the list editor." />
				</div>
			{:else if view === 'canvas' && SchemaCanvas && !canvasLicensed}
				<div class="flex min-h-0 min-w-0 flex-1 items-center justify-center p-6" data-testid="schema-canvas-locked">
					<NotEnabled
						level={2}
						title="Schema canvas"
						description="See every content type and its relations as a diagram you edit in place, with a layout your team shares. Your license does not include it. You can do everything else in the list editor."
					/>
				</div>
			{:else if view === 'canvas' && SchemaCanvas}
				<!-- The diagram and, once a node is picked, its editor beside it: the
				     same editor the list view shows, so a schema is edited the same way
				     from either. Below lg: the panel stacks under the diagram. -->
				<div class="flex min-h-0 min-w-0 flex-1 flex-col lg:flex-row">
					<div class="relative min-h-0 min-w-0 flex-1">
						<SchemaCanvas
							bind:this={schemaCanvas}
							{schemas}
							{selected}
							onselect={selectSchema}
							{rowCounts}
							savedPositions={data.canvas?.positions}
							onpositions={canWrite ? saveLayout : undefined}
							onaddfield={canWrite
								? async (name: string) => {
										const s = schemas.find((x) => x.name === name);
										if (!s) return;
										await selectSchema(s);
										if (saved?.name === name && selected) {
											addField(selected);
											editorTab = 'definition';
										}
									}
								: undefined}
							onrelate={canWrite
								? async (from: string, to: string | null) => {
										const s = schemas.find((x) => x.name === from);
										if (!s) return;
										await selectSchema(s);
										if (saved?.name === from && selected) {
											addRelation(selected, to ?? undefined);
											editorTab = 'definition';
										}
									}
								: undefined}
						/>
					</div>
					{#if selected}
						<ResizableAside
							storageKey="lyeve-schema-canvas-panel"
							bind:open={canvasPanelOpen}
							label="Schema"
							side="end"
							width={600}
							min={420}
							max={880}
							breakpoint="lg"
							collapsible
							class="max-h-1/2 shrink-0 lg:max-h-none"
							testId="schema-canvas-panel"
						>
							{#snippet meta()}
								<span class="truncate font-mono text-xs text-faint">{selected?.name || 'new'}</span>
							{/snippet}
							<div class="flex min-h-0 flex-col">
								{@render editorBody()}
							</div>
						</ResizableAside>
					{/if}
				</div>
			{:else}
				<div class="flex min-h-0 min-w-0 flex-1 flex-col">
					{#if selected}
						{@render editorBody()}
					{:else if schemas.length === 0 && !data.loadGate}
						<!-- The offer the flow editor makes from its empty canvas: a way in
						     that is not a blank form. A preset is a set of content types
						     the engine ships. New schema in the toolbar stays the other door. -->
						<div class="flex h-full items-center justify-center">
							<EmptyState
								title="No schemas yet"
								description={canWrite
									? hasPresets
										? 'Start one with New schema in the toolbar, or create a ready-made set from a preset.'
										: 'Start one with New schema in the toolbar.'
									: 'Ask an admin to create one.'}
							>
								{#snippet iconSnippet()}
									<Table2 size={ICON.lg} />
								{/snippet}
								{#snippet action()}
									{#if hasPresets && canWrite}
										<Button variant="secondary" onclick={() => (showPresets = true)}>
											<LayoutTemplate size={ICON.sm} />
											Use a preset
										</Button>
									{/if}
								{/snippet}
							</EmptyState>
						</div>
					{:else if schemas.length > 0}
						<div class="flex h-full items-center justify-center">
							<EmptyState
								title="No schema selected"
								description={canWrite ? 'Pick one from the list, or start one with New schema in the toolbar.' : 'Pick one from the list.'}
							>
								{#snippet iconSnippet()}
									<Table2 size={ICON.lg} />
								{/snippet}
							</EmptyState>
						</div>
					{/if}
				</div>
			{/if}
		</div>
	</div>
</PageShell>

<form method="POST" action="?/saveLayout" use:enhance={layoutSubmit} bind:this={layoutForm} class="hidden">
	<input type="hidden" name="positions" value={layoutJSON} />
</form>

<PresetsDrawer
	bind:open={showPresets}
	presets={data.presets}
	presetsGate={data.presetsGate}
	canWrite={data.canWrite}
	{canSavePresets}
	applyFailure={presetError}
	deleteFailure={presetDeleteError}
/>

<ImportDrawer bind:this={importDrawer} />

<DdlPreview
	statements={ddlPreview}
	error={ddlPreviewError}
	risk={riskOpen}
	{change}
	{rowsAtRisk}
	table={saved?.name}
	{saving}
	onclose={closeDDLPreview}
	onsave={() => saveForm?.requestSubmit()}
/>

<RenameModal bind:this={renameModal} name={saved?.name} onrenamed={renamed} />
