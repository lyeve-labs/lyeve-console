<script lang="ts">
	import GateNotice from '$lib/components/GateNotice.svelte';
	import {
		Badge,
		Card,
		EmptyState,
		PageShell,
		Progress,
		SectionHeading,
		Stat,
		Table,
		type StatusTone,
	} from '@lyeve-labs/ui-kit';
	import { TrendingUp, Gauge, Globe, Server } from '@lucide/svelte';
	import { NO_VALUE, formatBytes, formatCount, formatDateTime, formatMillis, formatPercent } from '$lib/format';
	import type { PageData } from './$types';
	import type { BreakdownItem, Summary } from '@lyeve-labs/client-rest';
	import { ICON } from '$lib/icon';

	let { data }: { data: PageData } = $props();

	// The engine encodes an empty result as a null array, not []. Dereferenced
	// directly, an instance with no anomalies, the normal state, would fail the
	// whole page on a read of null.length. A failed read draws its gate instead,
	// so the empty lists below stand only for parts the page does not draw.
	const endpoints = $derived(data.endpoints.ok ? (data.endpoints.value.items ?? []) : []);
	const methods = $derived(data.methods.ok ? (data.methods.value.items ?? []) : []);
	const agents = $derived(data.agents.ok ? (data.agents.value.items ?? []) : []);
	const anomalies = $derived(data.anomalies.ok ? (data.anomalies.value.anomalies ?? []) : []);

	const ABSENT = 'API analytics is not included in this build.';

	// A missing plugin, a license that does not include it or a role that may
	// not read it refuses every read on the page alike. One notice says so,
	// rather than the same sentence under every heading.
	const whole = $derived(
		!data.summary.ok && ['absent', 'locked', 'forbidden'].includes(data.summary.gate.state)
			? data.summary.gate
			: null
	);

	// Every request the methods account for, which scales the bar rows. Each
	// bar then states its method's share of all requests. Scaled to the
	// busiest method instead, that method always read 100%.
	const methodTotal = $derived(
		methods.reduce((sum: number, it: BreakdownItem) => sum + it.request_count, 0)
	);

	function errorRateVariant(rate: number): StatusTone {
		if (rate >= 0.05) return 'danger';
		if (rate >= 0.01) return 'warn';
		return 'success';
	}

	/*
	 * Two rates, because a 4xx and a 5xx say different things about different
	 * parties. A few server errors beside thousands of client errors is a
	 * healthy engine and a caller retrying a bad token. Merged into one figure,
	 * it looks like an outage and sends somebody to read engine logs that have
	 * nothing in them.
	 *
	 * The server rate is the health number and keeps the band and the tone. The
	 * client rate is an integration number, so it is stated plainly and points
	 * at the endpoints driving it.
	 */
	function serverErrorRate(summary: Summary): number {
		return summary.total_requests > 0 ? summary.total_5xx / summary.total_requests : 0;
	}
	function clientErrorRate(summary: Summary): number {
		return summary.total_requests > 0 ? summary.total_4xx / summary.total_requests : 0;
	}

	// Stat carries no danger or warn accent, so the summary tile states the band
	// in words. The color signal stays on the per-endpoint badges, which are the
	// rows a reader acts on.
	function errorRateBand(rate: number): string {
		if (rate >= 0.05) return 'critical';
		if (rate >= 0.01) return 'elevated';
		return 'within threshold';
	}

	// A server error is ours and a much smaller number means much more. One in a
	// thousand is worth a look, and the combined band would have called it fine.
	function serverErrorBand(rate: number): string {
		if (rate >= 0.01) return 'critical';
		if (rate >= 0.001) return 'elevated';
		return 'within threshold';
	}

	// The endpoints a reader should open first, by how much of the total error
	// volume each one carries rather than by its own rate: a 100% rate over
	// three requests is noise beside a 20% rate over nine hundred.
	const worstEndpoints = $derived(
		[...endpoints]
			.filter((e) => e.error_rate > 0)
			.sort((a, b) => b.error_rate * b.request_count - a.error_rate * a.request_count)
			.slice(0, 3)
	);

	function severityVariant(sev: string): StatusTone {
		switch (sev) {
			case 'high': return 'danger';
			case 'medium': return 'warn';
			case 'low': return 'brand';
			default: return 'neutral';
		}
	}
</script>

{#snippet noEndpoints()}
	<Server size={ICON.lg} />
{/snippet}

{#snippet noAgents()}
	<Globe size={ICON.lg} />
{/snippet}

{#snippet noAnomalies()}
	<TrendingUp size={ICON.lg} />
{/snippet}

{#snippet noMethods()}
	<Gauge size={ICON.lg} />
{/snippet}

<PageShell
	title="API analytics"
	description="See request volume, latency and error rate for the Content API and the Admin API over the last 24 hours."
	width="wide"
>
	{#if whole}
		<GateNotice level={2} gate={whole} title="API analytics" absent={ABSENT} />
	{:else}
		{#if data.summary.ok}
			{@const summary = data.summary.value}
			<div class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
				<Stat size="sm" mono label="Total requests" value={formatCount(summary.total_requests)} />
				<Stat
					size="sm"
					mono
					label="Server errors"
					value={formatPercent(serverErrorRate(summary))}
					sub={serverErrorBand(serverErrorRate(summary))}
					accent={serverErrorRate(summary) >= 0.001 ? 'neutral' : 'success'}
				/>
				<Stat size="sm" mono label="Client errors" value={formatPercent(clientErrorRate(summary))} sub="caused by callers" />
				<Stat size="sm" mono label="P50 latency" value={formatMillis(summary.avg_latency_p50_ms)} />
				<Stat size="sm" mono label="P95 latency" value={formatMillis(summary.avg_latency_p95_ms)} />
				<Stat size="sm" mono label="P99 latency" value={formatMillis(summary.avg_latency_p99_ms)} />
			</div>

			<!-- 2xx, 4xx and 5xx sum to the total, so three tiles would restate a
			     fourth. One bar says the same thing and says the proportion too,
			     which is the only part a reader would do arithmetic for. -->
			<Card>
				<div class="flex flex-col gap-3">
					<div class="flex flex-wrap items-baseline justify-between gap-2">
						<SectionHeading level={2}>Responses</SectionHeading>
						<span class="text-xs text-muted">
							{formatCount(summary.unique_endpoints)} endpoints served, max P99 {formatMillis(summary.max_latency_p99_ms)}
						</span>
					</div>
					{#if summary.total_requests > 0}
						<div
							class="flex h-2.5 w-full overflow-hidden rounded-full bg-surface-2"
							role="img"
							aria-label={`${formatCount(summary.total_2xx)} successful, ${formatCount(summary.total_4xx)} client errors, ${formatCount(summary.total_5xx)} server errors`}
						>
							<div class="bg-success" style:width={`${(summary.total_2xx / summary.total_requests) * 100}%`}></div>
							<div class="bg-warn" style:width={`${(summary.total_4xx / summary.total_requests) * 100}%`}></div>
							<div class="bg-danger" style:width={`${(summary.total_5xx / summary.total_requests) * 100}%`}></div>
						</div>
					{/if}
					<div class="flex flex-wrap gap-x-6 gap-y-1 text-xs">
						<span class="flex items-center gap-1.5">
							<span class="h-2 w-2 rounded-full bg-success"></span>
							<span class="text-muted">2xx</span>
							<span class="font-mono text-fg">{formatCount(summary.total_2xx)}</span>
						</span>
						<span class="flex items-center gap-1.5">
							<span class="h-2 w-2 rounded-full bg-warn"></span>
							<span class="text-muted">4xx</span>
							<span class="font-mono text-fg">{formatCount(summary.total_4xx)}</span>
						</span>
						<span class="flex items-center gap-1.5">
							<span class="h-2 w-2 rounded-full bg-danger"></span>
							<span class="text-muted">5xx</span>
							<span class="font-mono text-fg">{formatCount(summary.total_5xx)}</span>
						</span>
					</div>
				</div>
			</Card>
		{:else}
			<GateNotice gate={data.summary.gate} title="API analytics" absent={ABSENT} />
		{/if}

		<!-- The rows worth opening, above the table rather than somewhere in it.
		     A route that errors on a fifth of its requests can sit mid-table with
		     nothing on the page pointing at it. -->
		{#if worstEndpoints.length > 0}
			<Card>
				<div class="flex flex-col gap-3">
					<SectionHeading level={2}>Where the errors are</SectionHeading>
					<ul class="flex flex-col gap-2">
						{#each worstEndpoints as e (e.key)}
							<li class="flex flex-wrap items-center justify-between gap-2 text-sm">
								<code class="min-w-0 truncate font-mono text-xs text-fg">{e.key}</code>
								<span class="flex shrink-0 items-center gap-3">
									<span class="text-xs text-muted">{formatCount(e.request_count)} requests</span>
									<Badge tone={errorRateVariant(e.error_rate)}>{formatPercent(e.error_rate)}</Badge>
								</span>
							</li>
						{/each}
					</ul>
				</div>
			</Card>
		{/if}

		<section class="flex flex-col gap-4">
			<div class="flex items-center gap-2">
				<SectionHeading level={2}>Top endpoints</SectionHeading>
				{#if data.endpoints.ok}
					<span class="text-xs text-muted">{data.endpoints.value.total} tracked</span>
				{/if}
			</div>

			{#if !data.endpoints.ok}
				<GateNotice gate={data.endpoints.gate} title="the endpoint breakdown" absent={ABSENT} />
			{:else if endpoints.length === 0}
				<EmptyState
					iconSnippet={noEndpoints}
					title="No endpoint data yet"
					description="Requests to the Content API and the Admin API appear here."
				/>
			{:else}
				<Table label="Top endpoints">
					<thead>
						<tr>
							<th scope="col" class="w-8">#</th>
							<th scope="col">Endpoint</th>
							<th scope="col" class="text-right">Requests</th>
							<th scope="col" class="text-right">Error rate</th>
							<th scope="col" class="text-right">P95</th>
							<th scope="col" class="text-right">Max P99</th>
							<th scope="col" class="text-right">Avg size</th>
						</tr>
					</thead>
					<tbody>
						{#each endpoints as item, i (item.key)}
							<tr>
								<td data-cell="nowrap"><span class="text-faint">{i + 1}</span></td>
								<td data-cell="nowrap" class="font-mono text-xs">{item.key}</td>
								<td data-cell="nowrap" class="text-right font-mono text-xs">{formatCount(item.request_count)}</td>
								<td class="text-right">
									<Badge tone={errorRateVariant(item.error_rate)}>{formatPercent(item.error_rate)}</Badge>
								</td>
								<td data-cell="nowrap" class="text-right font-mono text-xs">{formatMillis(item.avg_latency_p95_ms)}</td>
								<td data-cell="nowrap" class="text-right font-mono text-xs">{formatMillis(item.max_latency_p99_ms)}</td>
								<td data-cell="nowrap" class="text-right font-mono text-xs">
									<span class="text-faint">{formatBytes(item.request_size_avg_bytes, 'MB')}</span>
								</td>
							</tr>
						{/each}
					</tbody>
				</Table>
			{/if}
		</section>

		<div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
			<section class="flex flex-col gap-4">
				<div class="flex items-center gap-2">
					<SectionHeading level={2}>HTTP methods</SectionHeading>
				</div>

				{#if !data.methods.ok}
					<GateNotice gate={data.methods.gate} title="the method breakdown" absent={ABSENT} />
				{:else if methods.length === 0}
					<EmptyState
						iconSnippet={noMethods}
						title="No method data yet"
						description="Requests appear here grouped by HTTP method."
					/>
				{:else}
					<Card>
						<div class="flex flex-col gap-3">
							{#each methods as item (item.key)}
								<Progress
									label={`${item.key || NO_VALUE} (${formatCount(item.request_count)})`}
									value={item.request_count}
									max={methodTotal}
									showValue
								/>
							{/each}
						</div>
					</Card>
				{/if}
			</section>

			<section class="flex flex-col gap-4">
				<div class="flex items-center gap-2">
					<SectionHeading level={2}>Top user agents</SectionHeading>
				</div>

				{#if !data.agents.ok}
					<GateNotice gate={data.agents.gate} title="the user agent breakdown" absent={ABSENT} />
				{:else if agents.length === 0}
					<EmptyState
						iconSnippet={noAgents}
						title="No user agent data yet"
						description="Requests appear here grouped by user agent."
					/>
				{:else}
					<Table label="Top user agents">
						<thead>
							<tr>
								<th scope="col">User agent</th>
								<th scope="col" class="text-right">Requests</th>
								<th scope="col" class="text-right">Error rate</th>
							</tr>
						</thead>
						<tbody>
							{#each agents as item (item.key)}
								<tr>
									<td data-cell="nowrap" class="font-mono text-xs">{item.key || NO_VALUE}</td>
									<td data-cell="nowrap" class="text-right font-mono text-xs">{formatCount(item.request_count)}</td>
									<td class="text-right">
										<Badge tone={errorRateVariant(item.error_rate)}>{formatPercent(item.error_rate)}</Badge>
									</td>
								</tr>
							{/each}
						</tbody>
					</Table>
				{/if}
			</section>
		</div>

		<section class="flex flex-col gap-4">
			<div class="flex items-center gap-2">
				<SectionHeading level={2}>Anomalies</SectionHeading>
				{#if data.anomalies.ok && data.anomalies.value.window_hours > 0}
					<span class="text-xs text-muted">
						window {data.anomalies.value.window_hours}h, z threshold {data.anomalies.value.z_threshold}
					</span>
				{/if}
			</div>

			{#if !data.anomalies.ok}
				<GateNotice gate={data.anomalies.gate} title="the anomalies" absent={ABSENT} />
			{:else if anomalies.length === 0}
				<EmptyState
					iconSnippet={noAnomalies}
					title="No anomalies detected"
					description="Request volume, latency and error rate are all inside the expected range."
				/>
			{:else}
				<Table label="Anomalies">
					<thead>
						<tr>
							<th scope="col">Hour</th>
							<th scope="col">Metric</th>
							<th scope="col">Severity</th>
							<th scope="col" class="text-right">Actual</th>
							<th scope="col" class="text-right">Expected</th>
							<th scope="col" class="text-right">Z-score</th>
						</tr>
					</thead>
					<tbody>
						{#each anomalies as a, i (`${a.hour}-${a.metric_name}-${i}`)}
							<tr>
								<td class="whitespace-nowrap text-xs">{formatDateTime(a.hour)}</td>
								<td data-cell="nowrap" class="font-mono text-xs">{a.metric_name}</td>
								<td><Badge tone={severityVariant(a.severity)}>{a.severity}</Badge></td>
								<td data-cell="nowrap" class="text-right font-mono text-xs">{a.actual_value.toFixed(2)}</td>
								<td data-cell="nowrap" class="text-right font-mono text-xs">
									<span class="text-faint">{a.expected_avg.toFixed(2)}</span>
								</td>
								<td data-cell="nowrap" class="text-right font-mono text-xs">{a.z_score.toFixed(2)}</td>
							</tr>
						{/each}
					</tbody>
				</Table>
			{/if}
		</section>
	{/if}
</PageShell>
