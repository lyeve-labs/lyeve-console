<script lang="ts">
	import { Alert, Badge, Card, SectionHeading, Stat } from '@lyeve-labs/ui-kit';
	import { ExternalLink } from '@lucide/svelte';
	import Markdown from '$lib/components/Markdown.svelte';
	import { ICON } from '$lib/icon';
	import { isExternal, visibleTo, type ResolvedBlock } from '$lib/api/customization';
	import { formatDate } from '$lib/format';
	import { couldNotLoad } from '$lib/outage';

	/**
	 * Draws a tenant's page from its blocks. Markdown is rendered as elements,
	 * never as HTML, and every link leaves as a plain anchor, so a block can
	 * say anything and run nothing.
	 */
	let { blocks, roles }: { blocks: ResolvedBlock[]; roles: readonly string[] } = $props();
</script>

<div class="flex flex-col gap-6" data-testid="custom-blocks">
	{#each blocks as block, i (i)}
		{#if block.type === 'markdown'}
			<section class="flex flex-col gap-2">
				{#if block.title}<SectionHeading level={2}>{block.title}</SectionHeading>{/if}
				<Markdown source={block.body ?? ''} />
			</section>
		{:else if block.type === 'callout'}
			<Alert tone={block.tone || 'brand'} title={block.title || undefined}>{block.body}</Alert>
		{:else if block.type === 'content'}
			<Card pad="sm">
				{#snippet header()}
					<SectionHeading level={3}>{block.title || `Latest in ${block.schema}`}</SectionHeading>
				{/snippet}
				{#if block.entries === null}
					<p class="text-sm text-muted">{couldNotLoad('these entries', { reload: true })}</p>
				{:else if block.entries.length === 0}
					<p class="text-sm text-muted">No entries yet.</p>
				{:else}
					<ul class="flex flex-col divide-y divide-line">
						{#each block.entries as entry (entry.id)}
							<li class="flex items-center justify-between gap-3 py-2">
								<a href="/admin/content/{block.schema}/{entry.id}" class="truncate text-sm text-fg transition-colors hover:text-brand">
									{entry.title}
								</a>
								<span class="flex shrink-0 items-center gap-2">
									{#if entry.status}<Badge size="sm">{entry.status}</Badge>{/if}
									{#if entry.updated_at}<span class="text-xs text-faint">{formatDate(entry.updated_at)}</span>{/if}
								</span>
							</li>
						{/each}
					</ul>
				{/if}
			</Card>
		{:else if block.type === 'stats'}
			<section class="flex flex-col gap-3">
				{#if block.title}<SectionHeading level={2}>{block.title}</SectionHeading>{/if}
				<div class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
					{#each block.counts as c (c.schema)}
						<Stat size="sm" mono label={c.schema} value={c.rows === null ? 'n/a' : c.rows} />
					{/each}
				</div>
			</section>
		{:else if block.type === 'links'}
			<Card pad="sm">
				{#snippet header()}
					<SectionHeading level={3}>{block.title || 'Links'}</SectionHeading>
				{/snippet}
				<ul class="flex flex-col gap-2">
					{#each (block.links ?? []).filter((l) => visibleTo(l.roles, roles)) as link (link.url + link.label)}
						<li>
							{#if isExternal(link.url)}
								<a href={link.url} target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1 text-sm text-fg transition-colors hover:text-brand">
									{link.label} <ExternalLink size={ICON.xs} aria-hidden="true" />
								</a>
							{:else}
								<a href={link.url} class="text-sm text-fg transition-colors hover:text-brand">{link.label}</a>
							{/if}
						</li>
					{/each}
				</ul>
			</Card>
		{/if}
	{/each}
</div>
