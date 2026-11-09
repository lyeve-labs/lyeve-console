<script lang="ts">
	import { NumberInput } from '@lyeve-labs/ui-kit';
	import { LIMIT_FIELDS, limitOrderProblem, type KeyLimits } from '$lib/api/api-keys';

	/**
	 * A key's three request ceilings side by side, shortest window first, so
	 * the order the engine insists on reads left to right. Each posts under
	 * its own field name.
	 */
	let {
		limits = $bindable(),
		idPrefix,
		errors = {},
	}: {
		limits: KeyLimits;
		idPrefix: string;
		errors?: Record<string, string | undefined>;
	} = $props();

	const order = $derived(limitOrderProblem(limits));
</script>

<!-- A legend is not a flex item, so the fieldset's gap never reaches it. It
     carries its own margin, as the kit's groups do, and the hint sits under
     it like the Access group's, so the caption reads apart from the field
     labels of the same weight below it. The kit's NumberInput holds a number
     and takes no placeholder, so 0 stands for no limit and the hint says so. -->
<fieldset class="flex min-w-0 flex-col gap-3" aria-describedby="{idPrefix}-limits-hint">
	<legend class="mb-1 text-sm font-medium text-fg">Request limits</legend>
	<p id="{idPrefix}-limits-hint" class="text-xs text-muted">
		Enter 0 for no limit. A key over a limit gets a 429 until its hour, day or month ends in UTC.
	</p>
	<!-- Three across once the drawer has the room, read from its width rather
	     than the window's, and one under another below that. -->
	<div class="@container">
		<div class="grid gap-4 @lg:grid-cols-3">
			{#each LIMIT_FIELDS as f (f.field)}
				<NumberInput
					id="{idPrefix}-{f.field}"
					label={f.label}
					name={f.field}
					min={0}
					bind:value={() => limits[f.field], (v) => (limits = { ...limits, [f.field]: v })}
					error={errors[f.field] ?? (order?.field === f.field ? order.message : undefined)}
				/>
			{/each}
		</div>
	</div>
</fieldset>
