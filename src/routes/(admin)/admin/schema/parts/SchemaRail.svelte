<script lang="ts">
	import { Button, SearchInput } from '@lyeve-labs/ui-kit';
	import type { Schema } from '@lyeve-labs/client';
	import { tableName } from '$lib/relations';

	/**
	 * The rail lists every schema in the tenant. A tenant with two hundred of
	 * them turns picking one into a scroll, so the list is filterable and draws
	 * a page at a time. It sits inside the page's resizable aside.
	 */
	let {
		schemas,
		rowCounts,
		current,
		onselect,
	}: {
		schemas: Schema[];
		// A count that could not be read is absent, never 0.
		rowCounts: Record<string, number>;
		// The saved schema the editor holds, marked as the current row.
		current: string | undefined;
		onselect: (s: Schema) => void;
	} = $props();

	/** How many rows the rail draws before it asks. */
	const PAGE = 100;
	let shown = $state(PAGE);
	let schemaFilter = $state('');

	// A new filter starts the list from the top.
	$effect(() => {
		void schemaFilter;
		shown = PAGE;
	});

	let visibleSchemas = $derived.by(() => {
		const q = schemaFilter.trim().toLowerCase();
		if (!q) return schemas;
		return schemas.filter(
			(s) => s.name.toLowerCase().includes(q) || (s.display_name ?? '').toLowerCase().includes(q),
		);
	});
</script>

<!-- The filter sits on the list it narrows. -->
{#if schemas.length > 1}
	<div class="px-3 pt-3">
		<label for="schema-filter" class="sr-only">Filter content types</label>
		<SearchInput id="schema-filter" bind:value={schemaFilter} placeholder="Filter content types" />
	</div>
{/if}
<div class="space-y-1 p-3">
	{#each visibleSchemas.slice(0, shown) as s (s.name)}
		{@const relations = s.fields.filter((f) => f.field_type === 'relation').length}
		{@const rows = rowCounts[s.name]}
		<!-- Named by the schema alone. The two lines under the pointer are
		     the table it writes and how big it is, and reading all of that
		     out as the control's name says more about the row than about
		     what pressing it does. -->
		<button
			type="button"
			aria-label={s.display_name || s.name}
			aria-current={current === s.name ? 'true' : undefined}
			onclick={() => onselect(s)}
			class="w-full rounded-lg px-3 py-2 text-left transition-colors
				{current === s.name ? 'bg-line text-fg' : 'text-muted hover:bg-surface-2 hover:text-fg'}"
		>
			<span class="flex items-baseline justify-between gap-2">
				<span class="truncate text-sm font-medium">{s.display_name || s.name}</span>
				<span class="shrink-0 text-xs tabular-nums text-faint">
					{s.fields.length}
					{s.fields.length === 1 ? 'field' : 'fields'}
				</span>
			</span>
			<span class="mt-0.5 flex items-center gap-2 truncate text-xs text-faint">
				<span class="truncate font-mono">{tableName(s.name)}</span>
				{#if relations > 0}
					<span class="shrink-0">{relations} rel</span>
				{/if}
				{#if rows !== undefined}
					<span class="shrink-0 tabular-nums">{rows} {rows === 1 ? 'row' : 'rows'}</span>
				{/if}
			</span>
		</button>
	{/each}
	{#if visibleSchemas.length === 0 && schemas.length > 0}
		<p class="px-3 py-2 text-sm text-muted">No content types match this filter.</p>
	{/if}
	{#if visibleSchemas.length > shown}
		<Button variant="ghost" size="sm" class="w-full" onclick={() => (shown += PAGE)}>
			Show {Math.min(PAGE, visibleSchemas.length - shown)} more of {visibleSchemas.length - shown}
		</Button>
	{/if}
</div>
