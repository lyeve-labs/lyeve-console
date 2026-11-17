<script lang="ts">
	import { Button } from '@lyeve-labs/ui-kit';
	import { Pencil, Plus, Trash2 } from '@lucide/svelte';
	import type { Permission } from '@lyeve-labs/client';
	import { ICON } from '#lib/icon.ts';
	import { EXEMPT_ROLE, schemaLabel } from './rules.svelte';

	/**
	 * Edit or add the rule on one row, and remove it when there is one. The
	 * page owns the drawer and the removal, so the buttons only call back.
	 */
	let {
		role,
		schema,
		perm,
		onedit,
		ondelete,
	}: {
		role: string;
		schema: string;
		perm: Permission | undefined;
		onedit: (role: string, schema: string) => void;
		ondelete: (perm: Permission) => void;
	} = $props();
</script>

<div class="flex justify-end gap-1">
	<Button
		variant="ghost"
		size="sm"
		disabled={role === EXEMPT_ROLE}
		aria-label="{perm ? 'Edit' : 'Add'} rule for {role} on {schemaLabel(schema)}"
		onclick={() => onedit(role, schema)}
	>
		{#if perm}
			<Pencil size={ICON.sm} />
		{:else}
			<Plus size={ICON.sm} />
		{/if}
	</Button>
	{#if perm}
		<Button
			variant="ghost"
			size="sm"
			aria-label="Remove rule for {role} on {schemaLabel(schema)}"
			onclick={() => ondelete(perm)}
		>
			<Trash2 size={ICON.sm} class="text-danger" />
		</Button>
	{/if}
</div>
