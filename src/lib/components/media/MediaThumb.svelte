<script lang="ts">
	import { File, FileText, Film, Image, Music } from '@lucide/svelte';
	import { brokenImage } from '#lib/broken-image.ts';
	import { mediaKind, mediaThumbnailUrl, type MediaItem, type MediaKind } from '#lib/api/media.ts';

	interface Props {
		item: MediaItem;
		/** Sizes the glyph a non-image shows in place of a picture. */
		glyph?: number;
		class?: string;
	}

	let { item, glyph = 28, class: klass = '' }: Props = $props();

	// An item the library still lists can be gone by the time the browser asks
	// for its bytes, so a failed thumbnail falls back to the type glyph instead
	// of the browser's broken-image chrome.
	let broken = $state(false);

	const kind = $derived(mediaKind(item.content_type));
	const src = $derived(mediaThumbnailUrl(item));

	const GLYPHS: Record<MediaKind, typeof File> = {
		image: Image,
		video: Film,
		audio: Music,
		pdf: FileText,
		other: File,
	};
	const Glyph = $derived(GLYPHS[kind]);
</script>

<!-- The error listener sits on this wrapper, not on the <img>. Svelte's server
     renderer stamps an inline onerror onto any <img> carrying a handler or a
     use: directive, and the admin's CSP blocks an inline handler that no nonce
     can cover. -->
<div
	data-kind={kind}
	class="flex items-center justify-center overflow-hidden bg-surface-2/50 {klass}"
	use:brokenImage={() => (broken = true)}
>
	{#if src && !broken}
		<!-- The filename sits beside every thumbnail, so the picture only repeats
		     it unless the operator wrote alt text of their own. -->
		<img
			{src}
			alt={item.alt_text}
			class="h-full w-full object-cover"
			loading="lazy"
			decoding="async"
		/>
	{:else}
		<Glyph size={glyph} class="text-faint" aria-hidden="true" />
	{/if}
</div>
