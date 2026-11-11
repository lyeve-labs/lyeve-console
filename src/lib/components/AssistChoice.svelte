<script lang="ts">
	/**
	 * Accept and reject for a console control that registers with a
	 * FormAssist itself, such as the rich text and json editors. The kit's own
	 * controls draw these in their label row, and these two editors have no
	 * label row of their own, so the line sits above the editor while the
	 * field holds a suggestion.
	 */
	import { Button, type AssistField } from '@lyeve-labs/ui-kit';
	import { Check, X } from '@lucide/svelte';
	import { ICON } from '$lib/icon';

	let { field }: { field: AssistField } = $props();
</script>

{#if field.pending}
	<div class="flex items-center gap-2 text-xs">
		<span class="font-medium text-violet">Suggested</span>
		<span class="ms-auto flex items-center gap-0.5">
			<Button variant="ghost" size="icon" aria-label="Accept the suggestion for {field.label}" onclick={() => field.accept()}>
				<Check size={ICON.sm} aria-hidden="true" />
			</Button>
			<Button variant="ghost" size="icon" aria-label="Reject the suggestion for {field.label}" onclick={() => field.reject()}>
				<X size={ICON.sm} aria-hidden="true" />
			</Button>
		</span>
	</div>
{/if}
