<script lang="ts">
	import {
		Alert,
		Badge,
		Button,
		Card,
		Checkbox,
		DateTimePicker,
		EmptyState,
		Input,
		PageShell,
		SearchInput,
		Toggle,
		SectionHeading,
		Stat,
		Table,
		Pagination,
		confirm,
	} from '@lyeve-labs/ui-kit';
	import RefreshButton from '#lib/components/RefreshButton.svelte';
	import { enhance } from '#lib/enhance.ts';
	import { CONFIRM_FIELD, CONFIRMED } from '#lib/confirmation.ts';
	import type { SubmitFunction } from '$app/forms';
	import { browserOffset } from '#lib/utils/wall-clock.ts';
	import { History, Rss } from '@lucide/svelte';
	import GateNotice from '#lib/components/GateNotice.svelte';
	import FormErrors from '#lib/components/FormErrors.svelte';
	import ListToolbar from '#lib/components/ListToolbar.svelte';
	import { didFire, failedOnly, progressOf } from '#lib/api/events.ts';
	import { jobTone } from '#lib/tones.ts';
	import { NO_VALUE, formatDateTime } from '#lib/format.ts';
	import type { ActionData, PageData } from './$types';
	import { pageHref, pageNumber } from '#lib/api/list.ts';
	import { filterHref } from '#lib/back.ts';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { liveFilter } from '#lib/live-filter.svelte.ts';
	import { ICON } from '#lib/icon.ts';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// A replay is rehearsed by default. It publishes every event in the window
	// again to everything that listens, and nothing undoes that.
	let dryRun = $state(true);
	let since = $state('');
	// The action runs in the server's zone, so the browser's offset goes with the value.
	const sinceOffset = $derived(browserOffset(since));
	let handler = $state('');
	let starting = $state(false);

	/**
	 * A rehearsal publishes nothing, so it goes straight through. A real run
	 * asks first, naming the window and the run, because nothing undoes it.
	 * The form keeps its values after the answer: the run name decides what a
	 * later run skips, so the real run after a rehearsal has to carry it.
	 */
	const replay: SubmitFunction = async ({ cancel, formData }) => {
		if (!dryRun) {
			const name = handler.trim() ? `the run name ${handler.trim()}` : 'the shared name';
			const ok = await confirm(
				`Replay every event since ${since.replace('T', ' ')} under ${name}?`,
				'Each event is published again to every webhook, flow, the message broker, realtime clients and email triggers. This cannot be undone.',
				{ confirmLabel: 'Replay' },
			);
			if (!ok) {
				cancel();
				return;
			}
			formData.set(CONFIRM_FIELD, CONFIRMED);
		}
		starting = true;
		return async ({ update }) => {
			starting = false;
			await update({ reset: false });
		};
	};

	// The engine searches and filters the whole log, so a match past the first
	// page shows on the first. Both live in the URL, so the pager, a reload and
	// a shared link keep them.
	const live = liveFilter(() => data.q);
	const filtered = $derived(data.q !== '' || data.failed !== '');
	// A switch that applies at once. The search and the page size stay, and
	// the log starts again at its first page.
	function showFailed(on: boolean) {
		void goto(filterHref(page.url, 'failed', on ? '1' : ''), { reset: false });
	}

	const failures = $derived(failedOnly(data.events).length);
</script>

<PageShell
	title="Events"
	description="Browse the durable log of published events, and replay events from a point in time."
	width="wide"
>
	{#snippet actions()}
		<RefreshButton />
	{/snippet}

	{#if data.gate.state !== 'ok'}
		<GateNotice
			level={2}
			gate={data.gate}
			title="Event log"
			absent="The event log is not included in this build."
		/>
	{:else}
		<FormErrors message={form?.error} />
		{#if form?.started}
			<Alert tone={form.dryRun ? 'brand' : 'success'} autoDismiss={!form.dryRun}>
				{form.dryRun
					? 'Rehearsal started. It publishes nothing, and its counts appear below. Clear the rehearsal checkbox to run the replay for real.'
					: 'Replay started. It runs in the background, and its progress appears below.'}
			</Alert>
		{/if}

		<div class="grid gap-4 sm:grid-cols-3">
			<Stat size="sm" mono label={filtered ? 'Matching' : 'Recorded'} value={data.total} />
			<!-- The log is read a page at a time and the engine counts no errors
			     of its own, so this figure covers the rows on this page only. -->
			<Stat
				size="sm"
				mono
				label="With errors"
				value={failures}
				sub={`of the ${data.events.length} on this page`}
				tone={failures > 0 ? 'danger' : undefined}
			/>
			<Stat
				size="sm"
				mono
				label="Replays"
				value={data.runs.ok ? data.runs.value.total : NO_VALUE}
				sub={data.runs.ok ? undefined : 'Could not load'}
			/>
		</div>

		<section class="flex flex-col gap-4">
			<SectionHeading level={2}>Replay</SectionHeading>
			<Card>
				<form
					method="post"
					action="?/replay"
					use:enhance={replay}
					class="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
				>
					<DateTimePicker name="since" label="Replay from" bind:value={since} required />
					<input type="hidden" name="since_offset" value={sinceOffset} />
					<Input
						name="handler"
						label="Run name"
						hint="Leave empty to use one shared name."
						bind:value={handler}
					/>
					<input type="hidden" name="dry_run" value={String(dryRun)} />
					<Button variant="primary" type="submit" loading={starting}>
						<History size={ICON.sm} />
						{dryRun ? 'Rehearse' : 'Replay'}
					</Button>
				</form>
				<div class="mt-3">
					<Checkbox bind:checked={dryRun} label="Rehearse without publishing" />
					<p class="mt-1 text-xs text-muted">
						A replay publishes every event in the window again to everything that listens:
						webhooks, flows, the message broker, realtime clients and email triggers. This
						cannot be undone. A later run under the same name skips the events that name already
						replayed. The rehearsal reports the same counts and publishes nothing.
					</p>
				</div>
			</Card>

			{#if !data.runs.ok}
				<GateNotice
					gate={data.runs.gate}
					title="the replay runs"
					absent="Replay runs need a newer version of the events plugin."
				/>
			{:else if data.runs.value.rows.length > 0}
				<Table label="Replay">
					<thead>
						<tr>
							<th scope="col">Started</th>
							<th scope="col">Run name</th>
							<th scope="col">Status</th>
							<th scope="col">Progress</th>
							<th scope="col">Result</th>
						</tr>
					</thead>
					<tbody>
						{#each data.runs.value.rows as run (run.run_id)}
							<tr>
								<td data-cell="nowrap" class="text-xs">{formatDateTime(run.started_at)}</td>
								<td data-cell="nowrap" class="font-mono text-xs">
									{#if run.handler}
										{run.handler}
									{:else}
										<span class="font-sans text-faint">Shared name</span>
									{/if}
								</td>
								<td data-cell="nowrap">
									<Badge tone={jobTone(run.status)}>{run.status}</Badge>
									{#if run.dry_run}
										<Badge tone="neutral">rehearsal</Badge>
									{/if}
								</td>
								<td data-cell="nowrap" class="text-xs"
									>{Math.round(progressOf(run) * 100)}% of {run.total_events}</td
								>
								<td class="text-xs">
									{#if run.error}
										<span class="text-danger">{run.error}</span>
									{:else}
										{run.replayed} replayed, {run.skipped} skipped, {run.failed} failed
										{#if !didFire(run)}
											<span class="text-faint">(nothing was posted)</span>
										{/if}
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</Table>
			{/if}
		</section>

		<section class="flex flex-col gap-4">
			<SectionHeading level={2}>Published</SectionHeading>

			{#if data.events.length > 0 || filtered}
				<form method="GET" {@attach live.form}>
					{#if data.failed}<input type="hidden" name="failed" value={data.failed} />{/if}
					<ListToolbar label="Filter published events">
						{#snippet search()}
							<label for="event-search" class="sr-only">Search events</label>
							<SearchInput
								id="event-search"
								name="q"
								bind:value={live.value}
								oninput={live.input}
								placeholder="Topic, type or source"
							/>
						{/snippet}
						{#snippet filters()}
							<Toggle label="Only events with errors" checked={data.failed === '1'} onchange={showFailed} />
						{/snippet}
					</ListToolbar>
				</form>
			{/if}

			{#if data.events.length === 0 && filtered}
				<EmptyState title="No events match these filters" description="Clear the search or show every event.">
					{#snippet action()}
						<Button variant="secondary" href="/admin/events">Clear filters</Button>
					{/snippet}
				</EmptyState>
			{:else if data.events.length === 0}
				<EmptyState
					title="No events yet"
					description="Events appear here when a plugin or a flow publishes one."
				>
					{#snippet iconSnippet()}
						<Rss size={ICON.lg} />
					{/snippet}
				</EmptyState>
			{:else}
				<Table label="Published">
					<thead>
						<tr>
							<th scope="col">Published</th>
							<th scope="col">Topic</th>
							<th scope="col">Type</th>
							<th scope="col">Source</th>
							<th scope="col">Content type</th>
						</tr>
					</thead>
					<tbody>
						{#each data.events as row (row.id)}
							<tr>
								<td data-cell="nowrap" class="text-xs text-faint"
									>{formatDateTime(row.published_at)}</td
								>
								<td data-cell="nowrap" class="font-mono text-xs">
									{row.topic}
									{#if row.error}
										<Badge tone="danger">error</Badge>
									{/if}
								</td>
								<td data-cell="nowrap" class="text-xs">{row.event_type}</td>
								<td data-cell="nowrap" class="text-xs">{row.source || NO_VALUE}</td>
								<td data-cell="nowrap" class="text-xs">{row.schema_name || NO_VALUE}</td>
							</tr>
						{/each}
					</tbody>
				</Table>
				<Pagination
					page={pageNumber(data.offset, data.limit)}
					perPage={data.limit}
					count={data.events.length}
					total={data.total ?? undefined}
					noun="events"
					href={pageHref('/admin/events', data.limit, {
						...(data.failed ? { failed: data.failed } : {}),
						...(data.q ? { q: data.q } : {}),
					})}
				/>
			{/if}
		</section>
	{/if}
</PageShell>
