<script lang="ts">
	import { ChevronDown, ChevronRight } from '@lucide/svelte';
	import JsonTree from './JsonTree.svelte';
	import { ICON } from '$lib/icon';

	/**
	 * A JSON value as a tree: objects and lists fold, scalars print. The two
	 * top levels start open, because a step's output is usually a list of
	 * rows and the reader wants the first row's keys without a click.
	 */
	interface Props {
		value: unknown;
		name?: string;
		depth?: number;
	}

	let { value, name, depth = 0 }: Props = $props();

	const OPEN_TO = 2;
	// The initial fold reads the depth once on purpose: a node the reader has
	// opened stays open when a sibling above it re-renders.
	// svelte-ignore state_referenced_locally
	let open = $state(depth < OPEN_TO);

	const isList = $derived(Array.isArray(value));
	const isObject = $derived(value !== null && typeof value === 'object' && !isList);
	const entries = $derived.by<[string, unknown][]>(() => {
		if (isList) return (value as unknown[]).map((v, i) => [String(i), v]);
		if (isObject) return Object.entries(value as Record<string, unknown>);
		return [];
	});

	function scalar(v: unknown): { text: string; cls: string } {
		if (v === null) return { text: 'null', cls: 'text-faint' };
		if (v === undefined) return { text: 'undefined', cls: 'text-faint' };
		if (typeof v === 'string') return { text: JSON.stringify(v), cls: 'text-success' };
		if (typeof v === 'number') return { text: String(v), cls: 'text-brand' };
		if (typeof v === 'boolean') return { text: String(v), cls: 'text-warn' };
		return { text: String(v), cls: 'text-fg' };
	}

	const summary = $derived(
		isList ? `[${entries.length}]` : isObject ? `{${entries.length}}` : ''
	);
</script>

<div class="font-mono text-xs leading-5" data-testid="json-tree" data-depth={depth}>
	{#if isList || isObject}
		<button
			type="button"
			class="inline-flex items-center gap-1 rounded text-left text-fg outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-focus"
			aria-expanded={open}
			onclick={() => (open = !open)}
		>
			{#if open}<ChevronDown size={ICON.xs} class="shrink-0 text-faint" />{:else}<ChevronRight size={ICON.xs} class="shrink-0 text-faint" />{/if}
			{#if name !== undefined}<span class="text-muted">{name}:</span>{/if}
			<span class="text-faint">{summary}</span>
		</button>
		{#if open}
			<div class="ml-2 border-l border-line pl-3">
				{#each entries as [k, v] (k)}
					<JsonTree value={v} name={k} depth={depth + 1} />
				{:else}
					<span class="text-faint">empty</span>
				{/each}
			</div>
		{/if}
	{:else}
		{@const s = scalar(value)}
		<div class="flex gap-1">
			{#if name !== undefined}<span class="shrink-0 text-muted">{name}:</span>{/if}
			<span class="min-w-0 break-all {s.cls}">{s.text}</span>
		</div>
	{/if}
</div>
