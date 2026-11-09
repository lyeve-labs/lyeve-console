<script lang="ts">
	import { Badge, EmptyState, PageShell, Pagination, SearchInput, Stat, Table } from '@lyeve-labs/ui-kit';
	import RefreshButton from '$lib/components/RefreshButton.svelte';
	import { Eye, Search } from '@lucide/svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import ListToolbar from '$lib/components/ListToolbar.svelte';
	import PiiTabs from '$lib/components/PiiTabs.svelte';
	import { byType } from '$lib/api/pii-mask';
	import { NO_VALUE, formatDateTime } from '$lib/format';
	import type { PageData } from './$types';
	import { ICON } from '$lib/icon';
	import { pageHref, pageNumber } from '$lib/api/list';

	let { data }: { data: PageData } = $props();

	let narrow = $state('');

	const looks = $derived(byType(data.entries));
	const visible = $derived(
		narrow.trim()
			? data.entries.filter((e) =>
					`${e.pii_type} ${e.record_type ?? ''} ${e.viewer_role ?? ''}`
						.toLowerCase()
						.includes(narrow.trim().toLowerCase()),
				)
			: data.entries,
	);
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
			<Stat size="sm" mono label="Unmasked reads" value={data.total} />
		</div>

		{#if data.entries.length === 0}
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

			<ListToolbar label="Filter unmasked reads">
				{#snippet search()}
					<label for="pii-narrow" class="sr-only">Search this page</label>
					<SearchInput
						id="pii-narrow"
						bind:value={narrow}
						placeholder="Kind, record or role on this page"
					/>
				{/snippet}
			</ListToolbar>

			{#if visible.length === 0}
				<EmptyState
					title="No unmasked reads match this search"
					description="The search covers this page only. Clear it to see every read on this page."
				>
					{#snippet iconSnippet()}
						<Search size={ICON.lg} />
					{/snippet}
				</EmptyState>
			{:else}
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
						{#each visible as entry (entry.id)}
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
			{/if}
			<Pagination
				page={pageNumber(data.offset, data.limit)}
				perPage={data.limit}
				count={data.entries.length}
				total={data.total}
				noun="reads"
				href={pageHref('/admin/settings/pii/reads', data.limit)}
			/>
		{/if}
	{/if}
</PageShell>
