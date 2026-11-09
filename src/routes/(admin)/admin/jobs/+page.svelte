<script lang="ts">
	import {
		Badge,
		Button,
		CopyField,
		Drawer,
		EmptyState,
		Input,
		Modal,
		NumberInput,
		PageShell,
		Pagination,
		SearchInput,
		SegmentedControl,
		Table,
		Textarea,
		Toggle,
	} from '@lyeve-labs/ui-kit';
	import type { PageData, ActionData } from './$types';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Plus, Trash2, Pencil, Clock, CheckCircle, XCircle, Inbox } from '@lucide/svelte';
	import type { Job } from './+page.server';
	import ListToolbar from '$lib/components/ListToolbar.svelte';
	import { confirmed, drawerFailure, submitter } from '$lib/forms.svelte';
	import FormErrors from '$lib/components/FormErrors.svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import { formRefusal } from '$lib/api/refusal';
	import { ALERT_PREFIX, hasChannels } from '$lib/api/cron-alerts';
	import AlertChannelFields from '$lib/components/AlertChannelFields.svelte';
	import { formatDateTime } from '$lib/format';
	import { narrows } from '$lib/narrow';
	import { pageHref, pageNumber } from '$lib/api/list';
	import { ICON } from '$lib/icon';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const submit = submitter(closeDrawer);

	/*
	 * The list is one page of the collection and the endpoint states no total, so
	 * a subtitle that counted jobs would claim the page is all of them. It names
	 * the feature instead and the pager states the range.
	 */
	const description = 'Run HTTP requests on cron schedules.';

	// One drawer for both writes: a null target is a new job.
	let open = $state(false);
	let editing = $state<Job | null>(null);
	let enabled = $state(true);
	let payload = $state('');
	let threshold = $state(1);

	const refused = $derived(formRefusal(form));

	// The alert webhook's signing secret arrives once, in the answer to the
	// write that set the URL.
	let reveal = $state<{ name: string; secret: string } | null>(null);
	$effect(() => {
		if (form && 'signingSecret' in form && typeof form.signingSecret === 'string' && form.signingSecret) {
			reveal = { name: String(form.signingFor ?? ''), secret: form.signingSecret };
		}
	});
	const formError = $derived(form && 'error' in form && form.error ? String(form.error) : undefined);
	// A failed create or update belongs to the drawer that sent it, and only
	// when it came back after that drawer opened. A failed delete belongs to
	// the page. Read by the wrong drawer, a failure greets the next job as that
	// job's own.
	const failure = drawerFailure(() => form, ['create', 'update']);
	const drawerFailed = $derived(failure.drawer !== null);

	// The address effect below calls both openers. Reading `form` untracked
	// keeps every answer from reopening the drawer.
	function openCreate() {
		editing = null;
		enabled = true;
		payload = '';
		threshold = 1;
		untrack(() => failure.opened());
		open = true;
	}

	function openEdit(job: Job) {
		editing = job;
		enabled = job.enabled;
		payload = job.payload ? JSON.stringify(job.payload, null, 2) : '';
		threshold = job.alerts?.failure_threshold ?? 1;
		untrack(() => failure.opened());
		open = true;
	}

	// The address can name the drawer, and the dashboard's alerts link to it
	// that way.
	$effect(() => {
		if (data.openJob) openEdit(data.openJob);
		else if (data.openNew) openCreate();
	});

	// Closing takes the query out of the address, or the next load would open
	// the drawer again on a job the reader had just put away.
	function closeDrawer() {
		open = false;
		if (page.url.searchParams.has('edit') || page.url.searchParams.has('new')) {
			void goto('/admin/jobs', { replaceState: true, noScroll: true, keepFocus: true });
		}
	}

	/**
	 * The question names the job, so it is tied to a row by more than which
	 * button was pressed. enhance awaits this before it sends anything, so
	 * canceling here means the request is never made.
	 */
	function deleteJob(name: string): SubmitFunction {
		return confirmed(
			`Delete ${name}?`,
			'Its schedule stops and its run history is deleted. This cannot be undone.',
			{ confirmLabel: 'Delete', success: 'Job deleted.' },
		);
	}

	// The endpoint takes no search, so the box narrows the page on screen and
	// the pager below still walks the whole collection.
	let query = $state('');
	let status = $state('');
	const STATUSES = [
		{ value: '', label: 'All' },
		{ value: 'enabled', label: 'Enabled' },
		{ value: 'disabled', label: 'Disabled' },
	];
	const visible = $derived(
		(data.jobs.ok ? data.jobs.value : []).filter(
			(j) =>
				narrows(query, j.name, j.description, j.schedule, j.endpoint) &&
				(status === '' || (status === 'enabled') === j.enabled)
		)
	);
</script>

<PageShell title="Scheduled jobs" {description} width="wide">
	{#snippet actions()}
		<!-- A list that could not be read offers no write against it. -->
		{#if data.jobs.ok}
			<Button variant="primary" size="sm" onclick={openCreate}>
				<Plus size={ICON.sm} /> New job
			</Button>
		{/if}
	{/snippet}

	<FormErrors message={failure.page ? formError : undefined} refused={failure.page ? refused : null} />

	{#if data.openGate}
		<!-- The address named a job the drawer could not open on. -->
		<GateNotice
			level={2}
			gate={data.openGate}
			title="The linked job"
			absent="This job no longer exists."
		/>
	{/if}

	{#if !data.jobs.ok}
		<GateNotice
			level={2}
			gate={data.jobs.gate}
			title="Scheduled jobs"
			absent="Scheduled jobs are not included in this build."
		/>
	{:else if data.jobs.value.length === 0}
		<EmptyState level={2} title="No jobs yet" description="Schedule HTTP jobs to run on a cron expression.">
			{#snippet iconSnippet()}
				<Inbox size={ICON.lg} />
			{/snippet}
			{#snippet action()}
				<Button variant="secondary" onclick={openCreate}>
					<Plus size={ICON.sm} /> New job
				</Button>
			{/snippet}
		</EmptyState>
	{:else}
		<ListToolbar label="Filter jobs">
			{#snippet search()}
				<label for="job-search" class="sr-only">Search this page</label>
				<SearchInput id="job-search" bind:value={query} placeholder="Name, schedule or endpoint on this page" />
			{/snippet}
			{#snippet filters()}
				<SegmentedControl label="Status" labelHidden bind:value={status} options={STATUSES} />
			{/snippet}
		</ListToolbar>

		{#if visible.length === 0}
			<EmptyState level={2} title="No jobs on this page match these filters" description="Clear the search and the status filter, or go to another page. The search covers only this page." />
		{:else}
		<Table label="Scheduled jobs">
			<thead>
				<tr>
					<th scope="col">Name</th>
					<th scope="col">Schedule</th>
					<th scope="col">Endpoint</th>
					<th scope="col">Status</th>
					<th scope="col">Last run</th>
					<th scope="col" class="text-right">Actions</th>
				</tr>
			</thead>
			<tbody>
				{#each visible as job (job.id)}
					<tr>
						<td>
							<p class="font-medium text-fg">{job.name}</p>
							{#if job.description}
								<p class="mt-0.5 text-xs text-faint">{job.description}</p>
							{/if}
						</td>
						<td data-cell="nowrap" class="font-mono text-xs text-muted">{job.schedule}</td>
						<td class="max-w-48 truncate font-mono text-xs text-faint">{job.endpoint}</td>
						<td>
							{#if job.enabled}
								<Badge tone="success" dot>Enabled</Badge>
							{:else}
								<Badge tone="neutral" dot>Disabled</Badge>
							{/if}
						</td>
						<td data-cell="nowrap">
							<div class="flex items-center gap-1.5 text-xs text-faint">
								{#if job.last_status === 'ok'}
									<CheckCircle size={ICON.xs} class="shrink-0 text-success" />
								{:else if job.last_status === 'error'}
									<XCircle size={ICON.xs} class="shrink-0 text-danger" />
								{:else}
									<Clock size={ICON.xs} class="shrink-0" />
								{/if}
								{formatDateTime(job.last_run_at, 'Never')}
							</div>
						</td>
						<td>
							<div class="flex items-center justify-end gap-2">
								<Button
									variant="ghost"
									size="sm"
									aria-label="Edit {job.name}"
									onclick={() => openEdit(job)}
								>
									<Pencil size={ICON.sm} />
								</Button>
								<form
									method="POST"
									action="?/delete"
									use:enhance={deleteJob(job.name)}
								>
									<input type="hidden" name="id" value={job.id} />
									<Button
										variant="ghost"
										size="sm"
										type="submit"
										aria-label="Delete {job.name}"
									>
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

		<!-- The endpoint states no total, so the range comes from the rows on
		     screen: without the count the summary could only name the page. -->
		<Pagination
			page={pageNumber(data.offset, data.limit)}
			perPage={data.limit}
			count={data.jobs.value.length}
			hasNext={data.hasMore}
			noun="jobs"
			href={pageHref('/admin/jobs', data.limit)}
		/>
	{/if}
</PageShell>

{#if reveal}
	<Modal open title="Alert signing secret" onclose={() => (reveal = null)}>
		<div class="flex flex-col gap-3">
			<p class="text-sm text-fg">
				Failure alerts for {reveal.name} are signed with this secret before they reach its webhook. Copy it to the receiver now. It is not shown again.
			</p>
			<CopyField value={reveal.secret} label="Signing secret" mono secret />
		</div>
		{#snippet footer()}
			<Button variant="secondary" onclick={() => (reveal = null)}>Close</Button>
		{/snippet}
	</Modal>
{/if}

<Drawer bind:open title={editing ? `Edit ${editing.name}` : 'New job'} onclose={closeDrawer}>
	<form
		method="POST"
		action={editing ? '?/update' : '?/create'}
		id="job-form"
		use:enhance={submit.enhance}
		class="flex flex-col gap-4"
	>
		<FormErrors message={drawerFailed ? formError : undefined} refused={drawerFailed ? refused : null} />
		{#if editing}<input type="hidden" name="id" value={editing.id} />{/if}
		{#if editing?.payload}<input type="hidden" name="had_payload" value="true" />{/if}

		<Input id="job-name" label="Name" name="name" required placeholder="send-daily-digest" value={editing?.name ?? ''} />
		<Input
			id="job-description"
			label="Description"
			name="description"
			placeholder="Sends the daily digest email"
			value={editing?.description ?? ''}
		/>
		<Input
			id="job-schedule"
			label="Cron schedule"
			name="schedule"
			required
			placeholder="0 9 * * *"
			hint="Standard cron expression, for example 0 9 * * * for 9 AM daily"
			value={editing?.schedule ?? ''}
		/>
		<Input
			id="job-endpoint"
			label="Endpoint URL"
			name="endpoint"
			type="url"
			required
			placeholder="https://example.com/api/trigger"
			value={editing?.endpoint ?? ''}
		/>
		<Textarea
			id="job-payload"
			label="JSON payload (optional)"
			name="payload"
			rows={4}
			placeholder={'{\n  "key": "value"\n}'}
			hint={editing?.payload
				? 'If you clear it, each run sends an empty JSON object. A job with a payload cannot go back to sending none.'
				: undefined}
			bind:value={payload}
		/>
		<!-- Toggle is a switch button rather than a form control, so the value
		     reaches the action through a field of its own. -->
		<div>
			<input type="hidden" name="enabled" value={enabled ? 'on' : 'off'} />
			<Toggle id="job-enabled" bind:checked={enabled} label="Enabled" hint="When on, the job runs on its schedule." />
		</div>

		<fieldset class="flex flex-col gap-4 border-t border-line pt-4">
			<legend class="text-sm font-medium text-fg">Failure alerts</legend>
			<p class="text-xs text-muted">
				Choose where to send an alert when a job starts failing and when it recovers. Leave every channel empty to send no alerts. Email alerts are always available.
			</p>
			<input type="hidden" name="alerts_stored" value={hasChannels(editing?.alerts) ? 'true' : 'false'} />
			<AlertChannelFields prefix={ALERT_PREFIX} idPrefix="job-alert" value={editing?.alerts ?? null} />
			<NumberInput
				id="job-alert-threshold"
				label="Alert after this many failures in a row"
				name="alert_threshold"
				min={1}
				bind:value={threshold}
			/>
		</fieldset>
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={closeDrawer}>Cancel</Button>
		<Button variant="primary" type="submit" form="job-form" loading={submit.pending}>{editing ? 'Save' : 'Create'}</Button>
	{/snippet}
</Drawer>
