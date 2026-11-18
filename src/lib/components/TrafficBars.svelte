<script lang="ts">
	/**
	 * Requests per hour across the dashboard's window, one bar per bucket.
	 *
	 * Drawn from flex columns rather than an SVG so the bar corners and the gap
	 * between bars stay in pixels at every width. An SVG stretched to the card
	 * stretches its radii with it. Each column is the hover target for its
	 * hour, so a quiet hour can still be asked what it held. The table beside
	 * the bars is the same series for a reader who cannot see them.
	 */
	import { formatCount, formatDateTime, formatPercent } from '#lib/format.ts';

	interface Hour {
		hour: string;
		requests: number;
		errorRate: number;
	}

	interface Props {
		hours: Hour[];
	}

	let { hours }: Props = $props();

	const peak = $derived(hours.reduce((m, h) => (h.requests > m ? h.requests : m), 0));
	const peakHour = $derived(hours.find((h) => h.requests === peak));
	const total = $derived(hours.reduce((n, h) => n + h.requests, 0));

	/** The bands the analytics page draws its own line at. */
	function fill(h: Hour): string {
		if (h.requests === 0) return 'bg-line';
		if (h.errorRate >= 0.05) return 'bg-danger';
		if (h.errorRate >= 0.01) return 'bg-warn';
		return 'bg-brand';
	}

	/** Height as a share of the tallest bar. A non-zero hour never rounds to nothing. */
	function height(h: Hour): number {
		if (peak === 0 || h.requests === 0) return 0;
		return Math.max(2, (h.requests / peak) * 100);
	}

	function describe(h: Hour): string {
		const failed = `${formatPercent(h.errorRate)} failed`;
		return `${formatDateTime(h.hour, h.hour)}: ${formatCount(h.requests)} requests, ${failed}`;
	}
</script>

<div class="flex flex-col gap-2">
	<div class="flex items-baseline justify-between gap-3 text-xs text-faint">
		<span>
			{formatCount(total)} requests{#if peakHour && peak > 0}, peak {formatCount(peak)} at {formatDateTime(peakHour.hour, peakHour.hour)}{/if}
		</span>
		<span class="flex items-center gap-3">
			<span class="flex items-center gap-1">
				<span class="inline-block h-2 w-2 rounded-xs bg-brand" aria-hidden="true"></span> under 1% failed
			</span>
			<span class="flex items-center gap-1">
				<span class="inline-block h-2 w-2 rounded-xs bg-warn" aria-hidden="true"></span> 1% to 5%
			</span>
			<span class="flex items-center gap-1">
				<span class="inline-block h-2 w-2 rounded-xs bg-danger" aria-hidden="true"></span> over 5%
			</span>
		</span>
	</div>

	<div class="flex h-32 items-end gap-px border-b border-line" aria-hidden="true">
		{#each hours as h (h.hour)}
			<div class="flex h-full flex-1 items-end" title={describe(h)}>
				<div
					class="w-full rounded-t-xs transition-[height] duration-progress {fill(h)}"
					style="height: {height(h)}%"
					data-requests={h.requests}
				></div>
			</div>
		{/each}
	</div>

	{#if hours.length > 0}
		<!-- Every window here crosses midnight, so each end of the axis carries
		     its date, and an hour without one would read the same at both. -->
		{@const first = hours[0].hour}
		{@const last = hours[hours.length - 1].hour}
		<div class="flex justify-between text-xs tabular-nums text-faint" aria-hidden="true">
			<span>{formatDateTime(first, first)}</span>
			<span>{formatDateTime(last, last)}</span>
		</div>
	{/if}

	<!-- A table ignores the 1px box sr-only gives it and grows to its rows, so
	     the wrapper is what stays out of the layout. -->
	<div class="sr-only">
		<table>
			<caption>Requests per hour</caption>
			<thead>
				<tr><th scope="col">Hour</th><th scope="col">Requests</th><th scope="col">Failed</th></tr>
			</thead>
			<tbody>
				{#each hours as h (h.hour)}
					<tr>
						<td>{formatDateTime(h.hour, h.hour)}</td>
						<td>{h.requests}</td>
						<td>{formatPercent(h.errorRate)}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>
