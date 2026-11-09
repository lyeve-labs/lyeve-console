<script lang="ts">
	import {
		Badge,
		Button,
		Card,
		EmptyState,
		PageShell,
		SearchInput,
		SectionHeading,
		Select,
		Table,
	} from '@lyeve-labs/ui-kit';
	import RefreshButton from '$lib/components/RefreshButton.svelte';
	import { Activity } from '@lucide/svelte';
	import ListToolbar from '$lib/components/ListToolbar.svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import TelemetryTabs from '$lib/components/TelemetryTabs.svelte';
	import { familiesMatching, formatMetricValue, labelText } from '$lib/api/telemetry';
	import { PLUGIN } from '$lib/plugin-names';
	import { rowFor } from '$lib/plugin-rows';
	import type { PageData } from './$types';
	import { ICON } from '$lib/icon';

	let { data }: { data: PageData } = $props();

	// The plugin says whether it is beta, in the manifest the shell's status
	// report carries.
	const beta = $derived(rowFor(data.pluginStatus, PLUGIN.telemetry)?.beta === true);

	// The registry is filtered here, in the browser, because it is one read:
	// a super admin's whole registry is a few hundred families, and a tenant
	// admin's a handful, neither of which needs a round trip per keystroke.
	let query = $state('');
	let typeFilter = $state('all');

	const TYPE_OPTIONS = [
		{ value: 'all', label: 'Every type' },
		{ value: 'counter', label: 'Counters' },
		{ value: 'gauge', label: 'Gauges' },
		{ value: 'histogram', label: 'Histograms' },
		{ value: 'summary', label: 'Summaries' },
	];

	const families = $derived(data.families.ok ? data.families.value : []);
	const shown = $derived(
		familiesMatching(families, query).filter((f) => typeFilter === 'all' || f.type === typeFilter),
	);
	const sampleCount = $derived(families.reduce((n, f) => n + f.samples.length, 0));

	// A family's samples past this many are folded: a histogram with twelve
	// buckets per tenant is a wall, and the search is how a row is found.
	const SAMPLES_SHOWN = 12;
	let expanded = $state<Record<string, boolean>>({});

	/**
	 * The row's name: a histogram's or summary's component series under its
	 * suffix, then the labels as the format writes them. A bare family with
	 * no labels reads as its own name rather than as an empty cell.
	 */
	function seriesText(familyName: string, labels: Record<string, string>): string {
		const base = labels.__series ? `${familyName}_${labels.__series}` : '';
		const text = `${base}${labelText(labels)}`;
		return text || familyName;
	}
</script>

{#snippet noMetrics()}
	<Activity size={ICON.lg} />
{/snippet}

<PageShell
	title="Telemetry"
	description={data.superAdmin
		? 'Browse every metric the engine records.'
		: 'Browse the request metrics recorded for this tenant.'}
	width="wide"
	back={{ href: '/admin/observability', label: 'Observability' }}
>
	{#snippet actions()}
		<RefreshButton />
	{/snippet}

	<TelemetryTabs active="metrics" />

	<div class="flex flex-wrap items-center gap-2">
		{#if beta}
			<Badge tone="violet" size="sm">Beta</Badge>
		{/if}
		<span class="text-xs text-muted">
			Histograms use the engine's buckets. One exporter set serves the whole engine. The
			tenant label is the tenant slug.
		</span>
	</div>

	<section class="flex flex-col gap-4" data-testid="telemetry-metrics">
		<div class="flex flex-wrap items-center gap-2">
			<SectionHeading level={2}>Metrics</SectionHeading>
			<span class="text-xs text-faint">
				{#if data.superAdmin}
					Includes the process, the pool, every tenant's request series and the plugin's own metrics.
				{:else}
					Only series with your tenant label. Only a super admin can see engine-wide series.
				{/if}
			</span>
		</div>

		{#if data.families.ok}
			<ListToolbar label="Filter the metrics">
				{#snippet search()}
					<SearchInput label="Filter families" placeholder="Family, help text or label value" bind:value={query} />
				{/snippet}
				{#snippet filters()}
					<span class="text-xs text-muted">{shown.length} of {families.length} families, {sampleCount} samples</span>
					<label for="metric-type" class="sr-only">Type</label>
					<Select id="metric-type" options={TYPE_OPTIONS} value={typeFilter} onvaluechange={(v) => { typeFilter = v; }} class="w-40" />
				{/snippet}
			</ListToolbar>
		{/if}

		{#if !data.families.ok}
			<GateNotice
				gate={data.families.gate}
				title="Telemetry metrics"
				absent="Telemetry is not included in this build."
			/>
		{:else if families.length === 0}
			<EmptyState
				iconSnippet={noMetrics}
				title="No series yet"
				description={data.superAdmin
					? 'Series appear here after the engine serves a request.'
					: 'Series appear here after the first API request under your tenant.'}
			/>
		{:else if shown.length === 0}
			<EmptyState iconSnippet={noMetrics} title="No families match this filter" description="Clear the filter to see every family." />
		{:else}
			<div class="flex flex-col gap-3" data-testid="metric-families">
				{#each shown as family (family.name)}
					{@const open = expanded[family.name] === true}
					{@const rows = open ? family.samples : family.samples.slice(0, SAMPLES_SHOWN)}
					<Card>
						{#snippet header()}
							<div class="flex flex-wrap items-center gap-2">
								<SectionHeading level={3}><span class="font-mono text-sm [overflow-wrap:anywhere]">{family.name}</span></SectionHeading>
								<Badge tone="neutral">{family.type}</Badge>
								<span class="ms-auto text-xs text-faint">{family.samples.length} samples</span>
							</div>
						{/snippet}
						{#if family.help}
							<p class="mb-3 text-xs text-muted">{family.help}</p>
						{/if}
						{#if family.samples.length === 0}
							<p class="text-sm text-muted">No samples in this family.</p>
						{:else}
							<Table label={family.name}>
								<thead>
									<tr>
										<th scope="col">Series</th>
										<th scope="col" class="text-right">Value</th>
									</tr>
								</thead>
								<tbody>
									{#each rows as sample, i (i)}
										<tr>
											<td class="font-mono text-xs">{seriesText(family.name, sample.labels)}</td>
											<td data-cell="nowrap" class="text-right font-mono text-xs">{formatMetricValue(sample.value)}</td>
										</tr>
									{/each}
								</tbody>
							</Table>
							{#if family.samples.length > SAMPLES_SHOWN}
								<div class="mt-2">
									<Button variant="ghost" size="sm" onclick={() => { expanded = { ...expanded, [family.name]: !open }; }}>
										{open ? 'Show fewer' : `Show all ${family.samples.length}`}
									</Button>
								</div>
							{/if}
						{/if}
					</Card>
				{/each}
			</div>
		{/if}
	</section>
</PageShell>
