<script lang="ts">
	import { PageShell } from '@lyeve-labs/ui-kit';
	import ObservabilityTabs from '$lib/components/ObservabilityTabs.svelte';
	import type { PageData } from './$types';
	import LiveLogTail from './LiveLogTail.svelte';

	let { data }: { data: PageData } = $props();
</script>

<PageShell
	title="Observability"
	documentTitle="Live log tail - Observability"
	description="Follow the engine's log as it is written, filtered by level and keyword."
	width="wide"
>
	<ObservabilityTabs active="log-tail" />

	<LiveLogTail running={data.logTail} />
</PageShell>
