<script lang="ts">
	import type { Snippet } from 'svelte';
	import ResizableAside from '#lib/components/ResizableAside.svelte';
	import { PANEL, PANEL_KEY, type PanelName } from '#lib/flow/prefs.ts';

	/**
	 * A panel docked to one side of the canvas: the shared aside with the
	 * editor's bounds, the toolbar overlay below xl, and a strip to collapse to
	 * above it.
	 */
	interface Props {
		name: PanelName;
		/** The word on the strip and the header. */
		label: string;
		/** Which edge of the canvas it docks to. The handle sits on the other edge. */
		side: 'start' | 'end';
		/** Expanded above xl:. Bindable so the page can open it from an offer. */
		open?: boolean;
		/** Shown as an overlay below xl:. */
		overlay?: boolean;
		children: Snippet;
	}

	let { name, label, side, open = $bindable(true), overlay = false, children }: Props = $props();
</script>

<ResizableAside
	storageKey={PANEL_KEY[name]}
	{label}
	{side}
	width={PANEL[name].width}
	min={PANEL[name].min}
	max={PANEL[name].max}
	breakpoint="xl"
	below="overlay"
	{overlay}
	collapsible
	bind:open
	testId="panel-{name}"
>
	{@render children()}
</ResizableAside>
