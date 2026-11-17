<script lang="ts">
	import { Alert, Badge, Button, EmptyState, PageShell, Pagination, Table, confirm, toast } from '@lyeve-labs/ui-kit';
	import { BookOpen, Download, Keyboard, LayoutGrid, LayoutTemplate, PanelLeft, Play, Upload, Workflow } from '@lucide/svelte';
	import { page } from '$app/state';
	import { actionWithQuery, listBack, queryWithout } from '#lib/back.ts';
	import { FLOW_LIST_KEYS } from '../list-keys';
	import { enhance } from '#lib/enhance.ts';
	import { beforeNavigate, goto } from '$app/navigation';
	import { createClient } from '@lyeve-labs/client';
	import type { SubmitFunction } from '$app/forms';
	import type { ActionData, PageData } from './$types';
	import { FlowCanvas, hasFlowCanvas } from '#lib/canvas/flow.ts';
	import type { FlowCanvasApi } from '#lib/canvas/contract.ts';
	import NodePalette from '#lib/components/flow/NodePalette.svelte';
	import FlowInspector from '#lib/components/flow/FlowInspector.svelte';
	import EditorDrawer from '#lib/components/flow/EditorDrawer.svelte';
	import SidePanel from '#lib/components/flow/SidePanel.svelte';
	import FlowToolbar from '#lib/components/flow/FlowToolbar.svelte';
	import FlowVersions from '#lib/components/flow/FlowVersions.svelte';
	import TestPanel from '#lib/components/flow/TestPanel.svelte';
	import FlowGuide from '#lib/components/flow/FlowGuide.svelte';
	import AssistantPanel from '#lib/components/flow/AssistantPanel.svelte';
	import FlowExportModal from '#lib/components/flow/FlowExportModal.svelte';
	import FlowTemplateGallery from '#lib/components/flow/FlowTemplateGallery.svelte';
	import FlowImportDrawer, { type ImportFailure } from '#lib/components/flow/FlowImportDrawer.svelte';
	import NotEnabled from '#lib/components/NotEnabled.svelte';
	import GateNotice from '#lib/components/GateNotice.svelte';
	import { pageHref, pageNumber } from '#lib/api/list.ts';
	import { useInstance } from '#lib/instance.svelte.ts';
	import InlineUpgradeLink from '#lib/components/InlineUpgradeLink.svelte';
	import { csrfHeaders } from '#lib/api/csrf.ts';
	import { submitter } from '#lib/forms.svelte.ts';
	import type { TablesState } from '#lib/components/flow/TablesPanel.svelte';
	import {
		exportFlow,
		introspectDatasource,
		testFlow,
		validateFlow,
		type FlowRun,
		type FlowTemplate,
		type ValidationResult,
	} from '#lib/api/flows.ts';
	import { cleanJSON, cloneDefinition, nodeById, normalizeDefinition, specFor } from '#lib/flow/graph.ts';
	import { AssistantState } from '#lib/flow/assistant.svelte.ts';
	import type { AssistProblem } from '#lib/api/assist.ts';
	import { emptyDefinition, type FlowDefinition, type FlowStatus, type RefusalNotice, type Selection } from '#lib/flow/types.ts';
	import { tick, untrack } from 'svelte';
	import { formatDuration } from '#lib/flow/time.ts';
	import { defaultTriggerJSON, statusTone, triggerLabel } from '#lib/flow/triggers.ts';
	import { blockedText, missingPluginOf } from '#lib/flow/blocked.ts';
	import { flowGrants } from '#lib/flow/permissions.ts';
	import { draftIsLive, writeButtons } from '#lib/flow/publish.ts';
	import { describeError } from '#lib/flow/problems.ts';
	import type { ProblemItem } from '#lib/components/ProblemsMenu.svelte';
	import { FlowRefusal, refusalAware, type ValidationError } from '#lib/api/flows.ts';
	import { formatDateTime, relativeTime } from '#lib/format.ts';
	import { focusMode } from '#lib/flow/focus.svelte.ts';
	import { parseTrigger, sampleKey, testFailure, untilOptions } from '#lib/flow/test-run.ts';
	import { renewingOnce } from '#lib/renew.ts';
	import { ICON } from '#lib/icon.ts';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// The list's filter rides on the row link, so the way back lands on the
	// same slice of Flows the reader opened this one from.
	const back = $derived(listBack('/admin/flows', 'Flows', page.url, FLOW_LIST_KEYS));

	// The shell shows why the page is unavailable while the flow plugin does
	// not run. A plugin that runs and refuses its routes is said here.
	const enabled = $derived(!data.locked);

	// What the caller's roles grant on this flow, as the plugin carries it
	// on the flow. A control the role cannot use is not drawn. The engine
	// still decides and its 403 renders inline. Update covers save and
	// import. Activate covers publish, disable, rollback and test.
	const can = $derived(flowGrants(data.flow?.actions));
	// The datasources and the variables are admin routes, so the shortcuts to
	// them are drawn only for a role the plugin answers there.
	const isAdmin = $derived(data.user.roles.includes('admin') || data.user.roles.includes('super_admin'));

	// The 402 the plugin answered, when the last action was one. Read
	// through the type because the action data is a union of every
	// action's answer and the key is optional on all of them.
	const refusal = $derived(form && 'refusal' in form && form.refusal ? (form.refusal as RefusalNotice) : null);
	const instance = useInstance();
	// A ceiling refusal can name where a license allowing more is bought,
	// and that link goes first when it is safe to follow.
	const enableLink = $derived(instance.upgradeLink(refusal?.upgradeUrl || null));

	// The page owns the definition. The canvas and the inspector both edit it
	// and the save action posts it. Nothing else holds a copy. It is seeded
	// from the load once, and reseeded only by an action that moved the draft
	// on the server (a rollback, an import): a re-run load never replaces
	// what the reader is editing underneath them.
	const initial = untrack(() => data.flow);
	let definition = $state<FlowDefinition>(cloneDefinition(initial?.draft ?? emptyDefinition('', '')));
	let selected = $state<Selection>(null);
	let canvas = $state<FlowCanvasApi>();
	let history = $state({ canUndo: false, canRedo: false });
	let status = $state<FlowStatus>(initial?.status ?? 'draft');
	let version = $state(initial?.version ?? 0);
	let savedAt = $state(initial?.updated_at ?? '');
	// The slug the engine answers at until a save moves it.
	let savedSlug = $state(initial?.slug ?? '');

	const flowId = initial?.id ?? '';
	const definitionJSON = $derived(JSON.stringify(definition));

	// Dirty is a comparison, not a flag. The canonical form of what is on the
	// canvas against the canonical form of what the server holds is right
	// after an undo back to the saved state, which a flag set on every change
	// cannot be.
	const canonical = $derived(cleanJSON(definition));
	let saved = $state(cleanJSON(untrack(() => definition)));
	const dirty = $derived(canonical !== saved);

	// The canonical draft known to be the published version, or null when
	// it is not known to be. Publish has nothing to do while the draft on
	// the canvas is that one and the flow is live.
	let liveDraft = $state<string | null>(
		untrack(() => (initial && data.versions.ok && draftIsLive(initial, data.versions.value) ? cleanJSON(definition) : null)),
	);
	// Without the versions nobody knows whether the saved draft is the live
	// one, and the toolbar says so rather than calling it unpublished.
	const versionsUnread = $derived(!data.versions.ok);

	// Validation, 500 ms after the last change. A browser client so the CSRF
	// cookie is echoed on the write. The saved draft was validated when it was
	// saved, so the first render and a reseed ask nothing.
	let validation = $state<ValidationResult | null>(null);
	let validating = $state(false);
	$effect(() => {
		const snap = canonical;
		if (snap === untrack(() => saved) && untrack(() => validation) === null) return;
		const timer = setTimeout(() => {
			void validate(snap);
		}, 500);
		return () => clearTimeout(timer);
	});

	/** Puts the server's draft on the canvas after an action moved it there. */
	function reseed(flow: { draft: FlowDefinition; status: FlowStatus; version: number; updated_at: string; slug?: string }) {
		definition = cloneDefinition(flow.draft);
		if (flow.slug) savedSlug = flow.slug;
		saved = cleanJSON(flow.draft);
		status = flow.status;
		version = flow.version;
		savedAt = flow.updated_at;
		liveDraft = data.versions.ok && draftIsLive(flow, data.versions.value) ? saved : null;
		selected = null;
		validation = null;
		runBlocked = false;
	}

	/*
	 * The editor validates the draft, lists a datasource's tables and runs a
	 * test from the browser rather than through a load or an action. Each is
	 * a read about a draft that exists only on this page: validation follows
	 * every edit half a second later, and a form action would post the whole
	 * definition and rerun the page's load on every keystroke, which would
	 * reread the catalog and the runs and could not keep up. None of them
	 * writes anything the engine stores. The session cookie and the CSRF
	 * header ride along on a same-origin request, so the engine applies the
	 * same role and tenant as it does to the page's own reads.
	 */
	function browserClient() {
		return createClient(refusalAware(fetch), csrfHeaders());
	}

	async function validate(snap: string) {
		if (!flowId) return;
		validating = true;
		try {
			validation = await validateFlow(browserClient(), flowId, JSON.parse(snap) as FlowDefinition);
		} catch (err) {
			// Nodes this instance does not enable are problems on the canvas,
			// as the save would mark them.
			if (err instanceof FlowRefusal && err.errors.length > 0) validation = { ok: false, errors: err.errors };
			// Any other refused validation is not a broken draft. The save reports it.
		} finally {
			validating = false;
		}
	}

	const errors = $derived(validation?.errors ?? []);

	// The problems list opens from the count in the toolbar and closes with
	// its last problem.
	let showProblems = $state(false);
	const problems = $derived(errors.map((e, i) => ({ item: describeError(e, definition, data.catalog, i), err: e })));
	const problemItems = $derived(problems.map((p) => p.item));
	const errorOf = (item: ProblemItem) => problems.find((p) => p.item.key === item.key)?.err;

	/**
	 * Takes the reader to what an error names: the node is selected, so the
	 * inspector shows the field it is about, and brought into view. An error
	 * on the flow itself or its trigger shows the flow settings, which is
	 * what the inspector holds with nothing selected.
	 */
	function focusProblem(err: ValidationError) {
		const onNode = !!err.node_id && err.node_id !== 'trigger' && !!nodeById(definition, err.node_id);
		selected = onNode ? { kind: 'node', id: err.node_id as string } : null;
		inspectorOpen = true;
		if (typeof window !== 'undefined' && !window.matchMedia?.('(min-width: 1280px)').matches) {
			showInspector = true;
			showPalette = false;
		}
		canvas?.reveal(onNode ? (err.node_id as string) : 'trigger');
	}

	// Introspection, once per datasource for the life of the page. The loading
	// entry is written before the request leaves so the form's effect asks once.
	let tables = $state<Record<string, TablesState>>({});

	async function introspect(id: string) {
		tables = { ...tables, [id]: { status: 'loading', tables: [] } };
		try {
			const result = await introspectDatasource(browserClient(), id);
			tables = { ...tables, [id]: { status: 'ready', tables: result.tables } };
		} catch {
			tables = { ...tables, [id]: { status: 'error', tables: [], message: 'Could not load tables. Check the datasource and try again.' } };
		}
	}

	/** Puts a template on the canvas, keeping this flow's name and slug, and brings all of it into view. */
	async function startFromTemplate(t: FlowTemplate) {
		definition = {
			...cloneDefinition(t.definition),
			name: definition.name,
			slug: definition.slug,
			description: definition.description ?? t.definition.description,
		};
		selected = null;
		showGallery = false;
		await tick();
		canvas?.fit();
	}

	let showKeys = $state(false);

	// The three ways to start an empty canvas, none of them required. A
	// reader may drag a node in without answering. These are the same three
	// doors GitHub Actions opens on a new workflow, from inside the editor
	// rather than before it exists.
	let showGallery = $state(false);

	/** Opens the palette where it is closed, and puts the cursor in its filter. */
	async function startFromPalette() {
		paletteOpen = true;
		showPalette = true;
		showInspector = false;
		await tick();
		document.getElementById('palette-search')?.focus();
	}

	// Below the xl breakpoint the two side panels overlay the canvas one at a
	// time, opened from the toolbar. Above it they are beside it, and each
	// collapses to a strip. The collapse is for the session. The widths the
	// panels own are remembered.
	let showPalette = $state(false);
	let showInspector = $state(false);
	let paletteOpen = $state(true);
	let inspectorOpen = $state(true);

	// Focus mode hides the shell's frame while the editor is open, and fits
	// the canvas again once the frame has changed.
	const focus = focusMode(() => canvas?.openingFit());

	// Test runs
	let triggerJSON = $state('');
	let triggerType = $state('');
	$effect(() => {
		const key = sampleKey(definition.trigger);
		if (key !== triggerType) {
			triggerType = key;
			const { type, config } = definition.trigger;
			triggerJSON = defaultTriggerJSON(type, untrack(() => config), specFor(data.catalog, type));
		}
	});
	let live = $state(false);
	let untilNode = $state<string | null>('');
	let testing = $state(false);
	let testError = $state('');
	let lastRun = $state<FlowRun | null>(null);
	let focusStep = $state<string | null>(null);

	// A contributed trigger's payload is spread beside its type, and the
	// catalog names none of the keys, so the hint says where they go.
	const contributedTrigger = $derived(specFor(data.catalog, definition.trigger.type)?.plugin !== undefined);

	const nodeOptions = $derived(untilOptions(definition.nodes));

	async function runTest() {
		const trigger = parseTrigger(triggerJSON);
		if (!trigger.ok) {
			testError = trigger.error;
			return;
		}
		testing = true;
		testError = '';
		try {
			const request = { trigger: trigger.value, definition: cloneDefinition(definition), live, until_node: untilNode || undefined };
			lastRun = await renewingOnce(() => testFlow(browserClient(), flowId, request));
			focusStep = null;
			tab = 'test';
			drawerOpen = true;
		} catch (err) {
			const failure = testFailure(err);
			if (failure.kind === 'blocked') {
				runBlocked = true;
				drawerOpen = false;
				return;
			}
			if (failure.errors.length > 0) {
				validation = { ok: false, errors: failure.errors };
				showProblems = true;
			}
			testError = failure.text;
		} finally {
			testing = false;
		}
	}

	// Export. The panel keeps its own format and text, and the request is
	// made here with the browser client's CSRF header like the editor's other
	// reads about the draft.
	let exportPanel = $state<FlowExportModal>();
	function openExport() {
		exportPanel?.show();
	}

	let showImport = $state(false);
	// The import drawer shows an import's failure, so the notice above the
	// canvas leaves it out. Opening the drawer clears what an earlier attempt
	// left, and no other action's failure is drawn in it.
	let importCleared = $state<unknown>(null);
	const importFailure = $derived.by((): ImportFailure | null => {
		const f = form as { action?: unknown; error?: unknown; refusal?: unknown; locked?: unknown } | null;
		if (!f || f === importCleared || f.action !== 'import' || typeof f.error !== 'string') return null;
		return {
			error: f.error,
			refusal: f.refusal ? (f.refusal as RefusalNotice) : null,
			// A refusal of the flow routes as a whole carries no notice, only the flag.
			refused: !!f.refusal || f.locked === true,
		};
	});
	const importTagged = $derived(!!form && 'action' in form && form.action === 'import');
	function openImport() {
		importCleared = form;
		showImport = true;
	}
	// Delete asks through the kit's confirm dialog, then posts a hidden form,
	// so the button never posts on its own and the delete stays a form action.
	let deleteFlowForm = $state<HTMLFormElement>();
	async function askDelete() {
		const ok = await confirm(`Delete flow ${definition.name || data.flow?.name || ''}?`, 'Its versions and run history go with it.', { confirmLabel: 'Delete' });
		if (!ok) return;
		deleteFlowForm?.requestSubmit();
	}
	let disableForm = $state<HTMLFormElement | undefined>();

	// Drawer
	let drawerOpen = $state(true);
	// A page of runs is a link, so an address that names one opens on the
	// runs tab.
	let tab = $state(page.url.searchParams.has('offset') ? 'runs' : 'test');
	const runs = $derived(data.runs.ok ? data.runs.value : null);
	// The list's filter rides along, so the way back still lands on it.
	const runsHref = $derived(
		pageHref(
			page.url.pathname,
			runs?.limit ?? 20,
			Object.fromEntries(FLOW_LIST_KEYS.flatMap((k) => (page.url.searchParams.get(k) ? [[k, page.url.searchParams.get(k) ?? '']] : []))),
		),
	);
	// The Assistant tab exists only when the engine offers the assistant's
	// catalog. A tab that could only say it is not enabled is left out rather
	// than shown locked.
	const assistantOn = $derived(data.assistant === 'ready');
	const tabs = $derived([
		{ id: 'test', label: 'Test' },
		{ id: 'runs', label: 'Runs', count: runs ? (runs.total ?? runs.rows.length) : undefined },
		...(assistantOn ? [{ id: 'assistant', label: 'Assistant' }] : []),
		{ id: 'guide', label: 'Guide' },
	]);

	const assistant = new AssistantState(() => {
		tab = 'assistant';
		drawerOpen = true;
	});
	let explainForm = $state<HTMLFormElement>();

	/** Asks about a node or a problem through the hidden explain form. */
	async function ask(target: { node_id?: string; problem?: ValidationError }) {
		assistant.explainTarget = { node_id: target.node_id ?? '', problem: target.problem ? JSON.stringify(target.problem) : '' };
		await tick();
		explainForm?.requestSubmit();
	}

	/**
	 * Puts the draft on the canvas. It goes through the same door a read
	 * from the engine does, and the canvas records it as one undo step, so
	 * Ctrl+Z is the way back. The flow keeps its slug: the draft is this
	 * flow's next version, not a new flow.
	 */
	async function acceptDraft() {
		const draft = assistant.draft?.draft;
		if (!draft?.definition || draft.problems.length > 0) return;
		definition = normalizeDefinition({
			...draft.definition,
			name: draft.definition.name || definition.name,
			slug: definition.slug,
		});
		selected = null;
		assistant.draft = null;
		await tick();
		canvas?.fit();
		toast.success('Draft accepted. Save to keep it.');
	}

	/** A draft problem names a node. When the canvas has one by that id it is selected. */
	function focusDraftProblem(p: AssistProblem) {
		if (p.node_id && nodeById(definition, p.node_id)) selected = { kind: 'node', id: p.node_id };
	}

	/** Loads a past run into the viewer without leaving the page. */
	const openRun: SubmitFunction = () =>
		async ({ update }) => {
			await update({ reset: false });
			tab = 'test';
			drawerOpen = true;
		};

	// Action results. Each answer is applied once and untracked: the toast
	// store reads its own list as it appends, and an effect that tracked that
	// read would re-run on its own write.
	let announced: unknown = null;
	$effect(() => {
		if (!form || form === announced) return;
		announced = form;
		untrack(() => applyForm(form));
	});

	function applyForm(form: NonNullable<ActionData>) {
		if ('saved' in form && form.saved) {
			saved = canonical;
			savedAt = form.saved.updated_at;
			status = form.saved.status;
			version = form.saved.version;
			if (form.saved.slug && form.saved.slug !== savedSlug) {
				toast.success(`Saved. The flow is now at ${form.saved.slug}`);
				savedSlug = form.saved.slug;
			} else {
				toast.success('Draft saved');
			}
		}
		if ('published' in form && form.published) {
			saved = canonical;
			liveDraft = canonical;
			status = form.published.status;
			version = form.published.version;
			if (form.published.slug) savedSlug = form.published.slug;
			runBlocked = false;
			toast.success(`Published version ${form.published.version}`);
		}
		if ('reloaded' in form && form.reloaded) {
			reseed(form.reloaded);
			const unresolved = 'unresolved' in form && Array.isArray(form.unresolved) ? form.unresolved : [];
			if (unresolved.length > 0) toast.warn(`Imported. Missing datasources: ${unresolved.join(', ')}`);
			else toast.success(`Draft is now version ${form.reloaded.version > 0 ? form.reloaded.version : 'unpublished'}`);
		}
		if ('disabled' in form && form.disabled) {
			status = form.disabled.status;
			runBlocked = false;
			toast.success('Flow disabled');
		}
		if ('run' in form && form.run) {
			lastRun = form.run;
			focusStep = null;
		}
		if ('errors' in form && Array.isArray(form.errors)) {
			validation = { ok: false, errors: form.errors };
		}
		assistant.apply({
			assist: 'assist' in form ? form.assist : null,
			explain: 'explain' in form ? form.explain : null,
			assistRefused: 'assistRefused' in form ? form.assistRefused : null,
		});
	}

	function onKey(e: KeyboardEvent) {
		if (!(e.ctrlKey || e.metaKey)) return;
		if (e.key.toLowerCase() === 's') {
			e.preventDefault();
			if (can.update && dirty) saveForm?.requestSubmit();
		} else if (e.shiftKey && e.key.toLowerCase() === 'f') {
			e.preventDefault();
			focus.on = !focus.on;
		}
	}

	let saveForm = $state<HTMLFormElement>();

	// A run the engine refused because the flow is blocked. The status the
	// page loaded with can lag the engine's, so the refusal is a second way
	// into the same state. A reseed or a status change from a form clears it.
	let runBlocked = $state(false);
	const blocked = $derived(status === 'blocked' || runBlocked);
	// The problems list names the plugin when the draft still holds the type.
	const blockedHint = $derived(blockedText(missingPluginOf(errors)));

	const savedHint = $derived(dirty ? 'Unsaved changes' : savedAt ? `Saved ${relativeTime(savedAt)}` : 'Not saved yet');
	const pillHint = $derived(blocked ? `${blockedHint} ${savedHint}.` : savedHint);

	// Everything the toolbar does not need on every visit: the canvas action
	// first, the file actions next, then the two kinds of help. Fit to screen
	// is not here because the canvas carries it beside the zoom buttons, and
	// the flow's lifecycle sits in the toolbar as the schema builder's delete
	// does. Six rows fit the panel without a scrollbar.
	// A note is added from the palette, where it is listed as a type.
	// The list editor has no layout to arrange, so it has no layout action.
	const overflow = $derived([
		...(hasFlowCanvas ? [{ label: 'Auto layout', icon: LayoutGrid, onclick: () => canvas?.autoLayout() }] : []),
		...(can.update ? [{ label: 'Use a template', icon: LayoutTemplate, onclick: () => (showGallery = true) }] : []),
		...(can.update ? [{ label: 'Import', icon: Upload, onclick: openImport }] : []),
		{ label: 'Export', icon: Download, onclick: openExport },
		{ label: 'Shortcuts', icon: Keyboard, onclick: () => (showKeys = !showKeys) },
		{
			label: 'Guide',
			icon: BookOpen,
			onclick: () => {
				tab = 'guide';
				drawerOpen = true;
			},
		},
	]);

	function beforeUnload(e: BeforeUnloadEvent) {
		if (dirty) e.preventDefault();
	}

	const canPublish = $derived(definition.nodes.length > 0 && errors.length === 0 && !blocked);
	const writes = $derived(
		writeButtons({
			dirty,
			live: status === 'active' && liveDraft === canonical,
			liveUnknown: status === 'active' && versionsUnread && liveDraft !== canonical,
			publishable: canPublish,
			refusal: blocked ? blockedHint : definition.nodes.length === 0 ? 'Add a node before publishing' : 'Fix the issues before publishing',
		}),
	);

	const saveFlow = submitter();
	const publishFlow = submitter();
	const disableFlow = submitter();

	/** This page's route, so a navigation that stays on this flow is told apart. */
	const EDITOR_ROUTE = '/(admin)/admin/flows/[id]';

	// A delete answers with a redirect to the list, which is the one way out
	// that must not ask about the edits it is throwing away.
	let leaving = false;
	const deleteFlow = submitter(() => (leaving = true));

	// A link out of the page asks first while there are edits: the way back,
	// the datasource and variable shortcuts, the sidebar. The navigation is
	// canceled, the question asked, and the same destination taken again
	// once the answer is yes. A reload or a closed tab is beforeUnload's.
	beforeNavigate(({ cancel, to, type }) => {
		if (leaving || !dirty || type === 'leave' || !to) return;
		// A page of runs is this same editor at another address. The draft is
		// seeded once and a reload never replaces it, so nothing is lost and
		// there is nothing to ask.
		if (to.route.id === EDITOR_ROUTE && to.params?.id === data.flow?.id) return;
		cancel();
		void (async () => {
			const ok = await confirm(
				`Discard the changes to ${definition.name || 'this flow'}?`,
				'They have not been saved. Save first to keep them.',
				{ confirmLabel: 'Discard' },
			);
			if (!ok) return;
			leaving = true;
			await goto(to.url);
			leaving = false;
		})();
	});
</script>

<svelte:window onkeydown={onKey} onbeforeunload={beforeUnload} />

{#if enabled && data.flow}
	<!-- The toolbar is the header: the way back and the name live in it, so
	     the shell's own title row is not rendered and the page has one row
	     before the canvas. The h1 stays, for assistive technology. -->
	<PageShell title={definition.name || data.flow.name} documentTitle={`${data.flow?.name ?? 'Flow'} - Flows`} fill titleHidden>
		<div class="flex min-h-0 flex-1 flex-col overflow-hidden">
			<form
				method="POST"
				action="?/save"
				use:enhance={saveFlow.enhance}
				bind:this={saveForm}
				id="flow-save"
				class="hidden"
			>
				<input type="hidden" name="definition" value={definitionJSON} />
				<input type="hidden" name="name" value={definition.name} />
				<input type="hidden" name="slug" value={definition.slug} />
			</form>
			<form method="POST" action="?/publish" use:enhance={publishFlow.enhance} id="flow-publish" class="hidden">
				<input type="hidden" name="definition" value={definitionJSON} />
			</form>
			<form method="POST" action="?/disable" use:enhance={disableFlow.enhance} id="flow-disable" class="hidden" bind:this={disableForm}></form>
			{#if assistantOn}
				<form method="POST" action="?/explain" use:enhance={assistant.explainSubmit} bind:this={explainForm} id="flow-explain" class="hidden">
					<input type="hidden" name="definition" value={definitionJSON} />
					<input type="hidden" name="node_id" value={assistant.explainTarget.node_id} />
					<input type="hidden" name="problem" value={assistant.explainTarget.problem} />
					<input type="hidden" name="conversation_id" value={assistant.conversationId} />
				</form>
			{/if}

			<FlowToolbar
				{back}
				{flowId}
				shortcuts={isAdmin}
				{overflow}
				name={definition.name}
				onname={(name) => (definition = { ...definition, name })}
				slug={definition.slug}
				{status}
				{version}
				{dirty}
				{pillHint}
				problems={problemItems}
				bind:showProblems
				onjump={(p) => {
					const err = errorOf(p);
					if (err) focusProblem(err);
				}}
				onask={assistantOn
					? (p) => {
							const err = errorOf(p);
							if (err) void ask({ problem: err });
						}
					: undefined}
				askBusy={assistant.busy !== null}
				bind:showPalette
				bind:showInspector
				{history}
				onundo={() => canvas?.undo()}
				onredo={() => canvas?.redo()}
				bind:focus={focus.on}
				{can}
				ondisable={() => disableForm?.requestSubmit()}
				ondelete={askDelete}
				ontest={runTest}
				{testing}
				{writes}
				saving={saveFlow.pending}
				publishing={publishFlow.pending}
				{showKeys}
			/>

			{#if data.catalogGate.state !== 'ok'}
				<!-- The palette and every inspector form come from the node types,
				     so the editor says they could not be read rather than offering
				     an empty palette. -->
				<div class="shrink-0 px-3 pt-2" data-testid="flow-catalog-unread">
					<GateNotice level={2} gate={data.catalogGate} title="the node types" absent="Node types are not included in this build." />
				</div>
			{/if}
			{#if blocked}
				<div class="shrink-0 px-3 pt-2" data-testid="flow-blocked">
					<Alert tone="warn" title="This flow is blocked">
						{#snippet children()}{blockedHint} It runs again on its own once the plugin is started.{/snippet}
					</Alert>
				</div>
			{/if}
			{#if importTagged}
				<!-- The import drawer says it. -->
			{:else if refusal}
				<!-- The refusal is drawn where a validation problem is: the ids
				     are in the problems list and on the canvas, and this says
				     what they have in common and where the feature is turned on. -->
				<div class="shrink-0 px-3 pt-2" data-testid="flow-refusal">
					<Alert tone="warn" title={refusal.limit !== null ? 'Flow limit reached' : 'Not enabled on this instance'} dismissible>
						{#snippet children()}
							{form && 'error' in form ? form.error : ''}
							{#if enableLink}
								<InlineUpgradeLink link={enableLink} raises={refusal.limit !== null} />
							{/if}
						{/snippet}
					</Alert>
				</div>
			{:else if form && 'forbidden' in form && form.forbidden}
				<div class="shrink-0 px-3 pt-2" data-testid="flow-forbidden">
					<Alert tone="danger" title="Your role cannot do that" dismissible>
						{#snippet children()}{form.error}{/snippet}
					</Alert>
				</div>
			{:else if form && 'error' in form && form.error}
				<div class="shrink-0 px-3 pt-2">
					<Alert tone="danger" dismissible>
						{#snippet children()}{form.error}{/snippet}
					</Alert>
				</div>
			{/if}

			<div class="relative flex min-h-0 flex-1">
				<SidePanel name="palette" label="Palette" side="start" bind:open={paletteOpen} overlay={showPalette}>
					<NodePalette
						catalog={data.catalog}
						unread={data.catalogGate.state !== 'ok'}
						onadd={(type) => {
							canvas?.addNodeAtCenter(type);
							showPalette = false;
						}}
					/>
				</SidePanel>

				<div class="relative min-w-0 flex-1">
					<FlowCanvas
						bind:this={canvas}
						bind:definition
						bind:selected
						catalog={data.catalog}
						runSteps={lastRun?.steps ?? []}
						{errors}
						onhistory={(h) => (history = h)}
					>
						{#snippet empty()}
							<EmptyState
								title={hasFlowCanvas ? 'An empty canvas' : 'No nodes yet'}
								description={hasFlowCanvas
									? 'The trigger on the left starts every run. Drag a node in from the palette, or choose a starting point below.'
									: 'The trigger above starts every run. Add a node from the palette, or choose a starting point below.'}
							>
								{#snippet iconSnippet()}<Workflow size={ICON.lg} />{/snippet}
								{#snippet action()}
									<!-- One column of equal buttons: three doors side by side rank
									     themselves by width, and a column reads as a choice. -->
									<div class="flex w-64 flex-col gap-2" data-testid="empty-offers">
										<Button variant="secondary" full onclick={startFromPalette}>
											<PanelLeft size={ICON.sm} />
											Start from the palette
										</Button>
										<Button variant="secondary" full onclick={() => (showGallery = true)}>
											<LayoutTemplate size={ICON.sm} />
											Use a template
										</Button>
										{#if can.update}
											<Button variant="secondary" full onclick={openImport}>
												<Upload size={ICON.sm} />
												Import YAML or JSON
											</Button>
										{/if}
									</div>
								{/snippet}
							</EmptyState>
						{/snippet}
					</FlowCanvas>
				</div>

				<SidePanel name="inspector" label="Inspector" side="end" bind:open={inspectorOpen} overlay={showInspector}>
					<FlowInspector
						{definition}
						catalog={data.catalog}
						{selected}
						{errors}
						schemas={data.schemas}
						datasources={data.datasources}
						datasourcesGate={data.datasourcesGate}
						variables={data.variables}
						variablesGate={data.variablesGate}
						flows={data.flows}
						flowId={data.flow.id}
						{savedSlug}
						origin={page.url.origin}
						eventTypes={data.eventTypes}
						{tables}
						onintrospect={(id) => void introspect(id)}
						onchange={(def) => (definition = def)}
						onselect={(sel) => (selected = sel)}
						onguide={() => {
							tab = 'guide';
							drawerOpen = true;
						}}
						onassist={assistantOn && selected?.kind === 'node' ? () => void ask({ node_id: selected?.kind === 'node' ? selected.id : '' }) : undefined}
					/>
					{#if !selected}
						<div class="flex flex-col gap-3 border-t border-line p-4">
							<FlowVersions versions={data.versions} {version} canRollback={can.activate} />
						</div>
					{/if}
				</SidePanel>
			</div>

			<EditorDrawer bind:open={drawerOpen} active={tab} items={tabs} onchange={(id) => (tab = id)}>
				{#if tab === 'test'}
					<TestPanel
						bind:triggerJSON
						bind:live
						bind:untilNode
						{nodeOptions}
						contributed={contributedTrigger}
						error={testError}
						{testing}
						run={lastRun}
						focus={focusStep}
						onrun={runTest}
					/>
				{:else if tab === 'runs'}
					<div class="flex h-full flex-col gap-3 overflow-y-auto p-3">
						{#if !data.runs.ok}
							<GateNotice level={2} gate={data.runs.gate} title="the runs" absent="This flow no longer exists. Reload the page." />
						{:else if data.runs.value.rows.length === 0}
							<p class="text-sm text-muted">No runs yet.</p>
						{:else}
							<Table hoverable label="Runs">
								<thead>
									<tr>
										<th scope="col">Status</th>
										<th scope="col">Trigger</th>
										<th scope="col">Kind</th>
										<th scope="col">Duration</th>
										<th scope="col">Started</th>
										<th scope="col">Actions</th>
									</tr>
								</thead>
								<tbody>
									{#each data.runs.value.rows as run (run.id)}
										<tr>
											<td><Badge tone={statusTone(run.status)} dot>{run.status}</Badge></td>
											<td data-cell="nowrap" class="text-muted">{triggerLabel(run.trigger_type)}</td>
											<td data-cell="nowrap" class="text-muted">{run.is_test ? 'test' : 'live'}</td>
											<td data-cell="nowrap" class="tabular-nums text-muted">{formatDuration(run.duration_ms)}</td>
											<td data-cell="nowrap" class="text-muted" title={formatDateTime(run.started_at)}>{formatDateTime(run.started_at)}</td>
											<td>
												<form method="POST" action="?/run" use:enhance={openRun}>
													<input type="hidden" name="run_id" value={run.id} />
													<Button variant="ghost" size="sm" type="submit" aria-label="Open run {run.id}" title="Open">
														<Play size={ICON.sm} />
													</Button>
												</form>
											</td>
										</tr>
									{/each}
								</tbody>
							</Table>
							<Pagination
								page={pageNumber(data.runs.value.offset, data.runs.value.limit)}
								perPage={data.runs.value.limit}
								count={data.runs.value.rows.length}
								total={data.runs.value.total ?? undefined}
								hasNext={data.runs.value.hasMore}
								noun="runs"
								href={runsHref}
							/>
						{/if}
					</div>
				{:else if tab === 'assistant' && assistantOn}
					<AssistantPanel
						status={assistant.status}
						message={assistant.message}
						busy={assistant.busy}
						{definitionJSON}
						conversationId={assistant.conversationId}
						bind:prompt={assistant.prompt}
						draft={assistant.draft}
						answer={assistant.answer}
						onsubmit={assistant.submit}
						onaccept={() => void acceptDraft()}
						ondiscard={() => assistant.discard()}
						onclose={() => (assistant.answer = null)}
						onreset={() => assistant.reset()}
						onproblem={focusDraftProblem}
					/>
				{:else}
					<div class="h-full overflow-y-auto">
						<FlowGuide templates={data.templates} />
					</div>
				{/if}
			</EditorDrawer>
		</div>
	</PageShell>

	<FlowExportModal bind:this={exportPanel} name={definition.name} slug={definition.slug} load={(format) => exportFlow(fetch, flowId, format, csrfHeaders())} />

	<FlowTemplateGallery
		bind:open={showGallery}
		templates={data.templates}
		flowDocument={JSON.stringify({ ...definition, name: data.flow.name, slug: data.flow.slug })}
		canUpdate={can.update}
		canDelete={can.delete}
		onuse={(t) => void startFromTemplate(t)}
	/>

	<FlowImportDrawer bind:open={showImport} slug={data.flow.slug} failure={importFailure} {enableLink} />

	<form
		method="POST"
		action={actionWithQuery('delete', queryWithout(page.url))}
		use:enhance={deleteFlow.enhance}
		bind:this={deleteFlowForm}
		class="hidden"
	></form>
{:else}
	<PageShell title="Flows" documentTitle={`${data.flow?.name ?? 'Flow'} - Flows`} width="wide">
		<NotEnabled
			level={2}
			title="Flows"
			description="Flows are not enabled on this instance."
		/>
	</PageShell>
{/if}
