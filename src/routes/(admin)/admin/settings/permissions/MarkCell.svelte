<script lang="ts">
	import { Minus, ShieldCheck } from '@lucide/svelte';
	import { ICON } from '$lib/icon';
	import { applies, schemaLabel, type Action, type RuleMatrix } from './rules.svelte';

	/**
	 * One role's grant of one action on one resource.
	 *
	 * Each state has a shape of its own, so the matrix reads the same without
	 * color. A stored grant is a filled dot and an inherited one a ring,
	 * because the ring comes from the parent rule and holds only until this
	 * resource has a rule of its own. A denial is a dash and an exempt role a
	 * shield. Every mark is drawn in currentColor, never as a background, so
	 * a forced-colors theme repaints it in its own ink instead of erasing it.
	 */
	let {
		rules,
		role,
		schema,
		action,
	}: { rules: RuleMatrix; role: string; schema: string; action: Action } = $props();
</script>

{#if applies(action, schema)}
	{@const mark = rules.markFor(role, schema, action)}
	{#if mark === 'exempt'}
		<ShieldCheck size={ICON.sm} class="inline-block align-middle text-violet" aria-hidden="true" data-mark="exempt" />
	{:else if mark === 'none'}
		<Minus size={ICON.sm} class="inline-block align-middle text-muted" aria-hidden="true" data-mark="none" />
	{:else}
		<svg width="14" height="14" viewBox="0 0 14 14" class="inline-block align-middle text-brand" aria-hidden="true" data-mark={mark}>
			{#if mark === 'stored'}
				<circle cx="7" cy="7" r="7" fill="currentColor" />
			{:else}
				<circle cx="7" cy="7" r="6" fill="none" stroke="currentColor" stroke-width="2" />
			{/if}
		</svg>
	{/if}
	<span class="sr-only">{rules.markText(role, schema, action)}</span>
{:else}
	<span class="sr-only">{action} does not apply to {schemaLabel(schema)}.</span>
{/if}
