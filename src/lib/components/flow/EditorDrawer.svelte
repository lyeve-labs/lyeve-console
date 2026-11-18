<script lang="ts">
	import { Button, Tabs } from '@lyeve-labs/ui-kit';
	import { ChevronDown, ChevronUp } from '@lucide/svelte';
	import type { Snippet } from 'svelte';
	import { clampDrawerHeight, readDrawerHeight, writeDrawerHeight } from '#lib/flow/drawer.ts';
	import { ICON } from '#lib/icon.ts';

	/**
	 * A pane docked to the bottom of the editor. The kit's Drawer docks to a
	 * side and takes the whole viewport behind a scrim, which is right for a
	 * form and wrong here: the reader wants the run's steps beside the canvas
	 * the pills are painted on, not over it. Its top edge drags, and the
	 * height it lands on is remembered per viewer.
	 */
	interface Props {
		open?: boolean;
		active: string;
		items: { id: string; label: string; count?: number }[];
		onchange: (id: string) => void;
		children: Snippet;
	}

	let { open = $bindable(true), active, items, onchange, children }: Props = $props();

	function storage(): Storage | null {
		try {
			return typeof localStorage === 'undefined' ? null : localStorage;
		} catch {
			return null;
		}
	}

	function windowHeight(): number {
		return typeof window === 'undefined' ? 800 : window.innerHeight;
	}

	let height = $state(readDrawerHeight(storage(), windowHeight()));

	// The drag overlays the height while the pointer moves and writes it once
	// on release, so storage sees one value per gesture.
	let drag = $state<{ startY: number; startHeight: number } | null>(null);

	function startResize(e: PointerEvent) {
		if (e.button !== 0) return;
		e.preventDefault();
		drag = { startY: e.clientY, startHeight: height };
		(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
	}

	function resizeMove(e: PointerEvent) {
		if (!drag) return;
		height = clampDrawerHeight(drag.startHeight + (drag.startY - e.clientY), windowHeight());
	}

	function endResize(e: PointerEvent) {
		if (!drag) return;
		drag = null;
		(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
		writeDrawerHeight(storage(), height);
	}

	/** The keyboard path to the same gesture: arrows resize by a step, Home and End by a lot. */
	function resizeKey(e: KeyboardEvent) {
		const step = e.shiftKey ? 80 : 24;
		let next: number | null = null;
		if (e.key === 'ArrowUp') next = height + step;
		else if (e.key === 'ArrowDown') next = height - step;
		if (next === null) return;
		e.preventDefault();
		height = clampDrawerHeight(next, windowHeight());
		writeDrawerHeight(storage(), height);
	}
</script>

<!-- The height moves on the base rung when the drawer opens or shuts, and not
     while the pointer is dragging the edge, where a transition would lag the
     hand. interpolate-size lets the shut height, which is auto, animate too.
     A browser without it jumps. -->
<section
	class="relative flex shrink-0 flex-col border-t border-line bg-surface [interpolate-size:allow-keywords] {drag
		? ''
		: 'transition-[height] duration-base'}"
	style={open ? `height:${height}px` : ''}
	aria-label="Editor drawer"
	data-testid="editor-drawer"
>
	{#if open}
		<!-- A separator the pointer drags and the keyboard nudges. Sits on the
		     top edge, a little taller than the border so it can be found. -->
		<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<div
			class="absolute -top-1 left-0 right-0 z-10 h-2 cursor-row-resize outline-none hover:bg-brand/40 focus-visible:bg-brand {drag ? 'bg-brand/40' : ''}"
			role="separator"
			aria-orientation="horizontal"
			aria-label="Resize drawer"
			aria-valuenow={height}
			tabindex="0"
			data-testid="drawer-handle"
			onpointerdown={startResize}
			onpointermove={resizeMove}
			onpointerup={endResize}
			onpointercancel={endResize}
			onkeydown={resizeKey}
		></div>
	{/if}
	<div class="flex shrink-0 items-center justify-between pr-2">
		<Tabs
			{items}
			{active}
			class="border-b-0"
			onchange={(id) => {
				onchange(id);
				open = true;
			}}
		/>
		<Button
			variant="ghost"
			size="sm"
			aria-label={open ? 'Collapse drawer' : 'Expand drawer'}
			aria-expanded={open}
			onclick={() => (open = !open)}
		>
			{#if open}<ChevronDown size={ICON.sm} />{:else}<ChevronUp size={ICON.sm} />{/if}
		</Button>
	</div>
	{#if open}
		<div class="min-h-0 flex-1 overflow-hidden border-t border-line">
			{@render children()}
		</div>
	{/if}
</section>
