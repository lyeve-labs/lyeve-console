<script lang="ts">
	import {
		Alert,
		Badge,
		Button,
		DatePicker,
		EmptyState,
		PageShell,
		SearchInput,
		SectionHeading,
		Select,
		Pagination,
		Table,
		closeDialog,
		dismissDialog,
		openDialog,
		type StatusTone,
	} from '@lyeve-labs/ui-kit';
	import { tick } from 'svelte';
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { ScrollText, Download, Trash2 } from '@lucide/svelte';
	import AuditTabs from '$lib/components/AuditTabs.svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import ListToolbar from '$lib/components/ListToolbar.svelte';
	import { NO_VALUE, formatDateTime, plural } from '$lib/format';
	import { listQuery } from '$lib/back';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { PageData, ActionData } from './$types';
	import { pageNumber, pageOffset } from '$lib/api/list';
	import { ICON } from '$lib/icon';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let pruning = $state(false);
	let pruneDate = $state('');
	let pruneForm = $state<HTMLFormElement>();
	let error = $state<string | null>(null);

	function actionVariant(action: string): StatusTone {
		if (action.startsWith('create')) return 'success';
		if (action.startsWith('delete') || action.startsWith('drop')) return 'danger';
		if (action.startsWith('update') || action.startsWith('alter')) return 'warn';
		return 'neutral';
	}

	/**
	 * Prune destroys the record that would show what happened here. The date is
	 * asked for inside the confirmation, so the cut-off and the question about
	 * it are one step, and the write only leaves once the dialog answered yes.
	 * The dialog renders through the DialogContainer the admin layout mounts.
	 */
	async function askPrune() {
		pruneDate = '';
		const ok = await openDialog<boolean>({
			title: 'Prune audit entries',
			body: pruneBody,
			footer: pruneFooter,
			size: 'sm',
		}).catch(() => false);
		if (!ok || !pruneDate) return;
		// The form's field takes the chosen date on the next render.
		await tick();
		pruneForm?.requestSubmit();
	}

	const handlePruneSubmit: SubmitFunction = () => {
		return async ({ result, update }) => {
			pruning = true;
			error = null;
			await update();
			pruning = false;
			if (result.type === 'failure') {
				error = ((result.data as Record<string, unknown>)?.error as string) ?? 'Could not prune the audit log. Try again.';
			}
		};
	};

	// Written by the controls, re-derived when a navigation changes the URL, so
	// the back button puts the controls where the list is.
	let q = $derived(data.filter.q);
	let action = $derived(data.filter.action);
	let from = $derived(data.filter.from);
	let to = $derived(data.filter.to);
	const filtered = $derived(Object.values(data.filter).some(Boolean));
	const actionOptions = $derived([
		{ value: '', label: 'All actions' },
		...data.actions.map((a) => ({ value: a, label: a })),
	]);

	// Links, not goto(). A click that lands before the page hydrates reaches no
	// handler at all. An href works from the server-rendered document, which is
	// how every other list here pages.
	const pageHref = (offset: number) => `/admin/audit-log${listQuery({ ...data.filter, offset: offset || null })}`;
	const prunedCount = $derived(Number(page.url.searchParams.get('pruned') ?? 0));
</script>

{#snippet emptyIcon()}
	<ScrollText size={ICON.lg} />
{/snippet}

<!-- The export takes the filter in force, so the file holds what the list
     shows. -->
{#snippet exportFilter()}
	{#each Object.entries(data.filter) as [key, value] (key)}
		{#if value}<input type="hidden" name={key} value={value} />{/if}
	{/each}
{/snippet}

{#snippet pruneBody()}
	<div class="flex flex-col gap-3">
		<p class="text-sm text-muted">
			Entries older than this date are deleted. They cannot be recovered or exported afterwards.
		</p>
		<DatePicker
			id="prune-older-than"
			label="Delete entries older than"
			bind:value={pruneDate}
			max={new Date().toISOString().slice(0, 10)}
		/>
	</div>
{/snippet}

{#snippet pruneFooter()}
	<Button variant="secondary" size="sm" onclick={() => dismissDialog()} data-initial-focus>Cancel</Button>
	<Button variant="danger" size="sm" disabled={!pruneDate} onclick={() => closeDialog(true)}>Delete</Button>
{/snippet}

<PageShell
	title="Audit log"
	description={data.total === null ? undefined : `${data.total} ${plural(data.total, 'entry', 'entries')}`}
	width="wide"
>
	{#snippet actions()}
		<!-- Posts to an endpoint, not an action: SvelteKit refuses a Response from a
		     form action, and a download has to be one. -->
		<form method="POST" action="/admin/audit-log/export">
			{@render exportFilter()}
			<Button type="submit" variant="secondary" size="sm">
				<Download size={ICON.sm} /> Export JSON
			</Button>
		</form>

		{#if data.isSuperAdmin}
			<form method="POST" action="/admin/audit-log/export-all">
				{@render exportFilter()}
				<Button type="submit" variant="secondary" size="sm">
					<Download size={ICON.sm} /> Export all
				</Button>
			</form>
			<Button variant="secondary" size="sm" onclick={askPrune} loading={pruning}>
				<Trash2 size={ICON.sm} /> Prune
			</Button>
		{/if}
	{/snippet}

	<AuditTabs active="entries" entries={data.total ?? undefined} />

	{#if prunedCount > 0}
		<Alert tone="success" autoDismiss>
			Pruned {prunedCount} audit log {plural(prunedCount, 'entry', 'entries')}.
		</Alert>
	{/if}

	{#if error}
		<Alert tone="danger">{error}</Alert>
	{/if}

	<!-- A GET form: the filter lives in the URL, so a filtered view is a link
	     someone can keep. The date pickers are buttons with popovers, so the
	     chosen days reach the query through fields of their own. -->
	<form method="GET">
		<ListToolbar label="Filter audit entries">
			{#snippet search()}
				<div class="flex items-center gap-2">
					<label for="audit-search" class="sr-only">Search by action, resource type or user id</label>
					<SearchInput
						id="audit-search"
						name="q"
						bind:value={q}
						placeholder="Action, resource type or user id"
						class="min-w-0 flex-1"
					/>
					<Button type="submit" variant="secondary">Search</Button>
					{#if filtered}
						<Button variant="ghost" href="/admin/audit-log">Clear</Button>
					{/if}
				</div>
			{/snippet}
			{#snippet filters()}
				<label for="audit-action" class="sr-only">Action</label>
				<Select id="audit-action" name="action" options={actionOptions} bind:value={action} searchable class="w-44" />
				<label for="audit-from" class="sr-only">From</label>
				<DatePicker id="audit-from" placeholder="From" bind:value={from} class="w-36" />
				<input type="hidden" name="from" value={from} />
				<label for="audit-to" class="sr-only">To</label>
				<DatePicker id="audit-to" placeholder="To" bind:value={to} class="w-36" />
				<input type="hidden" name="to" value={to} />
			{/snippet}
		</ListToolbar>
	</form>
	<p class="text-xs text-muted">{data.exportNote}</p>

	<!-- The table is over a thousand cells under the page title alone, which is
	     a screen reader's only landmark on this page and no way to skim it. -->
	<section class="flex flex-col gap-4">
		<SectionHeading level={2}>Entries</SectionHeading>

		{#if !data.entries.ok}
			<GateNotice
				gate={data.entries.gate}
				title="Audit log"
				absent="The audit log is not included in this build."
			/>
		{:else if data.entries.value.length === 0 && (data.total ?? 0) > 0}
			<!-- The count and the rows were read apart, so a page can come back
			     empty while the log is not. Neither empty state is true then. -->
			<EmptyState
				iconSnippet={emptyIcon}
				title="No entries on this page"
				description={`The audit log has ${data.total} ${plural(data.total ?? 0, 'entry', 'entries')}, but none are on this page. Go to the first page.`}
			>
				{#snippet action()}
					<Button variant="secondary" href={pageHref(0)}>Go to the first page</Button>
				{/snippet}
			</EmptyState>
		{:else if data.entries.value.length === 0 && filtered}
			<EmptyState
				iconSnippet={emptyIcon}
				title="No audit entries match"
				description="Search matches whole values only. Try the exact name, widen the dates or clear the action."
			/>
		{:else if data.entries.value.length === 0}
			<EmptyState
				iconSnippet={emptyIcon}
				title="No audit entries yet"
				description="Changes to content, content types and settings are recorded here as they happen."
			/>
		{:else}
			<div class="flex flex-col gap-4">
				<Table label="Entries">
					<thead>
						<tr>
							<th scope="col">Time</th>
							<th scope="col">Action</th>
							<th scope="col">Resource</th>
							<th scope="col">User</th>
							<th scope="col">IP</th>
						</tr>
					</thead>
					<tbody>
						{#each data.entries.value as entry (entry.id)}
							<tr>
								<td class="whitespace-nowrap text-xs">
									<span class="text-faint">{formatDateTime(entry.created_at)}</span>
								</td>
								<td>
									<Badge tone={actionVariant(entry.action)}>{entry.action}</Badge>
								</td>
								<td data-cell="nowrap" class="font-mono text-xs">
									{entry.resource_type}{entry.resource_id ? `/${entry.resource_id}` : ''}
								</td>
								<td data-cell="nowrap" class="text-xs">
									<span class="text-muted">{entry.user_id || NO_VALUE}</span>
								</td>
								<td data-cell="nowrap" class="font-mono text-xs">
									<span class="text-faint">{entry.ip || NO_VALUE}</span>
								</td>
							</tr>
						{/each}
					</tbody>
				</Table>

				<Pagination
					page={pageNumber(data.offset, data.limit)}
					perPage={data.limit}
					count={data.entries.value.length}
					total={data.total ?? undefined}
					noun="entries"
					href={(page) => pageHref(pageOffset(page, data.limit))}
				/>
			</div>
		{/if}
	</section>
</PageShell>

{#if data.isSuperAdmin}
	<form method="POST" action="?/prune" use:enhance={handlePruneSubmit} bind:this={pruneForm} class="hidden">
		<input type="hidden" name="older_than" value={pruneDate} />
	</form>
{/if}
