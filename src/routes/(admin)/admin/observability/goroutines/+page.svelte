<script lang="ts">
	import { PageShell } from '@lyeve-labs/ui-kit';
	import RefreshButton from '$lib/components/RefreshButton.svelte';
	import ObservabilityTabs from '$lib/components/ObservabilityTabs.svelte';
	import type { ActionData, PageData } from './$types';
	import GoroutineEnginePanel from './GoroutineEnginePanel.svelte';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<PageShell
	title="Observability"
	documentTitle="Goroutine engine - Observability"
	description="See the worker pool, the parallel engine and the async hooks, and resize them."
	width="wide"
>
	{#snippet actions()}
		<RefreshButton />
	{/snippet}

	<ObservabilityTabs active="goroutines" />

	<GoroutineEnginePanel engine={data.goroutineEngine} {form} />
</PageShell>
