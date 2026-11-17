<script lang="ts">
	import type { Inline } from '#lib/markdown.ts';
	import Self from './MarkdownInline.svelte';

	/** The inline half of the Markdown renderer. Recursive for emphasis inside a link and the like. */
	let { nodes }: { nodes: Inline[] } = $props();
</script>

{#each nodes as node, i (i)}
	{#if node.kind === 'text'}{node.text}{:else if node.kind === 'code'}<code class="rounded bg-surface-2 px-1 font-mono text-xs">{node.text}</code>{:else if node.kind === 'strong'}<strong class="font-semibold"><Self nodes={node.children} /></strong>{:else if node.kind === 'em'}<em><Self nodes={node.children} /></em>{:else}<a class="text-brand underline" href={node.href} rel="noopener noreferrer" target="_blank"><Self nodes={node.children} /></a>{/if}
{/each}
