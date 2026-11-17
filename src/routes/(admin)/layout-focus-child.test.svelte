<!-- Stands in for a page that asks the shell for focus mode, the way the flow
     editor does, so the layout's half of the channel can be asserted alone. -->
<script lang="ts">
	import { useShell } from '#lib/shell.svelte.ts';

	const shell = useShell();
</script>

<button type="button" data-testid="ask-focus" onclick={() => shell && (shell.focus = !shell.focus)}>focus</button>
