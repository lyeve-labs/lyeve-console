<script lang="ts">
	import {
		Alert,
		Badge,
		Button,
		Card,
		CheckboxGroup,
		EmptyState,
		Input,
		MultiSelect,
		NumberInput,
		PageShell,
		Panel,
		SectionHeading,
		SegmentedControl,
		Select,
		Textarea,
		confirm as confirmDialog,
	} from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import { CONFIRM_FIELD, CONFIRMED } from '$lib/confirmation';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { ArrowDown, ArrowUp, Eye, LayoutDashboard, Plus, RotateCcw, Trash2 } from '@lucide/svelte';
	import { ICON } from '$lib/icon';
	import DashboardWidgets from '$lib/components/custom/DashboardWidgets.svelte';
	import { ROLE_CHOICES } from '$lib/api/customization';
	import {
		MAX_WIDGETS,
		MAX_WIDGET_ROWS,
		WIDGET_KINDS,
		WIDTH_LABEL,
		editableWidget,
		newWidget,
		starterLayout,
		widgetKind,
		widgetServed,
		wireWidget,
		type Widget,
		type WidgetType,
		type WidgetWidth,
		type WidgetWindow,
	} from '$lib/api/custom-dashboard';
	import { formatDateTime, plural } from '$lib/format';
	import { inSentence } from '$lib/api/gate';
	import type { ResolvedWidget } from '$lib/api/custom-dashboard';
	import type { PageData, ActionData } from './$types';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import NotEnabled from '$lib/components/NotEnabled.svelte';
	import CustomizationTabs from '$lib/components/CustomizationTabs.svelte';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	/*
	 * The layout is edited as one document and sent whole, the way a custom
	 * page is: a reorder and an edit land together, and the engine validates
	 * the layout it will store rather than a half of it.
	 */
	// Seeded from the load so the server renders the layout, and copied again
	// only when the stored layout changes, after a save or a reset. Saving the
	// page above the dashboard reruns the load too, and must not wipe widgets
	// being edited.
	const layoutKey = () => JSON.stringify([data.layout.custom, data.layout.updated_at, data.layout.widgets]);
	// svelte-ignore state_referenced_locally
	let widgets = $state<Widget[]>(data.layout.widgets.map(editableWidget));
	// svelte-ignore state_referenced_locally
	let homePage = $state(data.homePage);
	const homeKey = () => data.homePage;
	const seeded = { layout: layoutKey(), home: homeKey() };
	$effect.pre(() => {
		const key = layoutKey();
		if (key === seeded.layout) return;
		seeded.layout = key;
		widgets = data.layout.widgets.map(editableWidget);
	});
	$effect.pre(() => {
		const key = homeKey();
		if (key === seeded.home) return;
		seeded.home = key;
		homePage = data.homePage;
	});
	const homeOptions = $derived([
		{ value: '', label: 'None' },
		...data.pages.map((p) => ({ value: p.slug, label: p.title })),
	]);
	const keep: SubmitFunction = () => async ({ update }) => update({ reset: false });
	let saving = $state(false);
	let previewing = $state(false);
	let previewAs = $state('admin');

	const kinds = $derived(WIDGET_KINDS.filter((k) => widgetServed(k, data.plugins)));
	const roleOptions = ROLE_CHOICES.map((r) => ({ value: r, label: r }));
	const schemaOptions = $derived(data.schemas.map((s) => ({ value: s, label: s })));

	/**
	 * The schema options with the ones a widget already names added, so a
	 * widget keeps its schemas on screen when the list could not be read.
	 */
	function withOwn(own: readonly (string | undefined)[]) {
		const names = new Set(data.schemas);
		const extra = own.filter((s): s is string => !!s && !names.has(s));
		return [...schemaOptions, ...extra.map((s) => ({ value: s, label: s }))];
	}
	function anySchema(own: string | undefined) {
		return [{ value: '', label: 'Every content type' }, ...withOwn([own])];
	}
	const widthOptions = (['third', 'half', 'full'] as WidgetWidth[]).map((w) => ({ value: w, label: WIDTH_LABEL[w] }));
	const windowOptions = (['6h', '24h', '7d'] as WidgetWindow[]).map((w) => ({ value: w, label: w }));
	const statusOptions = [
		{ value: '', label: 'Any status' },
		{ value: 'published', label: 'Published' },
		{ value: 'draft', label: 'Draft' },
		{ value: 'archived', label: 'Archived' },
	];
	const toneOptions = [
		{ value: '', label: 'Plain' },
		{ value: 'brand', label: 'Brand' },
		{ value: 'neutral', label: 'Neutral' },
		{ value: 'success', label: 'Success' },
		{ value: 'warn', label: 'Warning' },
		{ value: 'danger', label: 'Danger' },
	];
	const previewRoles = ROLE_CHOICES.map((r) => ({ value: r, label: r }));

	const full = $derived(widgets.length >= MAX_WIDGETS);
	const wire = $derived(JSON.stringify(widgets.map(wireWidget)));
	const preview = $derived((form as { preview?: ResolvedWidget[] } | null)?.preview ?? null);

	function add(type: WidgetType) {
		if (full) return;
		widgets = [...widgets, newWidget(type, widgets.map((w) => w.id), data.schemas)];
	}
	function startFromStock() {
		widgets = starterLayout(data.schemas, data.plugins);
	}
	function move(i: number, by: number) {
		const j = i + by;
		if (j < 0 || j >= widgets.length) return;
		const next = [...widgets];
		[next[i], next[j]] = [next[j], next[i]];
		widgets = next;
	}
	function remove(i: number) {
		widgets = widgets.filter((_, k) => k !== i);
	}

	const save: SubmitFunction = () => {
		saving = true;
		return async ({ update }) => {
			saving = false;
			await update({ reset: false, invalidateAll: true });
		};
	};
	const runPreview: SubmitFunction = () => {
		previewing = true;
		return async ({ update }) => {
			previewing = false;
			await update({ reset: false, invalidateAll: false });
		};
	};
	const confirmReset: SubmitFunction = async ({ cancel, formData }) => {
		const ok = await confirmDialog(
			'Reset the dashboard?',
			'Everyone in this tenant sees the stock dashboard again, and this layout is deleted.',
			{ confirmLabel: 'Reset' },
		);
		if (!ok) {
			cancel();
			return;
		}
		formData.set(CONFIRM_FIELD, CONFIRMED);
		return async ({ update }) => update({ reset: false, invalidateAll: true });
	};
</script>

<PageShell
	title="Customization"
	documentTitle="Dashboard - Customization"
	description="Build this tenant's dashboard from widgets and choose which roles see each one."
	width="wide"
>
	{#snippet actions()}
		<Badge tone="violet" size="sm">Beta</Badge>
		<Button variant="secondary" size="sm" href="/admin">
			<LayoutDashboard size={ICON.sm} /> View dashboard
		</Button>
	{/snippet}

	{#if form?.error}
		<Alert tone="danger">{form.error}</Alert>
	{:else if form && 'saved' in form}
		<Alert tone="success" autoDismiss>Dashboard saved. Everyone in this tenant now sees the widgets their role allows.</Alert>
	{:else if form && 'reset' in form}
		<Alert tone="success" autoDismiss>Dashboard reset. Everyone sees the stock dashboard again.</Alert>
	{/if}

	<CustomizationTabs active="dashboard" />

	{#if data.gate.state !== 'ok'}
		<GateNotice
			level={2}
			gate={data.gate}
			title="Customization"
			absent="Customization is not included in this build."
		/>
	{:else if !data.entitled}
		<NotEnabled
			level={2}
			title="Customization"
			description="Set this tenant's name, logo, colors and menu."
		/>
	{:else}
		<p class="text-sm text-muted" data-testid="layout-state">
			{#if data.layout.custom}
				This tenant uses its own dashboard of {data.layout.widgets.length}
				{plural(data.layout.widgets.length, 'widget')}{#if data.layout.updated_at}, saved {formatDateTime(data.layout.updated_at)}{/if}.
			{:else}
				This tenant uses the stock dashboard. Saving a layout replaces it, and a reset brings it back.
			{/if}
		</p>

		<div class="flex flex-col gap-4">
			{#if form?.pagesError}
				<Alert tone="danger">{form.pagesError}</Alert>
			{:else if form && 'homeSaved' in form}
				<Alert tone="success" autoDismiss>Dashboard page saved.</Alert>
			{/if}
			{#if data.pages.length === 0}
				<p class="text-sm text-muted">You can show one of this tenant's pages above the dashboard. Create one under Pages first.</p>
			{:else}
				<form method="POST" action="?/home" class="flex flex-col gap-4" use:enhance={keep}>
					<input type="hidden" name="home_page" value={homePage} />
					<Select
						id="home-page"
						label="Page above the dashboard"
						searchable
						hint="Shown at the top of the dashboard, above its panels or widgets."
						options={homeOptions}
						value={homePage}
						onvaluechange={(v) => (homePage = v)}
					/>
					<div><Button variant="secondary" type="submit">Save</Button></div>
				</form>
			{/if}
		</div>

		{#if data.schemasGate.state !== 'ok'}
			<GateNotice
				level={2}
				gate={data.schemasGate}
				title="The content type list"
				absent="The content type list is not included in this build, so you cannot choose a content type below."
			/>
		{/if}

		<section class="flex flex-col gap-4">
			<SectionHeading level={2}>Widgets</SectionHeading>
			{#if widgets.length === 0}
				<EmptyState
					title="No widgets yet"
					description="Start from a layout close to the stock dashboard and change it, or add widgets one at a time from the list below."
				>
					{#snippet action()}
						<Button variant="secondary" onclick={startFromStock}>
							<Plus size={ICON.sm} /> Start from the stock layout
						</Button>
					{/snippet}
				</EmptyState>
			{:else}
				{#each widgets as w, i (w.id)}
					{@const kind = widgetKind(w.type)}
					<Card pad="md">
						{#snippet header()}
							<div class="flex items-center justify-between gap-2">
								<SectionHeading level={3}>{i + 1}. {kind.label}</SectionHeading>
								<div class="flex items-center gap-1">
									<Button variant="ghost" size="sm" type="button" aria-label="Move widget {i + 1} up" disabled={i === 0} onclick={() => move(i, -1)}>
										<ArrowUp size={ICON.sm} />
									</Button>
									<Button variant="ghost" size="sm" type="button" aria-label="Move widget {i + 1} down" disabled={i === widgets.length - 1} onclick={() => move(i, 1)}>
										<ArrowDown size={ICON.sm} />
									</Button>
									<Button variant="ghost" size="sm" type="button" aria-label="Remove widget {i + 1}" onclick={() => remove(i)}>
										<Trash2 size={ICON.sm} class="text-danger" />
									</Button>
								</div>
							</div>
						{/snippet}
						<div class="flex flex-col gap-4">
							<p class="text-sm text-muted">
								{kind.description}
								{#if kind.adminData}
									Only an admin or a super admin can see its data. An editor or a viewer sees "Could not load" in its place.
								{/if}
							</p>
							<div class="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
								<Input id="widget-{w.id}-title" label="Heading" placeholder={kind.fallbackTitle || 'None'} bind:value={w.title} />
								<SegmentedControl label="Width" options={widthOptions} value={w.width ?? 'half'} onchange={(v) => (w.width = v)} />
								<CheckboxGroup label="Seen by" hint="Leave empty for everyone." orientation="horizontal" options={roleOptions} bind:value={w.roles} />
							</div>

							{#if w.type === 'entry_counts'}
								{#if data.schemasGate.state === 'ok' && schemaOptions.length === 0}
									<p class="text-sm text-muted">No content types to count yet.</p>
								{:else}
									<MultiSelect
										id="widget-{w.id}-schemas"
										label="Content types"
										placeholder="Choose content types"
										hint="Up to 12, in the order picked."
										searchable
										options={withOwn(w.schemas ?? [])}
										bind:value={w.schemas}
									/>
								{/if}
							{:else if w.type === 'latest_entries'}
								<div class="grid grid-cols-1 items-start gap-4 sm:grid-cols-3">
									<Select id="widget-{w.id}-schema" label="Content type" searchable options={anySchema(w.schema)} bind:value={w.schema} />
									<SegmentedControl label="Status" options={statusOptions} value={w.status ?? ''} onchange={(v) => (w.status = v as Widget['status'])} />
									<NumberInput id="widget-{w.id}-limit" label="Entries" min={1} max={MAX_WIDGET_ROWS} bind:value={w.limit} />
								</div>
							{:else if w.type === 'status_breakdown'}
								<div class="grid grid-cols-1 items-start gap-4 sm:grid-cols-3">
									<Select id="widget-{w.id}-schema" label="Content type" searchable options={anySchema(w.schema)} bind:value={w.schema} />
								</div>
							{:else if w.type === 'recent_activity'}
								<div class="grid grid-cols-1 items-start gap-4 sm:grid-cols-3">
									<NumberInput id="widget-{w.id}-limit" label="Entries" min={1} max={MAX_WIDGET_ROWS} bind:value={w.limit} />
								</div>
							{:else if w.type === 'api_usage'}
								<SegmentedControl label="Window" options={windowOptions} value={w.window ?? '24h'} onchange={(v) => (w.window = v)} />
							{:else if w.type === 'text'}
								<div class="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
									<div class="lg:col-span-2">
										<Textarea id="widget-{w.id}-body" label="Text" rows={5} mono hint="Markdown: headings, lists, links, bold, italic and code." bind:value={w.body} />
									</div>
									<Select id="widget-{w.id}-tone" label="Style" options={toneOptions} bind:value={w.tone} />
								</div>
							{:else if w.type === 'links'}
								<div class="flex flex-col gap-3">
									{#each w.links ?? [] as link, j (j)}
										<div class="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_2fr_auto]">
											<Input id="widget-{w.id}-link-{j}-label" label="Label" bind:value={link.label} />
											<Input id="widget-{w.id}-link-{j}-url" label="Address" mono bind:value={link.url} />
											<div class="flex h-control items-center">
												<Button variant="ghost" size="sm" type="button" aria-label="Remove link {j + 1}" onclick={() => (w.links = (w.links ?? []).filter((_, k) => k !== j))}>
													<Trash2 size={ICON.sm} class="text-danger" />
												</Button>
											</div>
										</div>
									{/each}
									<p class="text-xs text-faint">Use an https URL or an admin path starting /admin/.</p>
									<div>
										<Button variant="secondary" size="sm" type="button" onclick={() => (w.links = [...(w.links ?? []), { label: '', url: 'https://' }])}>
											<Plus size={ICON.sm} /> Add link
										</Button>
									</div>
								</div>
							{/if}
						</div>
					</Card>
				{/each}
			{/if}
		</section>

		<section class="flex flex-col gap-3">
			<SectionHeading level={2}>Add a widget</SectionHeading>
			{#if full}
				<p class="text-sm text-muted">A dashboard can have at most {MAX_WIDGETS} widgets. Remove one to add another.</p>
			{:else}
				<ul class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
					{#each kinds as k (k.type)}
						<li>
							<!-- A Panel and not a Card: this offers a kind of widget, where a
							     Card repeated in a list is a row of records with icon-only
							     actions. Its body grows with the row, so every Add button sits
							     on the bottom edge however long the description above it is. -->
							<Panel pad="sm" class="h-full *:h-full">
								<div class="flex h-full flex-col justify-between gap-3">
									<div class="flex flex-col gap-1">
										<span class="text-sm font-medium text-fg">{k.label}</span>
										<span class="text-xs text-muted">{k.description}</span>
									</div>
									<div>
										<Button variant="secondary" size="sm" type="button" onclick={() => add(k.type)}>
											<Plus size={ICON.sm} /> Add {inSentence(k.label)}
										</Button>
									</div>
								</div>
							</Panel>
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<div class="flex flex-wrap items-center gap-2">
			<form method="POST" action="?/save" use:enhance={save}>
				<input type="hidden" name="widgets" value={wire} />
				<Button variant="primary" type="submit" loading={saving} disabled={widgets.length === 0}>Save</Button>
			</form>
			{#if data.layout.custom}
				<form method="POST" action="?/reset" use:enhance={confirmReset}>
					<Button variant="secondary" type="submit"><RotateCcw size={ICON.sm} /> Reset to the stock dashboard</Button>
				</form>
			{/if}
		</div>

		<section class="flex flex-col gap-4">
			<div class="flex flex-wrap items-end justify-between gap-3">
				<div class="flex flex-col gap-1">
					<SectionHeading level={2}>Preview</SectionHeading>
					<p class="text-sm text-muted">See the unsaved layout above as one role would. The numbers use your own access.</p>
				</div>
				<form method="POST" action="?/preview" class="flex items-end gap-2" use:enhance={runPreview}>
					<input type="hidden" name="widgets" value={wire} />
					<input type="hidden" name="as" value={previewAs} />
					<SegmentedControl label="Preview as" labelHidden size="sm" options={previewRoles} bind:value={previewAs} />
					<Button variant="secondary" size="sm" type="submit" loading={previewing} disabled={widgets.length === 0}>
						<Eye size={ICON.sm} /> Preview
					</Button>
				</form>
			</div>
			{#if preview}
				<div class="rounded-xl border border-dashed border-line-strong p-4" data-testid="dashboard-preview">
					{#if preview.length === 0}
						<p class="text-sm text-muted">A {(form as { previewAs?: string }).previewAs} sees no widget on this layout.</p>
					{:else}
						<DashboardWidgets widgets={preview} />
					{/if}
				</div>
			{:else}
				<p class="text-sm text-faint">Nothing previewed yet.</p>
			{/if}
		</section>
	{/if}
</PageShell>
