<script lang="ts">
	import { PageShell } from '@lyeve-labs/ui-kit';
	import type { PageData } from './$types';
	import StreamLab from '$lib/components/labs/StreamLab.svelte';
	import ApiLabsTabs from '$lib/components/ApiLabsTabs.svelte';
	import NoSandbox from '../NoSandbox.svelte';

	let { data }: { data: PageData } = $props();

	const superAdmin = $derived(data.user.roles.includes('super_admin'));
</script>

<PageShell
	title="API labs"
	documentTitle="Streams - API labs"
	description="Send a real request to this engine and see the response."
	width="wide"
>
	<NoSandbox />

	<ApiLabsTabs active="streams" {superAdmin} />

	<StreamLab />
</PageShell>
