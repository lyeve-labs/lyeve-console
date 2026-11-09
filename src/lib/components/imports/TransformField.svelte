<script lang="ts">
	/*
	 * What one mapping does to a cell before it is stored, with the options
	 * the chosen transform needs. Used by the import wizard and the mapping
	 * template drawer, so a transform reads the same in both.
	 */
	import { Input, Select, Textarea } from '@lyeve-labs/ui-kit';
	import { TRANSFORMS, type TransformDraft } from '$lib/api/bulk-import';

	let {
		draft = $bindable(),
		id,
		label,
		licensed = null,
	}: {
		draft: TransformDraft;
		/** A prefix that keeps each field's id unique on the page. */
		id: string;
		label: string;
		/** False marks the transforms this instance may not name in a new request. */
		licensed?: boolean | null;
	} = $props();

	const options = $derived(
		TRANSFORMS.map((t) => ({
			value: t.value,
			label: t.licensed && licensed === false ? `${t.label}, needs a license` : t.label,
		})),
	);
</script>

<div class="flex flex-col gap-2">
	<Select id="{id}-transform" {label} bind:value={draft.transform} {options} />
	{#if draft.transform === 'date'}
		<div class="grid gap-2 sm:grid-cols-2">
			<Input
				id="{id}-layout"
				label="Written as"
				placeholder="02/01/2006"
				hint="Write the reference date 2 January 2006, 15:04:05 the way the cells show it."
				bind:value={draft.layout}
			/>
			<Input
				id="{id}-output"
				label="Stored as"
				placeholder="2006-01-02"
				hint="Leave empty to store the full timestamp."
				bind:value={draft.outputLayout}
			/>
		</div>
	{:else if draft.transform === 'split'}
		<Input
			id="{id}-separator"
			label="Separator"
			hint="Spaces around each item are trimmed, and empty items are dropped."
			bind:value={draft.separator}
		/>
	{:else if draft.transform === 'lookup'}
		<Textarea
			id="{id}-lookup"
			label="Lookup"
			rows={4}
			mono
			placeholder={'NY = New York\nCA = California'}
			hint="One pair per line: the value in the file, then the value to store. Up to 1000 pairs."
			bind:value={draft.lookup}
		/>
		<Input
			id="{id}-fallback"
			label="For any other value"
			hint="Leave empty to reject a row whose value is not in the list."
			bind:value={draft.fallback}
		/>
	{/if}
</div>
