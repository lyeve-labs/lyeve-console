<script lang="ts">
	import { Card } from '@lyeve-labs/ui-kit';
	import type { MediaItem } from '#lib/api/media.ts';
	import { formatBytes } from '#lib/format.ts';
	import MediaThumb from './MediaThumb.svelte';

	interface Props {
		items: MediaItem[];
		onselect: (item: MediaItem) => void;
	}

	let { items, onselect }: Props = $props();
</script>

<!-- Two columns at the narrowest width, so a phone shows a tile the thumb can
     read without the row scrolling sideways. -->
<div
	data-testid="media-grid"
	role="list"
	class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6"
>
	{#each items as item (item.id)}
		<div role="listitem">
			<!-- The tile is the control and holds no other one. Copy and delete
			     on a hover overlay would be unreachable on touch and invisible to
			     a keyboard until focus landed inside, so they live in the
			     preview, which the tile opens. -->
			<Card pad="none" hover class="h-full" onclick={() => onselect(item)}>
				<MediaThumb {item} class="aspect-square w-full" />
				<div class="p-2">
					<p class="truncate text-xs text-fg" title={item.filename}>{item.filename}</p>
					<p class="mt-0.5 text-xs text-faint">{formatBytes(item.size, 'MB')}</p>
				</div>
			</Card>
		</div>
	{/each}
</div>
