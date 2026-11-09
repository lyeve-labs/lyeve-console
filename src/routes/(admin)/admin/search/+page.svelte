<script lang="ts">
	import { Badge, Button, Card, EmptyState, PageShell, Pagination, SearchInput, SectionHeading, Stat } from '@lyeve-labs/ui-kit';
	import type { PageData } from './$types';
	import { Search } from '@lucide/svelte';
	import ListToolbar from '$lib/components/ListToolbar.svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import SearchTabs from '$lib/components/SearchTabs.svelte';
	import { ICON } from '$lib/icon';
	import { pageHref, pageNumber } from '$lib/api/list';
	import { formatCount, formatPercent, plural } from '$lib/format';
	import { snippetParts } from '$lib/highlight';

	let { data }: { data: PageData } = $props();

	const resultsPage = $derived(pageHref('/admin/search', data.limit, { q: data.q }));

	// Seed the input with the active query so it survives navigation.
	// svelte-ignore state_referenced_locally
	let query = $state(data.q);
</script>

<PageShell
	title="Search"
	description="Search content entries and see what readers search for."
	width="wide"
>
	<SearchTabs active="search" />

	<!-- A native GET form re-runs the server load with ?q=, so a result page
	     has a URL that can be shared and reloaded. -->
	<form method="GET">
		<ListToolbar label="Search content">
			{#snippet search()}
				<div class="flex items-center gap-2">
					<label for="content-search" class="sr-only">Search content</label>
					<SearchInput id="content-search" name="q" bind:value={query} placeholder="Search content" class="min-w-0 flex-1" />
					<Button type="submit" variant="secondary">Search</Button>
				</div>
			{/snippet}
		</ListToolbar>
	</form>

	<div class="grid grid-cols-1 gap-6 lg:grid-cols-3">
		<div class="lg:col-span-2">
			{#if data.results === null}
				<EmptyState
					level={2}
					title="Search the content library"
					description="Enter a query above to search."
				>
					{#snippet iconSnippet()}<Search size={ICON.lg} />{/snippet}
				</EmptyState>
			{:else if !data.results.ok}
				<GateNotice level={2} gate={data.results.gate} title="Search" absent="Content search is not included in this build." />
			{:else if data.results.value.results.length === 0}
				<EmptyState
					level={2}
					title={`No results for "${data.q}".`}
					description="Try a broader term, or check the spelling."
				/>
			{:else}
				{@const hits = data.results.value.results}
				{@const total = data.results.value.total}
				<div class="space-y-3">
					<SectionHeading level={2}>
						{formatCount(total)} {plural(total, 'result')} for "{data.q}"
					</SectionHeading>
					<ul class="space-y-3">
						{#each hits as hit (hit.entry_id)}
							<li>
								<Card pad="sm">
									<div class="flex items-start justify-between gap-3">
										<SectionHeading level={3}>
											{hit.title || hit.slug || '(untitled)'}
										</SectionHeading>
										<span class="shrink-0 text-xs text-faint tabular-nums">
											rank {hit.rank.toFixed(3)}
										</span>
									</div>
									<div class="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted">
										<Badge>{hit.schema}</Badge>
										<Badge>{hit.status}</Badge>
										{#if hit.slug}<span class="text-faint">/{hit.slug}</span>{/if}
									</div>
									{#if hit.snippets}
										{#each Object.entries(hit.snippets) as [field, snippet] (field)}
											<p class="mt-2 text-xs text-muted">
												<span class="text-faint">{field}</span>
												{#each snippetParts(snippet) as part, i (i)}
													{#if part.mark}<mark class="rounded-sm bg-warn/15 text-fg">{part.text}</mark>{:else}{part.text}{/if}
												{/each}
											</p>
										{/each}
									{/if}
									{#if hit.tags && hit.tags.length}
										<div class="mt-2 flex flex-wrap gap-1">
											{#each hit.tags as tag}
												<Badge size="sm">{tag}</Badge>
											{/each}
										</div>
									{/if}
								</Card>
							</li>
						{/each}
					</ul>
					<Pagination page={pageNumber(data.offset, data.limit)} {total} perPage={data.limit} href={resultsPage} />
				</div>
			{/if}
		</div>

		<aside class="space-y-6">
			<Card pad="sm">
				{#snippet header()}
					<SectionHeading level={2}>Last 30 days</SectionHeading>
				{/snippet}
				{#if !data.analytics.ok}
					<GateNotice gate={data.analytics.gate} title="Search analytics" absent="Search analytics are not included in this build." />
				{:else}
					{@const analytics = data.analytics.value}
					<div class="grid grid-cols-2 gap-3">
						<Stat size="sm" mono label="Searches" value={analytics.total_searches} />
						<Stat size="sm" mono label="No results" value={formatPercent(analytics.zero_result_pct / 100)} />
					</div>
					{#if analytics.top_queries.length > 0}
						<ul class="mt-3 space-y-1 text-xs">
							{#each analytics.top_queries.slice(0, 10) as tq (tq.query_text)}
								<li class="flex justify-between gap-2 text-muted">
									<span class="truncate">{tq.query_text}</span>
									<span class="tabular-nums text-faint">{tq.count}</span>
								</li>
							{/each}
						</ul>
					{/if}
				{/if}
			</Card>
		</aside>
	</div>
</PageShell>
