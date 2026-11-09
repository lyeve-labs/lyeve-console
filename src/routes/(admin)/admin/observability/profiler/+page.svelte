<script lang="ts">
	import {
		Alert,
		Badge,
		Button,
		Card,
		EmptyState,
		PageShell,
		SectionHeading,
		Table,
		confirm as confirmDialog,
	} from '@lyeve-labs/ui-kit';
	import RefreshButton from '$lib/components/RefreshButton.svelte';
	import { enhance } from '$app/forms';
	import { CONFIRM_FIELD, CONFIRMED } from '$lib/confirmation';
	import { Gauge, Puzzle, RotateCcw } from '@lucide/svelte';
	import { formatNs, latencyTone, type EndpointStats } from '$lib/api/profiler';
	import { NO_VALUE, formatBytes, formatTime } from '$lib/format';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import ProfilerTabs from '$lib/components/ProfilerTabs.svelte';
	import type { ActionData, PageData } from './$types';
	import { ICON } from '$lib/icon';
	import { httpStatusTone } from '$lib/tones';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let resetting = $state(false);

	const ABSENT = 'The profiler is not included in this build.';
	const detail = $derived(data.detail?.ok ? data.detail.value : null);

	function detailHref(endpoint: string): string {
		return `/admin/observability/profiler?endpoint=${encodeURIComponent(endpoint.replace(/^\/+/, ''))}`;
	}
</script>

{#snippet noEndpoints()}
	<Gauge size={ICON.lg} />
{/snippet}

{#snippet noPlugins()}
	<Puzzle size={ICON.lg} />
{/snippet}

{#snippet endpointRows(rows: EndpointStats[], label: string)}
	<Table {label}>
		<thead>
			<tr>
				<th scope="col">Method</th>
				<th scope="col">Path</th>
				<th scope="col" class="text-right">Count</th>
				<th scope="col" class="text-right">Avg</th>
				<th scope="col" class="text-right">P50</th>
				<th scope="col" class="text-right">P95</th>
				<th scope="col" class="text-right">P99</th>
				<th scope="col" class="text-right">Max</th>
				<th scope="col" class="text-right">Avg alloc</th>
			</tr>
		</thead>
		<tbody>
			{#each rows as row (`${row.method} ${row.endpoint}`)}
				<tr>
					<td><Badge tone="neutral">{row.method}</Badge></td>
					<td data-cell="nowrap" class="font-mono text-xs">
						<a href={detailHref(row.endpoint)} class="relative hit-area text-fg underline-offset-2 transition-colors hover:text-brand hover:underline">{row.endpoint}</a>
					</td>
					<td data-cell="nowrap" class="text-right text-xs"><span class="text-faint">{row.count}</span></td>
					<td data-cell="nowrap" class="text-right font-mono text-xs">{formatNs(row.avg_duration_ns)}</td>
					<td data-cell="nowrap" class="text-right font-mono text-xs">{formatNs(row.p50_duration_ns)}</td>
					<td class="text-right"><Badge tone={latencyTone(row.p95_duration_ns)}>{formatNs(row.p95_duration_ns)}</Badge></td>
					<td data-cell="nowrap" class="text-right font-mono text-xs">{formatNs(row.p99_duration_ns)}</td>
					<td data-cell="nowrap" class="text-right font-mono text-xs">{formatNs(row.max_duration_ns)}</td>
					<td data-cell="nowrap" class="text-right font-mono text-xs">{formatBytes(row.avg_alloc_bytes)}</td>
				</tr>
			{/each}
		</tbody>
	</Table>
{/snippet}

<PageShell
	title="Profiler"
	description="See request timings by endpoint and by plugin."
	width="wide"
	back={{ href: '/admin/observability', label: 'Observability' }}
>
	{#snippet actions()}
		<RefreshButton />
		<form
			method="POST"
			action="?/reset"
			use:enhance={async ({ cancel, formData }) => {
				const confirmed = await confirmDialog(
					'Reset the profiler?',
					'Sampled requests and memory snapshots are deleted, and a new snapshot is taken. This cannot be undone.',
					{ confirmLabel: 'Reset' },
				);
				if (!confirmed) {
					cancel();
					return;
				}
				formData.set(CONFIRM_FIELD, CONFIRMED);
				resetting = true;
				return async ({ update }) => {
					resetting = false;
					await update({ reset: false });
				};
			}}
		>
			<Button type="submit" variant="secondary" size="sm" loading={resetting}>
				<RotateCcw size={ICON.sm} /> Reset
			</Button>
		</form>
	{/snippet}

	<ProfilerTabs active="timings" />

	{#if form?.form === 'reset'}
		{#if 'error' in form && form.error}
			<Alert tone="danger">{form.error}</Alert>
		{:else}
			<Alert tone="success" autoDismiss>Profiler reset.</Alert>
		{/if}
	{/if}

	<section class="flex flex-col gap-4" data-testid="profiler-slowest">
		<div class="flex flex-wrap items-center gap-2">
			<SectionHeading level={2}>Slowest endpoints</SectionHeading>
			<span class="text-xs text-faint">
				The 20 slowest, by p95.{#if data.endpoints.ok}
					{data.endpoints.value.length} endpoints sampled.{/if}
			</span>
		</div>
		{#if !data.slowest.ok}
			<GateNotice gate={data.slowest.gate} title="the endpoint statistics" absent={ABSENT} />
		{:else if data.slowest.value.length === 0}
			<EmptyState iconSnippet={noEndpoints} title="No samples yet" description="Endpoints appear here after they serve requests." />
		{:else}
			{@render endpointRows(data.slowest.value, 'Slowest endpoints')}
		{/if}
	</section>

	{#if data.selected}
		<section class="flex flex-col gap-4" data-testid="profiler-detail">
			<div class="flex flex-wrap items-center gap-2">
				<SectionHeading level={2}><span class="font-mono">{data.selected}</span></SectionHeading>
				{#if detail}
					<span class="text-xs text-faint">{detail.total_count} samples recorded</span>
				{/if}
				<a href="/admin/observability/profiler" class="relative hit-area ms-auto text-xs text-muted underline-offset-2 transition-colors hover:text-fg hover:underline">Clear selection</a>
			</div>
			{#if data.detail && !data.detail.ok}
				<GateNotice gate={data.detail.gate} title="this endpoint" absent={ABSENT} />
			{:else if !detail || !detail.methods?.length}
				<EmptyState iconSnippet={noEndpoints} title="No data for this endpoint" description="No requests were sampled for this endpoint." />
			{:else}
				{@render endpointRows(detail.methods.map((m) => m.stats), `Methods for ${data.selected}`)}
				{#each detail.methods as method (method.method)}
					<Card>
						{#snippet header()}
							<div class="flex flex-wrap items-center gap-2">
								<SectionHeading level={3}>Recent {method.method} requests</SectionHeading>
								<span class="ms-auto text-xs text-faint">{method.recent_entries.length} of {method.count}</span>
							</div>
						{/snippet}
						<Table label="Recent {method.method} requests">
							<thead>
								<tr>
									<th scope="col">Captured</th>
									<th scope="col" class="text-right">Status</th>
									<th scope="col" class="text-right">Duration</th>
									<th scope="col" class="text-right">Alloc</th>
									<th scope="col" class="text-right">Goroutines</th>
									<th scope="col">Plugin</th>
								</tr>
							</thead>
							<tbody>
								{#each method.recent_entries as e, i (i)}
									<tr>
										<td data-cell="nowrap" class="font-mono text-xs"><span class="text-faint">{formatTime(e.captured_at, e.captured_at)}</span></td>
										<td class="text-right"><Badge tone={httpStatusTone(e.status_code)}>{e.status_code}</Badge></td>
										<td data-cell="nowrap" class="text-right font-mono text-xs">{formatNs(e.duration_ns)}</td>
										<td data-cell="nowrap" class="text-right font-mono text-xs">{formatBytes(e.alloc_bytes)}</td>
										<td data-cell="nowrap" class="text-right font-mono text-xs">{e.num_goroutine}</td>
										<td data-cell="nowrap" class="text-xs">{e.plugin || NO_VALUE}</td>
									</tr>
								{/each}
							</tbody>
						</Table>
					</Card>
				{/each}
			{/if}
		</section>
	{/if}

	<section class="flex flex-col gap-4" data-testid="profiler-plugins">
		<div class="flex flex-wrap items-center gap-2">
			<SectionHeading level={2}>By plugin</SectionHeading>
		</div>
		{#if !data.plugins.ok}
			<GateNotice gate={data.plugins.gate} title="the plugin breakdown" absent={ABSENT} />
		{:else if data.plugins.value.length === 0}
			<EmptyState iconSnippet={noPlugins} title="No samples yet" description="Plugins appear here after they serve a request." />
		{:else}
			<Table label="By plugin">
				<thead>
					<tr>
						<th scope="col">Plugin</th>
						<th scope="col" class="text-right">Count</th>
						<th scope="col" class="text-right">Avg</th>
						<th scope="col" class="text-right">Max</th>
						<th scope="col" class="text-right">Allocated</th>
					</tr>
				</thead>
				<tbody>
					{#each data.plugins.value as p (p.plugin)}
						<tr>
							<td data-cell="nowrap" class="font-mono text-xs">{p.plugin}</td>
							<td data-cell="nowrap" class="text-right text-xs"><span class="text-faint">{p.count}</span></td>
							<td data-cell="nowrap" class="text-right font-mono text-xs">{formatNs(p.avg_duration_ns)}</td>
							<td data-cell="nowrap" class="text-right font-mono text-xs">{formatNs(p.max_duration_ns)}</td>
							<td data-cell="nowrap" class="text-right font-mono text-xs">{formatBytes(p.total_alloc_bytes)}</td>
						</tr>
					{/each}
				</tbody>
			</Table>
		{/if}
	</section>

</PageShell>
