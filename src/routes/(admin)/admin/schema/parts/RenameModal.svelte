<script lang="ts">
	import { Button, Input, Modal, toast } from '@lyeve-labs/ui-kit';
	import type { Schema } from '@lyeve-labs/client';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';

	/**
	 * Renaming moves the table, so it is its own step with its own form, and
	 * only from a saved state: the rename runs before anything else would.
	 * The page opens it with show() and takes the stored schema back through
	 * onrenamed before the dialog closes.
	 */
	let {
		name,
		onrenamed,
	}: {
		name: string | undefined;
		onrenamed: (from: string, stored: Schema) => void;
	} = $props();

	let open = $state(false);
	let renameTo = $state('');
	let renaming = $state(false);
	let renameError = $state('');

	export function show() {
		if (!name) return;
		renameTo = name;
		renameError = '';
		open = true;
	}

	const submitRename: SubmitFunction = () => {
		renaming = true;
		renameError = '';
		return async ({ result }) => {
			renaming = false;
			if (result.type === 'success' && result.data && 'saved' in result.data) {
				const from = String((result.data as { from?: string }).from ?? '');
				const stored = result.data.saved as Schema;
				onrenamed(from, stored);
				open = false;
				toast.success(`Renamed ${from} to ${stored.name}`);
				await invalidateAll();
			} else if (result.type === 'failure') {
				renameError = String((result.data as { error?: string })?.error ?? 'Could not rename the content type. Try again.');
			}
		};
	};
</script>

<!-- A one-field prompt: the new machine name. -->
<Modal bind:open title="Rename {name ?? 'content type'}">
	<form method="POST" action="?/rename" use:enhance={submitRename} id="schema-rename" class="flex flex-col gap-3">
		<input type="hidden" name="from" value={name ?? ''} />
		<Input
			id="schema-rename-to"
			name="to"
			label="New machine name"
			bind:value={renameTo}
			hint="Renames the table and the API path. Every row moves with them."
			error={renameError || undefined}
			mono
		/>
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (open = false)}>Cancel</Button>
		<Button
			variant="primary"
			type="submit"
			form="schema-rename"
			loading={renaming}
			disabled={!renameTo.trim() || renameTo.trim() === name}
		>
			Rename
		</Button>
	{/snippet}
</Modal>
