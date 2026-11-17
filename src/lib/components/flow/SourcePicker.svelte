<script lang="ts">
	import { Input, Select } from '@lyeve-labs/ui-kit';
	import { CUSTOM, isCustom, type PickerOption } from '#lib/flow/schema.ts';

	/**
	 * A Select over rows read from the live database, with a free-text escape.
	 * The escape matters: a schema name is often an expression such as
	 * {{ trigger.query.schema }}, which no list can offer, and a value the list
	 * does not know (a schema deleted since the flow was drawn) has to stay
	 * visible rather than snap to the first row.
	 */
	const EXAMPLE = '{{ trigger.query.value }}';

	interface Props {
		id: string;
		label: string;
		options: PickerOption[];
		value: string;
		hint?: string;
		error?: string;
		required?: boolean;
		/** Shown in place of the list when it is empty: what is missing and why. */
		emptyHint?: string;
		/** The label of the escape row. */
		customLabel?: string;
		/** What the free-text field shows when empty. An expression by default. */
		customPlaceholder?: string;
		/** The hint under the free-text field, when the field's own hint is not the right one. */
		customHint?: string;
		onchange: (value: string | undefined) => void;
	}

	let {
		id,
		label,
		options,
		value,
		hint,
		error,
		required = false,
		emptyHint = 'Nothing to choose from. Type a value.',
		customLabel = 'Custom value or expression',
		customPlaceholder = EXAMPLE,
		customHint,
		onchange,
	}: Props = $props();

	// Chosen explicitly, so a value the rows know can still be typed over.
	let chosenCustom = $state(false);

	const custom = $derived(chosenCustom || isCustom(options, value));
	const rows = $derived([...options, { value: CUSTOM, label: customLabel }]);
	const selected = $derived(custom ? CUSTOM : value || null);

	function pick(v: string) {
		if (v === CUSTOM) {
			chosenCustom = true;
			return;
		}
		chosenCustom = false;
		onchange(v || undefined);
	}
</script>

<div class="flex flex-col gap-1.5" data-testid="source-picker">
	{#if options.length === 0}
		<Input {id} {label} {required} {value} hint={hint ? `${hint} ${emptyHint}` : emptyHint} {error} oninput={(e) => onchange(e.currentTarget.value || undefined)} />
	{:else}
		<Select
			{id}
			{label}
			searchable
			{required}
			options={rows}
			value={selected}
			placeholder="Choose"
			hint={custom ? undefined : hint}
			error={custom ? undefined : error}
			onvaluechange={pick}
		/>
		{#if custom}
			<Input
				id="{id}-custom"
				aria-label="{label} value"
				{value}
				placeholder={customPlaceholder}
				hint={customHint ?? hint ?? 'A value, or an expression in double braces.'}
				{error}
				oninput={(e) => onchange(e.currentTarget.value || undefined)}
				mono
			/>
		{/if}
	{/if}
</div>
