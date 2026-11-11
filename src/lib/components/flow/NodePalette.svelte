<script lang="ts">
	import { Collapsible, SearchInput, Tooltip } from '@lyeve-labs/ui-kit';
	import { Lock, StickyNote } from '@lucide/svelte';
	import { isLocked, type NodeSpec } from '$lib/flow/types';
	import { CATEGORY_ORDER, categoryIcon, categoryLabel, categoryText, pluginLabel } from '$lib/flow/categories';
	import { ICON } from '$lib/icon';

	interface Props {
		catalog: NodeSpec[];
		/** The node types could not be read, so an empty palette is not a search that matched nothing. */
		unread?: boolean;
		/** Click, or Enter on a card: add the type at the viewport center. */
		onadd: (type: string) => void;
	}

	// A type the plugin says this instance may not use wears a lock and stays
	// draggable: the refusal on save names the node, which is a better
	// explanation than a row that will not move.
	let { catalog, unread = false, onadd }: Props = $props();

	const LOCKED = 'Not enabled on this instance';

	let filter = $state('');

	// Collapsed categories, by name. A search reopens everything, because a
	// match hidden under a closed heading reads as no match.
	let collapsed = $state<Record<string, boolean>>({});

	// The built-in categories in their fixed order, then one section per
	// contributing plugin in the order the catalog lists them, which is by
	// plugin name. A contributed spec carries its plugin as its category, so
	// the section key is the same word either way. The plugin flag is what
	// tells the two kinds of section apart.
	const groups = $derived.by(() => {
		const q = filter.trim().toLowerCase();
		const visible = catalog.filter((s) => {
			if (s.trigger) return false;
			if (!q) return true;
			return `${s.type} ${s.label} ${s.description} ${s.plugin ?? ''}`.toLowerCase().includes(q);
		});
		const categories = [...CATEGORY_ORDER, ...visible.map((s) => s.plugin ?? s.category).filter((c) => !CATEGORY_ORDER.includes(c))];
		return [...new Set(categories)]
			.map((category) => {
				const specs = visible.filter((s) => (s.plugin ?? s.category) === category);
				const plugin = specs.some((s) => s.plugin !== undefined);
				return { category, plugin, label: plugin ? pluginLabel(category) : categoryLabel(category), specs };
			})
			.filter((g) => g.specs.length > 0);
	});

	const searching = $derived(filter.trim() !== '');

	// The ghost that follows the pointer during a drag: the type's label on a
	// card, rather than the browser's snapshot of the whole palette row.
	let ghost = $state<HTMLDivElement>();
	let ghostLabel = $state('');

	function dragStart(e: DragEvent, s: NodeSpec) {
		e.dataTransfer?.setData('application/x-flow-node', s.type);
		if (!e.dataTransfer) return;
		e.dataTransfer.effectAllowed = 'copy';
		ghostLabel = s.label;
		if (ghost) e.dataTransfer.setDragImage(ghost, 12, 16);
	}

	// The row carries the name and the type. What the node does is one hover
	// away, so the list reads as a list and not as a page of cards.
	function hint(s: NodeSpec): string {
		const text = s.description || s.label;
		return isLocked(s) ? `${text} ${LOCKED}.` : text;
	}
</script>

<div class="flex h-full min-h-0 flex-col" data-testid="node-palette">
	<div class="sticky top-0 z-10 shrink-0 border-b border-line bg-surface p-2">
		<label for="palette-search" class="sr-only">Filter node types</label>
		<SearchInput id="palette-search" bind:value={filter} placeholder="Find a node" />
	</div>
	<div class="min-h-0 flex-1 overflow-y-auto p-1">
		{#each groups as group (group.category)}
			<!-- A contributed section wears the word "plugin" where a built-in
			     wears its count: the mark is what says these rows come from a
			     plugin and go when it does, and the count reads off the rows. -->
			<section aria-label={group.plugin ? `${group.label} plugin` : group.label} data-plugin={group.plugin ? group.category : undefined}>
				<Collapsible
					label={group.label}
					icon={categoryIcon(group.category)}
					badge={group.plugin ? 'plugin' : group.specs.length}
					bind:open={() => searching || !collapsed[group.category], (v) => (collapsed = { ...collapsed, [group.category]: !v })}
				>
					<ul class="flex flex-col pb-1">
						{#each group.specs as s (s.type)}
							{@const Icon = s.type === 'note' ? StickyNote : categoryIcon(s.category)}
							<li>
								<Tooltip text={hint(s)} position="right" class="w-full">
									<div
										class="flex w-full cursor-grab items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
										draggable="true"
										role="button"
										tabindex="0"
										data-node-type={s.type}
										ondragstart={(e) => dragStart(e, s)}
										onclick={() => onadd(s.type)}
										onkeydown={(e) => {
											if (e.key === 'Enter' || e.key === ' ') {
												e.preventDefault();
												onadd(s.type);
											}
										}}
									>
										<Icon size={ICON.sm} class="shrink-0 {s.type === 'note' ? 'text-warn' : categoryText(s.category)}" />
										<span class="truncate text-sm text-fg">{s.label}</span>
										{#if isLocked(s)}
											<span class="inline-flex shrink-0 text-muted" data-testid="node-locked">
												<Lock size={ICON.sm} aria-hidden="true" />
												<span class="sr-only">{LOCKED}</span>
											</span>
										{/if}
										<span class="ml-auto min-w-0 truncate font-mono text-xs text-faint">{s.type}</span>
									</div>
								</Tooltip>
							</li>
						{/each}
					</ul>
				</Collapsible>
			</section>
		{/each}
		{#if unread}
			<p class="p-2 text-sm text-muted">Could not load node types.</p>
		{:else if groups.length === 0}
			<p class="p-2 text-sm text-muted">No node type matches.</p>
		{/if}
	</div>
	<div
		bind:this={ghost}
		class="pointer-events-none fixed -left-full top-0 rounded-md border border-brand bg-surface-2 px-2.5 py-1.5 text-sm font-medium text-fg"
		aria-hidden="true"
		data-testid="palette-drag-ghost"
	>
		{ghostLabel}
	</div>
</div>
