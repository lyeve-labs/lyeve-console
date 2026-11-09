<script lang="ts">
	import { Alert, Badge, Card, EmptyState, PageShell, SectionHeading, SegmentedControl, Stat, Table, type StatusTone } from '@lyeve-labs/ui-kit';
	import RefreshButton from '$lib/components/RefreshButton.svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import { Database, Gauge, AlertTriangle, CheckCircle } from '@lucide/svelte';
	import ListToolbar from '$lib/components/ListToolbar.svelte';
	import { LATENCY_TOP_CHOICES } from '$lib/api/observability';
	import { formatMillis, NO_VALUE } from '$lib/format';
	import ObservabilityTabs from '$lib/components/ObservabilityTabs.svelte';
	import type { PageData } from './$types';
	import { ICON } from '$lib/icon';

	let { data }: { data: PageData } = $props();

	// Each depth is a link, so the ranking a person is looking at is an
	// address and the choice works before the page hydrates.
	const topOptions = LATENCY_TOP_CHOICES.map((c) => ({
		value: String(c),
		label: `Top ${c}`,
		href: `/admin/observability?top=${c}`,
	}));

	function latencyVariant(us: number): StatusTone {
		if (us >= 1_000_000) return 'danger';
		if (us >= 100_000) return 'warn';
		if (us <= 10_000) return 'success';
		return 'neutral';
	}

	// The engine measures its pool on every read and sends the counts at the top
	// level of its answer. An engine with no pool health provider wired sends
	// none, so their absence is a deployment fact rather than a measurement.
	const pool = $derived(data.poolHealth.ok ? data.poolHealth.value : null);
	const measured = $derived(typeof pool?.open_connections === 'number');
</script>


<PageShell
	title="Observability"
	description="Check connection pool health and endpoint latency."
	width="wide"
>
	{#snippet actions()}
		<!-- One refresh for the page: both panels read through the load, so one
		     invalidation refreshes them together. -->
		<RefreshButton />
	{/snippet}

	<ObservabilityTabs active="overview" />

	<!-- The pool's state is a badge on its card, not a banner over the page:
	     an engine with no pool health provider answers this way every time, and a warning
	     that greets every visit stops being read. The figures are one row. -->
	<Card>
		{#snippet header()}
			<div class="flex flex-wrap items-center gap-2">
				<SectionHeading level={2}>Connection pool</SectionHeading>
				{#if pool?.engine}
					{#if !pool.healthy}
						<Badge tone="danger" class="shrink-0 whitespace-nowrap"><AlertTriangle size={ICON.xs} /> Unhealthy</Badge>
					{:else if measured}
						<Badge tone="success" class="shrink-0 whitespace-nowrap"><CheckCircle size={ICON.xs} /> Healthy</Badge>
					{/if}
				{/if}
			</div>
		{/snippet}

		{#if !data.poolHealth.ok}
			<GateNotice
				gate={data.poolHealth.gate}
				title="the pool health"
				absent="Pool health is not included in this build."
			/>
		{:else if pool?.engine}
			<div class="grid grid-cols-2 gap-4 sm:grid-cols-4 xl:grid-cols-7" data-testid="pool-stats">
				<Stat size="sm" label="Engine" value={pool.engine} />
				<Stat
					size="sm"
					label="Ping latency"
					mono
					value={formatMillis(pool.latency_ms)}
				/>
				<Stat size="sm" label="Goroutines" mono value={data.goroutines ?? NO_VALUE} />
				{#if measured}
					<Stat size="sm" label="Open" mono value={pool.open_connections ?? NO_VALUE} />
					<Stat size="sm" label="In use" mono value={pool.in_use ?? NO_VALUE} />
					<Stat size="sm" label="Idle" mono value={pool.idle ?? NO_VALUE} />
					<Stat size="sm" label="Wait count" mono value={pool.wait_count ?? NO_VALUE} />
				{/if}
			</div>
			{#if pool.errors && pool.errors.length > 0}
				<div class="mt-3">
					<Alert tone="danger" title="Pool errors">
						<ul class="flex flex-col gap-1">
							{#each pool.errors as err (err)}
								<li>{err}</li>
							{/each}
						</ul>
					</Alert>
				</div>
			{/if}
		{:else}
			<EmptyState title="No pool statistics">
				{#snippet iconSnippet()}
					<Database size={ICON.lg} />
				{/snippet}
			</EmptyState>
		{/if}
	</Card>

	<section class="flex flex-col gap-4">
		<div class="flex items-center gap-2">
			<SectionHeading level={2}>Latency rankings</SectionHeading>
		</div>

		<ListToolbar label="Latency rankings">
			{#snippet search()}
				{#if data.latency.ok}
					<span class="text-xs text-muted">{data.latency.value.total} endpoints tracked</span>
				{/if}
			{/snippet}
			{#snippet filters()}
				<!-- A depth is a page address. It replaces the entry in the history
				     and keeps the reader where they were on the page. -->
				<div id="latency-top" data-sveltekit-noscroll data-sveltekit-replacestate>
					<SegmentedControl label="Rows" labelHidden size="sm" options={topOptions} value={String(data.top)} />
				</div>
			{/snippet}
		</ListToolbar>

		{#if !data.latency.ok}
			<GateNotice
				gate={data.latency.gate}
				title="the latency rankings"
				absent="Latency rankings are not included in this build."
			/>
		{:else if data.latency.value.slowest.length === 0}
			<EmptyState title="No latency data yet" description="Endpoints appear here after they serve requests.">
				{#snippet iconSnippet()}
					<Gauge size={ICON.lg} />
				{/snippet}
			</EmptyState>
		{:else}
			<Table label="Latency rankings">
				<thead>
					<tr>
						<th scope="col" class="w-8">#</th>
						<th scope="col">Method</th>
						<th scope="col">Path</th>
						<th scope="col" class="text-right">Count</th>
						<th scope="col" class="text-right">Min</th>
						<th scope="col" class="text-right">Avg</th>
						<th scope="col" class="text-right">P50</th>
						<th scope="col" class="text-right">P95</th>
						<th scope="col" class="text-right">P99</th>
						<th scope="col" class="text-right">Max</th>
					</tr>
				</thead>
				<tbody>
					{#each data.latency.value.slowest as entry, i (`${entry.method} ${entry.path}`)}
						<tr>
							<td data-cell="nowrap"><span class="text-faint">{i + 1}</span></td>
							<td><Badge tone="neutral">{entry.method}</Badge></td>
							<td data-cell="nowrap" class="font-mono text-xs">{entry.path}</td>
							<td data-cell="nowrap" class="text-right text-xs"><span class="text-faint">{entry.count}</span></td>
							<td data-cell="nowrap" class="text-right font-mono text-xs">{formatMillis(entry.min_us / 1000)}</td>
							<td data-cell="nowrap" class="text-right font-mono text-xs">{formatMillis(entry.avg_us / 1000)}</td>
							<td data-cell="nowrap" class="text-right font-mono text-xs">{formatMillis(entry.p50_us / 1000)}</td>
							<td class="text-right">
								<Badge tone={latencyVariant(entry.p95_us)}>{formatMillis(entry.p95_us / 1000)}</Badge>
							</td>
							<td data-cell="nowrap" class="text-right font-mono text-xs">{formatMillis(entry.p99_us / 1000)}</td>
							<td data-cell="nowrap" class="text-right font-mono text-xs">{formatMillis(entry.max_us / 1000)}</td>
						</tr>
					{/each}
				</tbody>
			</Table>
		{/if}
	</section>
</PageShell>
