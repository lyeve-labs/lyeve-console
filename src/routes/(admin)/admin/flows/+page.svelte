<script lang="ts">
	import {
		Alert,
		Badge,
		Button,
		Drawer,
		EmptyState,
		FileInput,
		Input,
		PageShell,
		FilterChips,
		Pagination,
		RadioGroup,
		SearchInput,
		Table,
		Textarea,
		Tooltip,
	} from '@lyeve-labs/ui-kit';
	import { Database, Plus, Trash2, Upload, Variable, Workflow } from '@lucide/svelte';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { ActionData, PageData } from './$types';
	import ListToolbar from '$lib/components/ListToolbar.svelte';
	import NotEnabled from '$lib/components/NotEnabled.svelte';
	import FormErrors from '$lib/components/FormErrors.svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import { confirmed, submitter } from '$lib/forms.svelte';
	import { liveFilter } from '$lib/live-filter.svelte';
	import { slugify, statusTone, triggerLabel } from '$lib/flow/triggers';
	import { blockedText } from '$lib/flow/blocked';
	import { flowGrants } from '$lib/flow/permissions';
	import type { RefusalNotice } from '$lib/flow/types';
	import { useInstance } from '$lib/instance.svelte';
	import InlineUpgradeLink from '$lib/components/InlineUpgradeLink.svelte';
	import type { Flow, ValidationError } from '$lib/api/flows';
	import { listQuery } from '$lib/back';
	import { pageHref, pageNumber } from '$lib/api/list';
	import { relativeTime, formatDateTime } from '$lib/format';
	import { ICON } from '$lib/icon';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const submit1 = submitter(() => (showCreate = false));
	const submit2 = submitter(() => (showImport = false));

	// The shell shows why the page is unavailable while the flow plugin does
	// not run. A plugin that runs and refuses its routes is said here.
	const enabled = $derived(!data.locked);

	// A control the caller's roles cannot use is not drawn: the plugin says
	// beside the list whether the caller may create, and on each flow what
	// it may do to it. The engine still decides, and a refusal it answers
	// renders below like any other.
	const canCreate = $derived(data.gate.state === 'ok' && data.canCreate !== false);
	// The datasources and the variables are admin routes, so a reader below
	// admin is not sent to a page that can only refuse them.
	const isAdmin = $derived(data.user.roles.includes('admin') || data.user.roles.includes('super_admin'));
	const canDelete = (flow: Flow) => flowGrants(flow.actions).delete;

	// The dialog asks for a name and derives the slug, and nothing else. A
	// template is a question for a reader who has a canvas to put it on, so
	// the editor asks it, from its empty state, beside the palette and the
	// import.
	let showCreate = $state(false);
	let createName = $state('');
	let createSlug = $state('');
	let slugTouched = $state(false);

	function openCreate() {
		cleared = form;
		slugTouched = false;
		createName = '';
		createSlug = '';
		showCreate = true;
	}

	function onNameInput(e: Event) {
		createName = (e.currentTarget as HTMLInputElement).value;
		if (!slugTouched) createSlug = slugify(createName);
	}

	let showImport = $state(false);
	let importMode = $state('create');

	function openImport() {
		cleared = form;
		showImport = true;
	}

	function deleteFlow(name: string): SubmitFunction {
		return confirmed(`Delete flow ${name}?`, 'Its versions and run history go with it.', {
			confirmLabel: 'Delete',
			success: `Flow ${name} deleted.`,
		});
	}

	/*
	 * The create drawer, the import drawer and a row's delete share one `form`
	 * result. Each failure names the form that caused it, and each drawer
	 * shows only its own, so a failed delete never reads as a failed create in
	 * the next drawer opened. Opening a drawer clears what an earlier attempt
	 * left.
	 */
	interface Failure {
		action: string;
		error: string;
		refusal: RefusalNotice | null;
		forbidden: boolean;
		errors: ValidationError[];
		/** The form field the failure concerns, when it concerns one. */
		field: string;
	}
	let cleared = $state<unknown>(null);
	const failure = $derived.by((): Failure | null => {
		const f = form as Record<string, unknown> | null;
		if (!f || f === cleared || typeof f.error !== 'string' || !f.error) return null;
		return {
			action: String(f.action ?? ''),
			error: f.error,
			refusal: f.refusal ? (f.refusal as RefusalNotice) : null,
			forbidden: f.forbidden === true,
			errors: Array.isArray(f.errors) ? (f.errors as ValidationError[]) : [],
			field: typeof f.field === 'string' ? f.field : '',
		};
	});
	const createFailure = $derived(failure?.action === 'create' ? failure : null);
	const importFailure = $derived(failure?.action === 'import' ? failure : null);
	const pageFailure = $derived(failure && failure.action !== 'create' && failure.action !== 'import' ? failure : null);
	const errorList = $derived(pageFailure?.errors ?? []);
	const imported = $derived(form && 'imported' in form ? form.imported : null);
	const refusal = $derived(pageFailure?.refusal ?? null);
	const instance = useInstance();
	// A ceiling refusal can name where a license allowing more is bought,
	// and that link goes first when it is safe to follow.
	const enableLink = $derived(instance.upgradeLink(refusal?.upgradeUrl || null));

	const MODES = [
		{ value: 'create', label: 'Create a new flow', description: 'Creates a new flow with the slug the definition gives.' },
		{
			value: 'replace',
			label: 'Replace the draft of an existing flow',
			description: 'The definition overwrites that flow\'s draft. Its published version runs until you publish again.',
		},
	];

	// The filter lives in the URL, so a filtered view is a link someone can
	// keep and the list renders filtered without hydration. Each status is a
	// link carrying the search, as the content index's chips are, so one click
	// lands on it. A radio that submits from its change handler runs before the
	// hidden status field re-renders and posts the status it is leaving. The
	// search runs once typing pauses, so a half-typed word does not reload.
	const STATUSES = [
		{ value: '', label: 'All' },
		{ value: 'draft', label: 'Draft' },
		{ value: 'active', label: 'Active' },
		{ value: 'disabled', label: 'Disabled' },
		{ value: 'blocked', label: 'Blocked' },
	];
	const statusOptions = $derived(
		STATUSES.map((o) => ({ ...o, href: `/admin/flows${listQuery({ status: o.value, q: data.q })}` })),
	);
	// Re-read when a navigation changes the URL, so the back button puts the
	// box where the list is.
	const live = liveFilter(() => data.q);
	const filtered = $derived(data.status !== '' || data.q !== '');
	// A row link carries the filter it was found under, so the editor's back
	// link returns to the same slice of the list.
	const rowQuery = $derived(listQuery({ status: data.status, q: data.q }));
</script>

{#if enabled}
	<PageShell
		title="Flows"
		description="Build custom API endpoints and automations on a canvas."
		width="wide"
	>
		{#snippet actions()}
			<Badge tone="violet" size="sm">Beta</Badge>
			{#if isAdmin}
				<Button variant="ghost" size="sm" href="/admin/flows/datasources">
					<Database size={ICON.sm} />
					Datasources
				</Button>
				<Button variant="ghost" size="sm" href="/admin/flows/variables">
					<Variable size={ICON.sm} />
					Variables
				</Button>
			{/if}
			{#if canCreate}
				<Button variant="secondary" size="sm" onclick={openImport}>
					<Upload size={ICON.sm} />
					Import
				</Button>
				<Button variant="primary" size="sm" onclick={() => openCreate()}>
					<Plus size={ICON.sm} />
					New flow
				</Button>
			{/if}
		{/snippet}

		{#if data.gate.state !== 'ok'}
			<GateNotice level={2} gate={data.gate} title="flows" absent="Flows are not included in this build." />
		{/if}

		{#if refusal}
			<Alert tone="warn" title={refusal.limit !== null ? 'Flow limit reached' : 'Not enabled on this engine'}>
				{#snippet children()}
					{pageFailure?.error ?? ''}
					{#if enableLink}
						<InlineUpgradeLink link={enableLink} raises={refusal.limit !== null} />
					{/if}
					{#if errorList.length > 0}
						<ul class="mt-1 list-disc pl-5">
							{#each errorList as err (`${err.node_id ?? ''}${err.path}${err.message}`)}
								<li class="font-mono text-xs">{err.node_id ? `${err.node_id} ` : ''}{err.path}: {err.message}</li>
							{/each}
						</ul>
					{/if}
				{/snippet}
			</Alert>
		{:else if pageFailure?.forbidden}
			<Alert tone="danger" title="Your role cannot do that">
				{#snippet children()}{pageFailure.error}{/snippet}
			</Alert>
		{:else if pageFailure}
			<Alert tone="danger">
				{#snippet children()}
					{pageFailure.error}
					{#if errorList.length > 0}
						<ul class="mt-1 list-disc pl-5">
							{#each errorList as err (`${err.node_id ?? ''}${err.path}${err.message}`)}
								<li class="font-mono text-xs">{err.node_id ? `${err.node_id} ` : ''}{err.path}: {err.message}</li>
							{/each}
						</ul>
					{/if}
				{/snippet}
			</Alert>
		{/if}

		{#if imported}
			<Alert tone="warn" title="Imported with unresolved datasources">
				{#snippet children()}
					<span>{imported.name} was imported. These datasources do not exist here yet: {imported.unresolved.join(', ')}.</span>
					<a class="ml-1 underline" href="/admin/flows/{imported.id}">Open the flow</a>
				{/snippet}
			</Alert>
		{/if}

		<!-- A role the plugin refuses has nothing to filter. -->
		{#if data.gate.state !== 'forbidden'}
			<!-- The field's label is for the screen reader only, so nothing sits
			     above the row to push its middle down. -->
			<form method="GET" data-testid="flow-filters" {@attach live.form}>
				{#if data.status}<input type="hidden" name="status" value={data.status} />{/if}
				<ListToolbar label="Filter flows">
					{#snippet search()}
						<div class="flex items-center gap-2">
							<label for="flow-search" class="sr-only">Search flows</label>
							<SearchInput
								id="flow-search"
								name="q"
								bind:value={live.value}
								oninput={live.input}
								placeholder="Name or slug"
								class="min-w-0 flex-1"
							/>
						</div>
					{/snippet}
					{#snippet filters()}
						<!-- Five statuses do not fit one strip, so they are chips that wrap. -->
						<FilterChips label="Status" value={data.status} options={statusOptions} />
					{/snippet}
				</ListToolbar>
			</form>
		{/if}

		{#if data.gate.state === 'ok'}
			<!-- The kit draws an empty state's title at level 3, so the list
			     carries the level 2 heading a screen reader steps through. -->
			<h2 class="sr-only">All flows</h2>
		{/if}
		{#if data.gate.state !== 'ok'}
			<!-- Nothing: the empty state would say there are none. -->
		{:else if data.flows.length === 0 && filtered}
			<EmptyState title="No flows match these filters" description="Clear the search or choose another status.">
				{#snippet action()}
					<Button variant="secondary" href="/admin/flows">Clear filters</Button>
				{/snippet}
			</EmptyState>
		{:else if data.flows.length === 0}
			<EmptyState
				title="No flows yet"
				description="Create a flow to open the editor. Start from the palette, a template or an import."
			>
				{#snippet iconSnippet()}<Workflow size={ICON.lg} />{/snippet}
				{#snippet action()}
					{#if canCreate}
						<Button variant="secondary" onclick={() => openCreate()}>
							<Plus size={ICON.sm} />
							New flow
						</Button>
					{/if}
				{/snippet}
			</EmptyState>
		{:else}
			<Table hoverable label="Flows">
				<thead>
					<tr>
						<th scope="col">Name</th>
						<th scope="col">Slug</th>
						<th scope="col">Status</th>
						<th scope="col">Trigger</th>
						<th scope="col">Version</th>
						<th scope="col">Last run</th>
						<th scope="col">Actions</th>
					</tr>
				</thead>
				<tbody>
					{#each data.flows as flow (flow.id)}
						<tr>
							<td data-cell="nowrap" class="font-medium">
								<a class="relative hit-area text-fg hover:text-brand" href="/admin/flows/{flow.id}{rowQuery}">{flow.name}</a>
							</td>
							<td data-cell="nowrap" class="font-mono text-xs text-muted">{flow.slug}</td>
							<td>
								{#if flow.status === 'blocked'}
									<!-- The list has no validation to name the plugin. The editor does. -->
									<Tooltip text={blockedText()} position="bottom">
										<Badge tone={statusTone(flow.status)} dot>{flow.status}</Badge>
									</Tooltip>
								{:else}
									<Badge tone={statusTone(flow.status)} dot>{flow.status}</Badge>
								{/if}
							</td>
							<td data-cell="nowrap" class="text-muted">{triggerLabel(flow.trigger_type)}</td>
							<td data-cell="nowrap" class="tabular-nums text-muted">{flow.version > 0 ? `v${flow.version}` : 'unpublished'}</td>
							<td data-cell="nowrap">
								{#if flow.last_run}
									<span class="flex items-center gap-2">
										<Badge tone={statusTone(flow.last_run.status)} size="sm">{flow.last_run.status}</Badge>
										<span class="text-xs text-muted" title={formatDateTime(flow.last_run.started_at)}>{relativeTime(flow.last_run.started_at)}</span>
									</span>
								{:else}
									<span class="text-xs text-faint">never</span>
								{/if}
							</td>
							<td>
								{#if canDelete(flow)}
									<form method="POST" action="?/delete" use:enhance={deleteFlow(flow.name)}>
										<input type="hidden" name="id" value={flow.id} />
										<Button variant="ghost" size="sm" type="submit" title="Delete" aria-label="Delete {flow.name}">
											<Trash2 size={ICON.sm} class="text-danger" />
										</Button>
									</form>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</Table>

			<Pagination
				page={pageNumber(data.offset, data.limit)}
				perPage={data.limit}
				count={data.flows.length}
				total={data.total ?? undefined}
				hasNext={data.hasMore}
				noun="flows"
				href={pageHref('/admin/flows', data.limit, {
					...(data.status ? { status: data.status } : {}),
					...(data.q ? { q: data.q } : {}),
				})}
			/>
		{/if}
	</PageShell>

	<!-- A drawer's own failure, first in its form: the sentence, where the
	     feature is turned on when the plugin refused it, and each problem the
	     plugin found in the definition. -->
	{#snippet drawerFailure(f: Failure | null)}
		<FormErrors message={f?.error} />
		{#if f?.refusal}
			{@const link = instance.upgradeLink(f.refusal.upgradeUrl || null)}
			{#if link}
				<InlineUpgradeLink {link} raises={f.refusal.limit !== null} standalone />
			{/if}
		{/if}
		{#if f && f.errors.length > 0}
			<ul class="list-disc pl-5" aria-label="Problems in the definition">
				{#each f.errors as err (`${err.node_id ?? ''}${err.path}${err.message}`)}
					<li class="font-mono text-xs text-danger">{err.node_id ? `${err.node_id} ` : ''}{err.path}: {err.message}</li>
				{/each}
			</ul>
		{/if}
	{/snippet}

	<!-- The drawer asks for a name and derives the slug, and nothing else. A
	     template is a question for a reader who has a canvas to put it on, so
	     the editor asks it, from its empty state, beside the palette and the
	     import. -->
	<Drawer bind:open={showCreate} title="New flow">
		<form method="POST" action="?/create" id="flow-create-form" use:enhance={submit1.enhance} class="flex flex-col gap-4">
			{@render drawerFailure(createFailure)}
			<Input
				id="create-name"
				name="name"
				label="Name"
				value={createName}
				oninput={onNameInput}
				placeholder="Orders with shipments"
				required
			/>
			<Input
				id="create-slug"
				name="slug"
				label="Slug"
				hint="Used in the flow URL. Use lower case letters, digits and underscores."
				error={createFailure?.field === 'slug' ? createFailure.error : undefined}
				bind:value={createSlug}
				oninput={() => (slugTouched = true)}
				required
			/>
		</form>
		{#snippet footer()}
			<Button variant="secondary" onclick={() => (showCreate = false)}>Cancel</Button>
			<Button variant="primary" type="submit" form="flow-create-form" loading={submit1.pending}>Create</Button>
		{/snippet}
	</Drawer>

	<Drawer bind:open={showImport} title="Import a flow">
		<form
			method="POST"
			action="?/import"
			id="flow-import-form"
			enctype="multipart/form-data"
			use:enhance={submit2.enhance}
			class="flex flex-col gap-4"
		>
			{@render drawerFailure(importFailure)}
			<FileInput
				id="import-file"
				name="file"
				label="Definition file"
				accept=".json,.yaml,.yml,application/json,application/yaml"
				hint="JSON or YAML, as exported from a flow."
			/>
			<Textarea
				id="import-text"
				name="text"
				label="Or paste the definition"
				rows={8}
				placeholder={'version: 1\nname: Orders with shipments'}
				mono
			/>
			<RadioGroup name="mode" label="Mode" options={MODES} bind:value={importMode} />
			{#if importMode === 'replace'}
				<Input id="import-slug" name="slug" label="Slug of the flow to replace" required />
			{/if}
		</form>
		{#snippet footer()}
			<Button variant="secondary" onclick={() => (showImport = false)}>Cancel</Button>
			<Button variant="primary" type="submit" form="flow-import-form" loading={submit2.pending}>Import</Button>
		{/snippet}
	</Drawer>
{:else}
	<PageShell title="Flows" width="wide">
		<NotEnabled
			level={2}
			title="Flows"
			description="Flows are not enabled on this engine."
		/>
	</PageShell>
{/if}
