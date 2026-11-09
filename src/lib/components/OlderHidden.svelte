<script lang="ts">
	/**
	 * The row a list ends with when the plugin left older records out because
	 * this instance reads only a recent window of them.
	 *
	 * The count and the window are the plugin's, from its own list answer, so
	 * the row never states a number the admin holds. It is styled as a refusal
	 * rather than as an empty state: the records exist and are kept, and what
	 * this instance enables decides whether they are read. A page that can try to open one
	 * passes `children`, typically a form whose 402 the page renders with
	 * RefusalNotice.
	 */
	import type { Snippet } from 'svelte';
	import { Alert } from '@lyeve-labs/ui-kit';
	import { formatCount } from '$lib/format';

	let {
		count,
		noun,
		windowDays = null,
		children,
	}: {
		/** How many older records the list left out. */
		count: number;
		/** What the records are, plural: "revisions", "events". */
		noun: string;
		/** The window the instance reads, in days, when the plugin said. */
		windowDays?: number | null;
		children?: Snippet;
	} = $props();

	const label = $derived(`${formatCount(count)} older ${count === 1 ? noun.replace(/s$/, '') : noun}`);
	const span = $derived(windowDays ? `the last ${windowDays} days` : 'a recent window');
</script>

<div data-testid="older-hidden">
	<Alert tone="warn" title={label}>
		<p>
			You can read {span} of them. The older ones are still stored, and reading them is not enabled on
			this engine.
		</p>
		{#if children}
			<div class="mt-2">{@render children()}</div>
		{/if}
	</Alert>
</div>
