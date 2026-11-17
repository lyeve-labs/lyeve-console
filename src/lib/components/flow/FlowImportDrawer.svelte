<script lang="ts">
	import { Button, Drawer, FileInput, Textarea } from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import FormErrors from '#lib/components/FormErrors.svelte';
	import { submitter } from '#lib/forms.svelte.ts';
	import type { InstanceLink } from '#lib/instance.svelte.ts';
	import type { RefusalNotice } from '#lib/flow/types.ts';
	import InlineUpgradeLink from '#lib/components/InlineUpgradeLink.svelte';

	/** An import's own failure. The page picks it out of the form result every action shares. */
	export interface ImportFailure {
		error: string;
		refusal: RefusalNotice | null;
		/** Whether the plugin refused the import, by a notice or by refusing the flow routes as a whole. */
		refused: boolean;
	}

	interface Props {
		open?: boolean;
		/** The flow the import replaces the draft of. */
		slug: string;
		failure: ImportFailure | null;
		/** Where the feature is turned on or the limit raised, when the instance names a place. */
		enableLink: InstanceLink | null;
	}

	let { open = $bindable(false), slug, failure, enableLink }: Props = $props();

	const submit = submitter(() => (open = false));
</script>

<Drawer bind:open title="Import a definition">
	<form
		method="POST"
		action="?/import"
		id="flow-import-form"
		enctype="multipart/form-data"
		use:enhance={submit.enhance}
		class="flex flex-col gap-4"
	>
		<FormErrors message={failure?.error} />
		{#if failure?.refused && enableLink}
			<!-- The notice above the canvas leaves an import's refusal to this
			     drawer, so the way to raise the limit or enable the feature is
			     here too. -->
			<InlineUpgradeLink link={enableLink} raises={failure.refusal?.limit != null} standalone />
		{/if}
		<input type="hidden" name="slug" value={slug} />
		<p class="text-sm text-muted">The imported definition replaces the draft of this flow. The published version is not touched until you publish again.</p>
		<FileInput id="import-file" name="file" label="Definition file" accept=".json,.yaml,.yml,application/json,application/yaml" />
		<Textarea id="import-text" name="text" label="Or paste the definition" rows={10} mono />
	</form>
	{#snippet footer()}
		<Button variant="secondary" type="button" onclick={() => (open = false)}>Cancel</Button>
		<Button variant="primary" type="submit" form="flow-import-form">Import</Button>
	{/snippet}
</Drawer>
