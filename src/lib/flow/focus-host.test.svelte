<script lang="ts">
	import { focusMode } from './focus.svelte.ts';

	let { refit }: { refit: () => void } = $props();
	const focus = focusMode(() => refit());
</script>

<button type="button" onclick={() => (focus.on = !focus.on)}>Focus</button>
