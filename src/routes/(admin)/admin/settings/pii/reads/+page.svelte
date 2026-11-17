<script lang="ts">
	import { Badge, Button, EmptyState, PageShell, Pagination, SearchInput, Stat, Table } from '@lyeve-labs/ui-kit';
	import RefreshButton from '#lib/components/RefreshButton.svelte';
	import { Eye } from '@lucide/svelte';
	import GateNotice from '#lib/components/GateNotice.svelte';
	import ListToolbar from '#lib/components/ListToolbar.svelte';
	import PiiTabs from '#lib/components/PiiTabs.svelte';
	import { byType } from '#lib/api/pii-mask.ts';
	import { NO_VALUE, formatDateTime } from '#lib/format.ts';
	import type { PageData } from './$types';
	import { ICON } from '#lib/icon.ts';
	import { pageHref, pageNumber } from '#lib/api/list.ts';
	import { liveFilter } from '#lib/live-filter.svelte.ts';

	let { data }: { data: PageData } = $props();

	const looks = $derived(byType(data.entries));
	// The plugin searches the whole log, so a match past the first page shows
	// on the first. The search lives in the URL, so the pager keeps it.
	const live = liveFilter(() => data.q);
</script>

<PageShell
	title="PII masking"
	documentTitle="Unmasked reads - PII masking"
	description="See who read data unmasked, and when."
	width="wide"
	back={{ href: '/admin/settings', label: 'Settings' }}
>
	{#snippet actions()}
		<RefreshButton />
	{/snippet}

	<PiiTabs active="reads" />

	{#if data.gate.state !== 'ok'}
		<GateNotice
			level={2}
			gate={data.gate}
			title="PII masking"
			absent="PII masking is not included in this build. Responses are not masked."
		/>
	{:else}
		<div class="grid gap-4 sm:grid-cols-4">
			<Stat size="sm" mono label={data.q ? 'Matching reads' : 'Unmasked reads'} value={data.total} />
		</div>

		{#if data.entries.length > 0 || data.q}
			<form method="GET" {@attach live.form}>
				<ListToolbar label="Filter unmasked reads">
					{#snippet search()}
						<label for="pii-search" class="sr-only">Search unmasked reads</label>
						<SearchInput
							id="pii-search"
							name="q"
							bind:value={live.value}
							oninput={live.input}
							placeholder="Kind, record or role"
						/>
					{/snippet}
				</ListToolbar>
			</form>
		{/if}

		{#if data.entries.length === 0 && data.q}
			<EmptyState title="No unmasked reads match this search" description="Clear the search to see every read.">
				{#snippet action()}
					<Button variant="secondary" href="/admin/settings/pii/reads">Clear filters</Button>
				{/snippet}
			</EmptyState>
		{:else if data.entries.length === 0}
			<EmptyState
				title="No unmasked reads yet"
				description="A read appears here when someone allowed to see a field views it unmasked."
			>
				{#snippet iconSnippet()}
					<Eye size={ICON.lg} />
				{/snippet}
			</EmptyState>
		{:else}
			{#if looks.length > 0}
				<div class="flex flex-wrap items-center gap-2">
					<span class="text-xs text-muted">Most read on this page</span>
					{#each looks.slice(0, 6) as look (look.type)}
						<Badge tone="neutral">{look.type} {look.looks}</Badge>
					{/each}
				</div>
			{/if}

			<Table label="Unmasked reads">
				<thead>
					<tr>
						<th scope="col">Read</th>
						<th scope="col">Kind</th>
						<th scope="col">Record</th>
						<th scope="col">Role</th>
					</tr>
				</thead>
				<tbody>
					{#each data.entries as entry (entry.id)}
						<tr>
							<td data-cell="nowrap" class="text-xs text-faint"
								>{formatDateTime(entry.accessed_at)}</td
							>
							<td data-cell="nowrap">{entry.pii_type}</td>
							<td data-cell="nowrap" class="font-mono text-xs"
								>{entry.record_type ?? NO_VALUE}</td
							>
							<td data-cell="nowrap" class="text-xs">{entry.viewer_role ?? NO_VALUE}</td>
						</tr>
					{/each}
				</tbody>
			</Table>
			<Pagination
				page={pageNumber(data.offset, data.limit)}
				perPage={data.limit}
				count={data.entries.length}
				total={data.total}
				noun="reads"
				href={pageHref('/admin/settings/pii/reads', data.limit, data.q ? { q: data.q } : {})}
			/>
		{/if}
	{/if}
</PageShell>
