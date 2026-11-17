<script lang="ts">
	import { parseMarkdown } from '#lib/markdown.ts';
	import Inlines from './MarkdownInline.svelte';

	/**
	 * Renders Markdown a model wrote as elements, never as HTML. The kit ships
	 * no renderer, and a library one would either inject markup or bring a
	 * sanitizer the bundle has no room for. The reader in `#lib/markdown.ts`
	 * covers what an answer about a flow uses.
	 */
	interface Props {
		source: string;
		class?: string;
	}

	let { source, class: cls = '' }: Props = $props();

	const blocks = $derived(parseMarkdown(source));

	const HEADING_CLASS: Record<number, string> = {
		1: 'text-base font-semibold text-fg',
		2: 'text-sm font-semibold text-fg',
		3: 'text-sm font-medium text-fg',
		4: 'text-xs font-medium uppercase tracking-wide text-muted',
	};
</script>

<div class="flex flex-col gap-2 text-sm text-fg {cls}" data-testid="markdown">
	{#each blocks as block, i (i)}
		{#if block.kind === 'heading'}
			<svelte:element this={`h${block.level + 2}`} class={HEADING_CLASS[block.level]}>
				<Inlines nodes={block.children} />
			</svelte:element>
		{:else if block.kind === 'paragraph'}
			<p><Inlines nodes={block.children} /></p>
		{:else if block.kind === 'code'}
			<pre class="overflow-auto rounded-md border border-line bg-surface-2 p-3 font-mono text-xs text-fg" data-language={block.language}>{block.text}</pre>
		{:else if block.ordered}
			<ol class="list-decimal pl-5">
				{#each block.items as item, j (j)}
					<li><Inlines nodes={item} /></li>
				{/each}
			</ol>
		{:else}
			<ul class="list-disc pl-5">
				{#each block.items as item, j (j)}
					<li><Inlines nodes={item} /></li>
				{/each}
			</ul>
		{/if}
	{/each}
</div>
