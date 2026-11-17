<script lang="ts">
	import { Button, Collapsible, SearchInput, Spinner } from '@lyeve-labs/ui-kit';
	import { Plus, RefreshCw } from '@lucide/svelte';
	import type { IntrospectedTable } from '#lib/api/flows.ts';
	import { ICON } from '#lib/icon.ts';

	/** What the page knows about a datasource's tables, loaded once per datasource. */
	export interface TablesState {
		status: 'idle' | 'loading' | 'ready' | 'error';
		tables: IntrospectedTable[];
		message?: string;
	}

	interface Props {
		tables: TablesState;
		/** Inserts a table or column name at the editor's cursor. */
		oninsert: (text: string) => void;
		onretry?: () => void;
	}

	let { tables, oninsert, onretry }: Props = $props();

	// The engine caps a listing at 500 tables. Painting all of them as
	// disclosures is slow and unreadable, so the panel shows the first
	// hundred matches and asks for a narrower filter for the rest.
	const SHOWN = 100;

	let filter = $state('');

	const matches = $derived.by(() => {
		const q = filter.trim().toLowerCase();
		if (!q) return tables.tables;
		return tables.tables.filter(
			(t) => t.name.toLowerCase().includes(q) || t.columns.some((c) => c.name.toLowerCase().includes(q))
		);
	});
	const shown = $derived(matches.slice(0, SHOWN));

	/** The bare column name reads better in a query than the qualified table it came from. */
	function insertTable(t: IntrospectedTable) {
		oninsert(t.name);
	}
</script>

<div class="flex h-full min-h-0 flex-col gap-2" data-testid="tables-panel" aria-label="Tables">
	<div class="flex items-center justify-between gap-2">
		<span class="text-xs font-semibold uppercase tracking-wide text-faint">Tables</span>
		{#if tables.status === 'ready'}
			<span class="text-xs text-faint">{tables.tables.length}</span>
		{/if}
	</div>
	{#if tables.status === 'idle'}
		<p class="text-xs text-muted">Choose a SQL datasource to list its tables.</p>
	{:else if tables.status === 'loading'}
		<div class="flex items-center gap-2 text-xs text-muted">
			<Spinner size={ICON.sm} />
			Loading tables
		</div>
	{:else if tables.status === 'error'}
		<p class="text-xs text-danger">{tables.message ?? 'Could not load tables.'}</p>
		{#if onretry}
			<div>
				<Button variant="secondary" size="sm" onclick={onretry}>
					<RefreshCw size={ICON.sm} />
					Retry
				</Button>
			</div>
		{/if}
	{:else if tables.tables.length === 0}
		<p class="text-xs text-muted">This datasource has no readable tables.</p>
	{:else}
		<SearchInput bind:value={filter} placeholder="Filter tables" label="Filter tables" />
		<ul class="flex min-h-0 flex-1 flex-col overflow-y-auto">
			{#each shown as t (t.name)}
				<li>
					<Collapsible label={t.name} badge={t.columns.length}>
						<div class="flex flex-col pb-1 pl-6">
							<Button variant="ghost" size="sm" onclick={() => insertTable(t)}>
								<Plus size={ICON.sm} />
								Insert {t.name}
							</Button>
							{#each t.columns as c (c.name)}
								<Button
									variant="ghost"
									size="sm"
									class="justify-start font-mono"
									aria-label="Insert {c.name}"
									onclick={() => oninsert(c.name)}
								>
									{c.name}
									<span class="ml-auto text-xs text-faint">{c.type}</span>
								</Button>
							{/each}
						</div>
					</Collapsible>
				</li>
			{/each}
		</ul>
		{#if matches.length > SHOWN}
			<p class="text-xs text-faint">{matches.length - SHOWN} more. Narrow the filter to see them.</p>
		{:else if matches.length === 0}
			<p class="text-xs text-muted">No table matches.</p>
		{/if}
	{/if}
</div>
