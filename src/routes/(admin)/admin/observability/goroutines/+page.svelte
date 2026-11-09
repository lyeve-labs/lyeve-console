<script lang="ts">
	import { PageShell } from '@lyeve-labs/ui-kit';
	import RefreshButton from '$lib/components/RefreshButton.svelte';
	import ObservabilityTabs from '$lib/components/ObservabilityTabs.svelte';
	import type { ActionData, PageData } from './$types';
	import GoroutineEnginePanel from './GoroutineEnginePanel.svelte';
	import RuntimeScalingPanel from './RuntimeScalingPanel.svelte';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<PageShell
	title="Observability"
	documentTitle="Goroutine engine - Observability"
	description="See and resize the goroutine engine, and set how the engine uses its CPU, memory and database."
	width="wide"
>
	{#snippet actions()}
		<RefreshButton />
	{/snippet}

	<ObservabilityTabs active="goroutines" />

	<GoroutineEnginePanel engine={data.goroutineEngine} {form} />

	<RuntimeScalingPanel runtime={data.runtime} {form} />
</PageShell>
