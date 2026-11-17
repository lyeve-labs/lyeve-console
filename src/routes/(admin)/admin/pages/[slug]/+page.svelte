<script lang="ts">
	import { Button, EmptyState, PageShell } from '@lyeve-labs/ui-kit';
	import { LayoutGrid, Pencil } from '@lucide/svelte';
	import CustomBlocks from '#lib/components/custom/CustomBlocks.svelte';
	import { ICON } from '#lib/icon.ts';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const canEdit = $derived(data.user.roles.includes('admin') || data.user.roles.includes('super_admin'));
</script>

<PageShell title={data.customPage.title} description={data.customPage.description || undefined} width="wide">
	{#snippet actions()}
		{#if canEdit}
			<Button variant="secondary" size="sm" href="/admin/settings/customization/pages/{data.customPage.slug}">
				<Pencil size={ICON.sm} /> Edit page
			</Button>
		{/if}
	{/snippet}
	{#if data.blocks.length === 0}
		<EmptyState
			level={2}
			title="This page has no blocks yet"
			description={canEdit ? 'Add blocks to show content here.' : 'Ask an admin to add blocks to this page.'}
		>
			{#snippet iconSnippet()}
				<LayoutGrid size={ICON.lg} />
			{/snippet}
			{#snippet action()}
				{#if canEdit}
					<Button variant="secondary" href="/admin/settings/customization/pages/{data.customPage.slug}">
						<Pencil size={ICON.sm} /> Edit page
					</Button>
				{/if}
			{/snippet}
		</EmptyState>
	{:else}
		<CustomBlocks blocks={data.blocks} roles={data.user.roles} />
	{/if}
</PageShell>
