<script lang="ts">
	/**
	 * One schema's entries per day, as a row of thin bars under its count.
	 *
	 * A single series, so no legend: the tile's label names it. Each bar is
	 * the hover target for its day, and the hidden table carries the same
	 * numbers for a reader who cannot see the bars.
	 */
	import { formatCount, formatDate } from '#lib/format.ts';

	let { days, label, until = new Date() }: { days: number[]; label: string; until?: Date } = $props();

	const dates = $derived(
		days.map((_, i) => {
			const d = new Date(Date.UTC(until.getUTCFullYear(), until.getUTCMonth(), until.getUTCDate() - (days.length - 1 - i)));
			return d.toISOString().slice(0, 10);
		}),
	);
	const peak = $derived(Math.max(0, ...days));

	function height(n: number): number {
		if (peak === 0 || n === 0) return 0;
		return Math.max(8, (n / peak) * 100);
	}
</script>

<div class="flex h-8 items-end gap-0.5" aria-hidden="true" data-testid="trend-bars">
	{#each days as n, i (dates[i])}
		<div class="flex h-full flex-1 items-end" title="{formatDate(dates[i], dates[i])}: {formatCount(n)} changed">
			<div class="w-full rounded-t-xs transition-[height] duration-progress {n === 0 ? 'h-px bg-line' : 'bg-brand'}" style={n === 0 ? undefined : `height: ${height(n)}%`}></div>
		</div>
	{/each}
</div>
<!-- A table ignores the 1px box sr-only gives it and grows to its rows, so
     the wrapper is what stays out of the layout. -->
<div class="sr-only">
	<table>
		<caption>{label}, entries changed per day</caption>
		<thead><tr><th scope="col">Day</th><th scope="col">Changed</th></tr></thead>
		<tbody>
			{#each days as n, i (dates[i])}
				<tr><td>{formatDate(dates[i], dates[i])}</td><td>{n}</td></tr>
			{/each}
		</tbody>
	</table>
</div>
