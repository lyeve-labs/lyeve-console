<script lang="ts">
	import { Button, Drawer, Input } from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import FormErrors from '$lib/components/FormErrors.svelte';
	import type { Refusal } from '$lib/api/refusal';
	import { tracked } from '$lib/forms.svelte';

	/**
	 * The new role drawer. A role exists on this screen only once it has a
	 * row, so creating one writes its wildcard rule with no actions.
	 */
	let {
		open = $bindable(false),
		error = undefined,
		refused = null,
	}: {
		open?: boolean;
		/** A failed save, already filtered by the page to this drawer and to after it opened. */
		error?: string;
		/** A license refusal, the role ceiling with its numbers among them. */
		refused?: Refusal | null;
	} = $props();

	let newRoleName = $state('');

	const saveRole = tracked(() => async ({ result, update }) => {
		if (result.type !== 'failure') {
			open = false;
			newRoleName = '';
		}
		await update({ reset: false });
	});
</script>

<Drawer bind:open title="New role">
	<form
		method="POST"
		action="?/upsert"
		id="role-form"
		use:enhance={saveRole.enhance}
		class="space-y-4"
	>
		<FormErrors message={error} {refused} />
		<input type="hidden" name="drawer" value="role" />
		<!-- The matrix lists a role only where a rule names it, so a new role
		     is a wildcard rule with no actions: it grants nothing until a
		     rule is edited. -->
		<input type="hidden" name="schema_name" value="*" />
		<Input
			id="new-role"
			label="Role name"
			name="role"
			bind:value={newRoleName}
			placeholder="reviewer"
			required
		/>
		<p class="text-sm text-muted">
			A new role can do nothing with any content type or flow until you grant it an action.
		</p>
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (open = false)}>Cancel</Button>
		<Button variant="primary" type="submit" form="role-form" loading={saveRole.pending}>Create</Button>
	{/snippet}
</Drawer>
