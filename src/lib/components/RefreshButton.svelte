<script lang="ts">
	import { Button } from '@lyeve-labs/ui-kit';
	import { invalidate, invalidateAll } from '$app/navigation';
	import { RefreshCw } from '@lucide/svelte';
	import { ICON } from '$lib/icon';

	// Reloads the page's data and spins while the load runs. A page that polls
	// under a dependency names it, so the button reloads what the poll reloads.
	let { dependency }: { dependency?: string } = $props();

	let pending = $state(false);
	async function refresh() {
		pending = true;
		try {
			await (dependency ? invalidate(dependency) : invalidateAll());
		} finally {
			pending = false;
		}
	}
</script>

<Button variant="secondary" size="sm" onclick={refresh} loading={pending}>
	<RefreshCw size={ICON.sm} /> Refresh
</Button>
