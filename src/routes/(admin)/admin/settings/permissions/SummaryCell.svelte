<script lang="ts">
	import { ShieldCheck } from '@lucide/svelte';
	import { ICON } from '$lib/icon';
	import { EXEMPT_ROLE, SUMMARY_FILL, type Action, type RuleMatrix } from './rules.svelte';

	/**
	 * A collapsed role's grant of one action, as a bar that is empty, half
	 * full or full. The outline and the fill are both drawn in currentColor,
	 * so the bar keeps its shape under forced colors, and the sentence beside
	 * it says the same to a screen reader.
	 */
	let { rules, role, action }: { rules: RuleMatrix; role: string; action: Action } = $props();
</script>

{#if role === EXEMPT_ROLE}
	<ShieldCheck size={ICON.sm} class="inline-block align-middle text-violet" aria-hidden="true" data-mark="exempt" />
	<span class="sr-only">
		{role} is always allowed {action} on every content type. The role is exempt from these rules.
	</span>
{:else}
	{@const state = rules.summaryState(role, action)}
	<svg
		width="32"
		height="8"
		viewBox="0 0 32 8"
		class="inline-block align-middle text-brand"
		aria-hidden="true"
		data-summary={state}
	>
		<rect x="0.5" y="0.5" width="31" height="7" rx="3.5" fill="none" stroke="currentColor" />
		<rect width={SUMMARY_FILL[state]} height="8" rx="4" fill="currentColor" data-fill />
	</svg>
	<span class="sr-only">{rules.summaryText(role, action)}</span>
{/if}
