<script lang="ts">
	import {
		Alert,
		Badge,
		Button,
		Drawer,
		EmptyState,
		Input,
		PageShell,
		Pagination,
		Progress,
		SearchInput,
		SectionHeading,
		Select,
		Spinner,
		Stat,
		Table,
		Toggle,
	} from '@lyeve-labs/ui-kit';
	import RefreshButton from '$lib/components/RefreshButton.svelte';
	import { enhance } from '$app/forms';
	import { invalidate } from '$app/navigation';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { CalendarClock, Download, Pause, Play, Plus, Search, Trash2, X } from '@lucide/svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import FormErrors from '$lib/components/FormErrors.svelte';
	import ListToolbar from '$lib/components/ListToolbar.svelte';
	import ExportConfigFields from '$lib/components/ExportConfigFields.svelte';
	import {
		CRON_PRESETS,
		EXPORT_ROW_CEILING,
		FORMAT_LABELS,
		JOBS_URL,
		active,
		cronLabel,
		downloadable,
		jobProgress,
		scheduleState,
		stageText,
		type ExportSchedule,
	} from '$lib/api/data-export';
	import { jobTone } from '$lib/tones';
	import { NO_VALUE, formatBytes, formatCount, formatDateTime } from '$lib/format';
	import { confirmed, submitter } from '$lib/forms.svelte';
	import type { ActionData, PageData } from './$types';
	import { pageHref, pageNumber } from '$lib/api/list';
	import { ICON } from '$lib/icon';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	/** How often the list re-reads while an export is still going. */
	const POLL_MS = 2000;

	const running = $derived(data.jobs.filter(active));
	const failed = $derived(data.jobs.filter((j) => j.status === 'failed').length);
	// Running and failed are counted from the rows on this page, so once the
	// list is paged their tiles say so beside a total that covers every page.
	const paged = $derived(data.total > data.jobs.length);

	/**
	 * A completed export that names no limit and wrote the ceiling stopped
	 * there. The count cannot say whether more entries matched, so the row
	 * says the ceiling was reached rather than that the file was cut.
	 */
	function atCeiling(job: { status: string; rows_written: number; filter?: { limit?: number } | null }): boolean {
		return job.status === 'completed' && !(job.filter?.limit && job.filter.limit > 0) && job.rows_written >= EXPORT_ROW_CEILING;
	}

	// A running export moves on the server, not here, so the page re-reads
	// its load until nothing is left running and then stops asking.
	$effect(() => {
		if (running.length === 0) return;
		const id = setInterval(() => void invalidate('app:data-export'), POLL_MS);
		return () => clearInterval(id);
	});

	let narrow = $state('');
	const visible = $derived(
		narrow.trim()
			? data.jobs.filter((j) =>
					`${j.name} ${j.format} ${j.status}`.toLowerCase().includes(narrow.trim().toLowerCase()),
				)
			: data.jobs,
	);

	// Null while the schema list is unread, so the fields say why the choice is empty.
	const schemaNames = $derived(data.schemas.ok ? data.schemas.value : null);

	function downloadHref(id: string): string {
		return `${JOBS_URL}/${encodeURIComponent(id)}/download`;
	}

	function scopeText(schemas: string[] | null | undefined): string {
		if (!schemas || schemas.length === 0) return 'Every content type';
		if (schemas.length <= 3) return schemas.join(', ');
		return `${schemas.slice(0, 2).join(', ')} and ${schemas.length - 2} more`;
	}

	// Every form on this page reports through one result, so each failure is
	// tagged with its action and shown only where that action was made. A
	// drawer opened after a failure starts clean: the result is set aside.
	let setAside = $state<unknown>(null);
	const failure = $derived(
		form && form !== setAside && 'error' in form ? (form as { action?: string; error?: string }) : null,
	);
	const startError = $derived(failure?.action === 'start' ? failure.error : undefined);
	const scheduleError = $derived(failure?.action === 'createSchedule' ? failure.error : undefined);
	const rowError = $derived(
		failure && failure.action !== 'start' && failure.action !== 'createSchedule' ? failure.error : undefined,
	);

	// Start drawer.
	let startOpen = $state(false);
	let name = $state('');
	let format = $state('json');
	let schemas = $state<string[]>([]);
	let statuses = $state<string[]>([]);
	let includeSchemas = $state(false);
	let includeMedia = $state(false);
	let template = $state('');
	function openStart() {
		name = `Export ${new Date().toISOString().slice(0, 10)}`;
		format = 'json';
		schemas = [];
		statuses = [];
		includeSchemas = false;
		includeMedia = false;
		template = '';
		setAside = form;
		startOpen = true;
	}
	const start = submitter(() => (startOpen = false));

	// Schedule drawer.
	let scheduleOpen = $state(false);
	let schName = $state('');
	let schCron = $state<string>('0 2 * * *');
	let schCustom = $state('');
	let schEnabled = $state(true);
	let schFormat = $state('json');
	let schSchemas = $state<string[]>([]);
	let schStatuses = $state<string[]>([]);
	let schIncludeSchemas = $state(false);
	let schIncludeMedia = $state(false);
	let schTemplate = $state('');
	const cronOptions = [...CRON_PRESETS, { value: 'custom', label: 'Custom cron expression' }];
	function openSchedule() {
		schName = '';
		schCron = '0 2 * * *';
		schCustom = '';
		schEnabled = true;
		schFormat = 'json';
		schSchemas = [];
		schStatuses = [];
		schIncludeSchemas = false;
		schIncludeMedia = false;
		schTemplate = '';
		setAside = form;
		scheduleOpen = true;
	}
	const createSchedule = submitter(() => (scheduleOpen = false));

	function removeSchedule(s: ExportSchedule): SubmitFunction {
		return confirmed(
			`Delete schedule ${s.name}?`,
			'No new exports start from it. Exports it already started stay in the list.',
			{ confirmLabel: 'Delete' },
		);
	}
</script>

<PageShell
	title="Data export"
	description="Export your data, follow running exports and schedule recurring ones."
	width="wide"
>
	{#snippet actions()}
		<RefreshButton dependency="app:data-export" />
		{#if data.gate.state === 'ok'}
			<Button variant="primary" size="sm" onclick={openStart}>
				<Plus size={ICON.sm} /> New export
			</Button>
		{/if}
	{/snippet}

	{#if data.gate.state !== 'ok'}
		<GateNotice
			level={2}
			gate={data.gate}
			title="Data export"
			absent="Data export is not included in this build."
		/>
	{:else}
		<FormErrors message={rowError} />
		{#if form?.started}
			<Alert tone="success" autoDismiss>
				Export started. It runs in the background, and the list below updates until it finishes.
			</Alert>
		{/if}
		{#if form?.canceled}
			<Alert tone="brand" autoDismiss>Export canceled. No file was created.</Alert>
		{/if}
		{#if form?.scheduled}
			<Alert tone="success" autoDismiss>Schedule created.</Alert>
		{/if}

		<div class="grid gap-4 sm:grid-cols-3">
			<Stat size="sm" mono label="Exports" value={formatCount(data.total)} />
			<Stat size="sm" mono label={paged ? 'Running on this page' : 'Running'} value={formatCount(running.length)} />
			<Stat
				size="sm"
				mono
				label={paged ? 'Failed on this page' : 'Failed'}
				value={formatCount(failed)}
				tone={failed > 0 ? 'danger' : undefined}
			/>
		</div>

		<section class="flex flex-col gap-4">
			<div class="flex flex-wrap items-center justify-between gap-2">
				<SectionHeading level={2}>Exports</SectionHeading>
				{#if running.length > 0}
					<p class="flex items-center gap-2 text-xs text-muted" role="status">
						<Spinner size={ICON.xs} />
						{running.length === 1 ? 'One export is running.' : `${running.length} exports are running.`}
						This list updates until every export finishes.
					</p>
				{/if}
			</div>

			{#if data.jobs.length === 0}
				<EmptyState
					title="No exports yet"
					description="Exports appear here while they run and after they finish."
				>
					{#snippet iconSnippet()}
						<Download size={ICON.lg} />
					{/snippet}
					{#snippet action()}
						<Button variant="secondary" onclick={openStart}><Plus size={ICON.sm} /> New export</Button>
					{/snippet}
				</EmptyState>
			{:else}
				<ListToolbar label="Filter exports">
					{#snippet search()}
						<label for="export-narrow" class="sr-only">Search this page</label>
						<SearchInput
							id="export-narrow"
							bind:value={narrow}
							placeholder="Name, format or status on this page"
						/>
					{/snippet}
				</ListToolbar>

				{#if visible.length === 0}
					<EmptyState title="No exports match this search" description="Clear the search, or go to another page.">
						{#snippet iconSnippet()}
							<Search size={ICON.lg} />
						{/snippet}
					</EmptyState>
				{:else}
					<Table label="Exports">
						<thead>
							<tr>
								<th scope="col">Name</th>
								<th scope="col">What</th>
								<th scope="col">Status</th>
								<th scope="col">Entries</th>
								<th scope="col">Size</th>
								<th scope="col" class="text-right">Actions</th>
							</tr>
						</thead>
						<tbody>
							{#each visible as job (job.id)}
								<tr>
									<td>
										{job.name}
										<div class="text-xs text-faint">{formatDateTime(job.created_at)}</div>
									</td>
									<td>
										<span class="text-sm">{FORMAT_LABELS[job.format]?.label ?? job.format}</span>
										<div class="text-xs text-faint">
											{scopeText(job.filter?.schemas)}{job.include_schemas ? ', with definitions' : ''}
										</div>
									</td>
									<td class="min-w-48">
										<div class="flex flex-col gap-1">
											<div class="flex items-center gap-2">
												<Badge tone={jobTone(job.status)}>{job.status}</Badge>
												{#if !active(job)}
													<span class="text-xs text-muted">{stageText(job)}</span>
												{/if}
											</div>
											{#if active(job)}
												<!-- The step is the bar's name, so a reader hears what the
												     export is doing along with how far it got. -->
												<Progress
													value={Math.round(jobProgress(job) * 100)}
													size="sm"
													label={stageText(job)}
													animated={job.rows_total === 0}
												/>
											{/if}
											{#if job.error}
												<div class="text-xs text-danger">{job.error}</div>
											{/if}
										</div>
									</td>
									<td data-cell="nowrap" class="text-xs">
										{formatCount(job.status === 'completed' ? job.rows_written : job.rows_processed)}
										{#if job.rows_total > 0}<span class="text-faint"> of {formatCount(job.rows_total)}</span>{/if}
										{#if atCeiling(job)}
											<div class="text-warn">
												This export reached the {formatCount(EXPORT_ROW_CEILING)} entry limit, so entries past it are not in the file.
											</div>
										{/if}
									</td>
									<td data-cell="nowrap" class="text-xs"
										>{job.file_size > 0 ? formatBytes(job.file_size, 'GB') : NO_VALUE}</td
									>
									<td>
										<div class="flex items-center justify-end gap-2">
											{#if downloadable(job)}
												<Button
													variant="ghost"
													size="sm"
													href={downloadHref(job.id)}
													aria-label="Download {job.name}"
												>
													<Download size={ICON.sm} />
												</Button>
											{/if}
											{#if active(job)}
												<form method="post" action="?/cancel" use:enhance>
													<input type="hidden" name="id" value={job.id} />
													<Button variant="ghost" size="sm" type="submit" aria-label="Cancel {job.name}">
														<X size={ICON.sm} />
													</Button>
												</form>
											{/if}
										</div>
									</td>
								</tr>
							{/each}
						</tbody>
					</Table>
				{/if}
				<Pagination
					page={pageNumber(data.offset, data.limit)}
					perPage={data.limit}
					count={data.jobs.length}
					total={data.total ?? undefined}
					noun="exports"
					href={pageHref('/admin/data-export', data.limit)}
				/>
			{/if}
		</section>

		<section class="flex flex-col gap-4">
			<div class="flex flex-wrap items-center justify-between gap-2">
				<SectionHeading level={2}>Schedules</SectionHeading>
				{#if data.schedules.ok && data.schedules.value.length > 0}
					<Button variant="secondary" size="sm" onclick={openSchedule}>
						<Plus size={ICON.sm} /> New schedule
					</Button>
				{/if}
			</div>
			{#if !data.schedules.ok}
				<GateNotice
					gate={data.schedules.gate}
					title="Export schedules"
					absent="Scheduled exports are not included in this build."
				/>
			{:else if data.schedules.value.length === 0}
				<EmptyState
					title="No schedules yet"
					description="Create a schedule to run an export on a timetable, in UTC. Each run appears in the list above."
				>
					{#snippet iconSnippet()}
						<CalendarClock size={ICON.lg} />
					{/snippet}
					{#snippet action()}
						<Button variant="secondary" onclick={openSchedule}><Plus size={ICON.sm} /> New schedule</Button>
					{/snippet}
				</EmptyState>
			{:else}
				<Table label="Schedules">
					<thead>
						<tr>
							<th scope="col">Name</th>
							<th scope="col">When</th>
							<th scope="col">What</th>
							<th scope="col">State</th>
							<th scope="col">Last run</th>
							<th scope="col">Next run</th>
							<th scope="col" class="text-right">Actions</th>
						</tr>
					</thead>
					<tbody>
						{#each data.schedules.value as schedule (schedule.id)}
							<tr>
								<td data-cell="nowrap">{schedule.name}</td>
								<td>
									{cronLabel(schedule.cron_expression)}
									<div class="font-mono text-xs text-faint">{schedule.cron_expression}</div>
								</td>
								<td class="text-xs">
									{schedule.export_config
										? `${FORMAT_LABELS[schedule.export_config.format]?.label ?? schedule.export_config.format}, ${scopeText(schedule.export_config.filter?.schemas)}`
										: NO_VALUE}
								</td>
								<td data-cell="nowrap">
									<Badge tone={schedule.enabled ? 'success' : 'neutral'} dot>
										{scheduleState(schedule)}
									</Badge>
								</td>
								<td data-cell="nowrap" class="text-xs text-faint"
									>{schedule.last_run_at ? formatDateTime(schedule.last_run_at) : NO_VALUE}</td
								>
								<td data-cell="nowrap" class="text-xs text-faint">
									{schedule.enabled && schedule.next_run_at
										? formatDateTime(schedule.next_run_at)
										: NO_VALUE}
								</td>
								<td>
									<div class="flex items-center justify-end gap-2">
										<form method="post" action="?/toggleSchedule" use:enhance>
											<input type="hidden" name="id" value={schedule.id} />
											<input type="hidden" name="enabled" value={schedule.enabled ? 'false' : 'true'} />
											<Button
												variant="ghost"
												size="sm"
												type="submit"
												aria-label="{schedule.enabled ? 'Pause' : 'Resume'} {schedule.name}"
											>
												{#if schedule.enabled}<Pause size={ICON.sm} />{:else}<Play size={ICON.sm} />{/if}
											</Button>
										</form>
										<form method="post" action="?/deleteSchedule" use:enhance={removeSchedule(schedule)}>
											<input type="hidden" name="id" value={schedule.id} />
											<Button variant="ghost" size="sm" type="submit" aria-label="Delete {schedule.name}">
												<Trash2 size={ICON.sm} class="text-danger" />
											</Button>
										</form>
									</div>
								</td>
							</tr>
						{/each}
					</tbody>
				</Table>
			{/if}
		</section>
	{/if}
</PageShell>

<Drawer
	bind:open={startOpen}
	title="New export"
	description="The export runs in the background. You can download the file here when it finishes."
>
	<form id="start-export-form" method="post" action="?/start" use:enhance={start.enhance}>
		<div class="flex flex-col gap-4">
			<FormErrors message={startError} />
			<Input id="export-name" name="name" label="Name" bind:value={name} required />
			<ExportConfigFields
				idPrefix="export"
				{schemaNames}
				bind:format
				bind:schemas
				bind:statuses
				bind:includeSchemas
				bind:includeMedia
				bind:template
			/>
		</div>
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (startOpen = false)}>Cancel</Button>
		<Button variant="primary" type="submit" form="start-export-form" loading={start.pending}>Start</Button>
	{/snippet}
</Drawer>

<Drawer
	bind:open={scheduleOpen}
	title="New schedule"
	description="Run this export on a timetable, in UTC. Missed runs are caught up with a single run."
>
	<form id="schedule-form" method="post" action="?/createSchedule" use:enhance={createSchedule.enhance}>
		<div class="flex flex-col gap-4">
			<FormErrors message={scheduleError} />
			<Input id="schedule-name" name="name" label="Name" bind:value={schName} required />
			<Select
				id="schedule-when"
				label="When"
				bind:value={schCron}
				options={cronOptions}
			/>
			{#if schCron === 'custom'}
				<Input
					id="schedule-cron"
					label="Cron expression"
					hint="Five fields (minute hour day month weekday), or @hourly, @daily, @weekly, @monthly, @every 6h."
					mono
					bind:value={schCustom}
					required
				/>
			{/if}
			<input type="hidden" name="cron_expression" value={schCron === 'custom' ? schCustom : schCron} />
			<ExportConfigFields
				idPrefix="schedule"
				{schemaNames}
				bind:format={schFormat}
				bind:schemas={schSchemas}
				bind:statuses={schStatuses}
				bind:includeSchemas={schIncludeSchemas}
				bind:includeMedia={schIncludeMedia}
				bind:template={schTemplate}
			/>
			<input type="hidden" name="enabled" value={schEnabled ? 'true' : 'false'} />
			<Toggle id="schedule-enabled" label="Run on the timetable" bind:checked={schEnabled} />
		</div>
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (scheduleOpen = false)}>Cancel</Button>
		<Button variant="primary" type="submit" form="schedule-form" loading={createSchedule.pending}>
			Create
		</Button>
	{/snippet}
</Drawer>
