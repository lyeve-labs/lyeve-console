<script lang="ts">
	import { Button } from '@lyeve-labs/ui-kit';
	import { Maximize2, Minus, Plus } from '@lucide/svelte';
	import { ICON } from '$lib/icon';
	import { MAX_SCALE, MIN_SCALE, clampPan, fitScale, stepScale, zoomAt, type Point, type Size } from './zoom';

	/**
	 * An image a person can inspect: fit, actual size, plus and minus, a
	 * range, the wheel toward the cursor, drag to pan, double click to toggle
	 * between fit and actual size, and the keyboard (+, -, 0 fit, 1 actual
	 * size, arrows pan) while the frame has focus.
	 */
	let { src, alt, naturalWidth = 0, naturalHeight = 0 }: { src: string; alt: string; naturalWidth?: number; naturalHeight?: number } = $props();

	let frameEl = $state<HTMLDivElement | null>(null);
	let frame = $state<Size>({ w: 0, h: 0 });
	let loaded = $state<Size>({ w: 0, h: 0 });
	const image = $derived<Size>(loaded.w > 0 ? loaded : { w: naturalWidth, h: naturalHeight });

	// Null follows the fit, so resizing the drawer keeps a fitted image fitted.
	let chosen = $state<number | null>(null);
	let pan = $state<Point>({ x: 0, y: 0 });
	const fit = $derived(fitScale(image, frame));
	const scale = $derived(chosen ?? fit);
	const percent = $derived(Math.round(scale * 100));
	const frameLabel = $derived(`${alt}, shown at ${percent}%. Scroll or press plus and minus to zoom, drag or use the arrow keys to pan.`);
	const zoomed = $derived(image.w * scale > frame.w + 1 || image.h * scale > frame.h + 1);

	$effect(() => {
		if (!frameEl) return;
		const r = frameEl.getBoundingClientRect();
		frame = { w: r.width, h: r.height };
		if (typeof ResizeObserver === 'undefined') return;
		const ro = new ResizeObserver(([e]) => {
			frame = { w: e.contentRect.width, h: e.contentRect.height };
			pan = clampPan(pan, scale, image, frame);
		});
		ro.observe(frameEl);
		return () => ro.disconnect();
	});

	// Svelte attaches onwheel as a passive listener, and a passive listener
	// cannot stop the drawer scrolling under the zoom.
	$effect(() => {
		if (!frameEl) return;
		frameEl.addEventListener('wheel', onwheel, { passive: false });
		return () => frameEl?.removeEventListener('wheel', onwheel);
	});

	// Read from the element rather than an onload attribute: server rendering
	// writes that attribute inline, and the policy refuses inline handlers.
	let imgEl = $state<HTMLImageElement | null>(null);
	$effect(() => {
		const el = imgEl;
		if (!el) return;
		const read = () => (loaded = { w: el.naturalWidth, h: el.naturalHeight });
		if (el.complete && el.naturalWidth) read();
		el.addEventListener('load', read);
		return () => el.removeEventListener('load', read);
	});

	// A new image starts fitted.
	let shown = '';
	$effect(() => {
		if (src !== shown) {
			shown = src;
			chosen = null;
			pan = { x: 0, y: 0 };
		}
	});

	function center(): Point {
		return { x: frame.w / 2, y: frame.h / 2 };
	}

	function setScale(next: number, at: Point = center()) {
		const r = zoomAt(scale, next, at, pan, image, frame);
		chosen = r.scale;
		pan = r.pan;
	}

	function fitView() {
		chosen = null;
		pan = { x: 0, y: 0 };
	}

	function local(e: MouseEvent): Point {
		const r = frameEl!.getBoundingClientRect();
		return { x: e.clientX - r.left, y: e.clientY - r.top };
	}

	function onwheel(e: WheelEvent) {
		e.preventDefault();
		// A trackpad sends many small deltas and a mouse a few large ones. The
		// exponent makes both land on the same zoom per distance scrolled.
		setScale(scale * Math.exp(-e.deltaY * 0.0015), local(e));
	}

	let drag: { from: Point; pan: Point } | null = null;
	let dragging = $state(false);
	function onpointerdown(e: PointerEvent) {
		if (!zoomed || e.button !== 0) return;
		frameEl!.setPointerCapture(e.pointerId);
		drag = { from: { x: e.clientX, y: e.clientY }, pan };
		dragging = true;
	}
	function onpointermove(e: PointerEvent) {
		if (!drag) return;
		pan = clampPan({ x: drag.pan.x + e.clientX - drag.from.x, y: drag.pan.y + e.clientY - drag.from.y }, scale, image, frame);
	}
	function onpointerup(e: PointerEvent) {
		if (!drag) return;
		frameEl!.releasePointerCapture(e.pointerId);
		drag = null;
		dragging = false;
	}

	function ondblclick(e: MouseEvent) {
		if (chosen === null && fit < 1) setScale(1, local(e));
		else fitView();
	}

	function onkeydown(e: KeyboardEvent) {
		const nudge = 40;
		const keys: Record<string, () => void> = {
			'+': () => setScale(stepScale(scale, 1)),
			'=': () => setScale(stepScale(scale, 1)),
			'-': () => setScale(stepScale(scale, -1)),
			'0': fitView,
			'1': () => setScale(1),
			ArrowLeft: () => (pan = clampPan({ x: pan.x + nudge, y: pan.y }, scale, image, frame)),
			ArrowRight: () => (pan = clampPan({ x: pan.x - nudge, y: pan.y }, scale, image, frame)),
			ArrowUp: () => (pan = clampPan({ x: pan.x, y: pan.y + nudge }, scale, image, frame)),
			ArrowDown: () => (pan = clampPan({ x: pan.x, y: pan.y - nudge }, scale, image, frame)),
		};
		const run = keys[e.key];
		if (run) {
			e.preventDefault();
			run();
		}
	}

	// The range works in log space, so each notch is the same visual step at
	// 10% and at 400%.
	const logMin = Math.log(MIN_SCALE);
	const logMax = Math.log(MAX_SCALE);
	const rangeValue = $derived(Math.round(((Math.log(scale) - logMin) / (logMax - logMin)) * 1000));
	function onrange(e: Event) {
		const v = Number((e.currentTarget as HTMLInputElement).value) / 1000;
		setScale(Math.exp(logMin + v * (logMax - logMin)));
	}
</script>

<div class="flex w-full flex-col gap-3">
	<!-- The frame is focusable and answers the keyboard itself (plus, minus,
	     0, 1 and the arrows), which is the point of role="application". The
	     rule does not count that role as interactive. -->
	<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
	<div
		bind:this={frameEl}
		data-testid="media-zoom"
		data-scale={scale.toFixed(3)}
		role="application"
		aria-roledescription="image viewer"
		aria-label={frameLabel}
		tabindex="0"
		class="relative h-[60vh] w-full touch-none select-none overflow-hidden rounded-lg bg-surface-2/50 outline-none focus-visible:ring-2 focus-visible:ring-focus {zoomed ? (dragging ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-zoom-in'}"
		{onpointerdown}
		{onpointermove}
		{onpointerup}
		onpointercancel={onpointerup}
		{ondblclick}
		{onkeydown}
	>
		<img
			{src}
			{alt}
			decoding="async"
			draggable="false"
			class="pointer-events-none absolute left-1/2 top-1/2 max-w-none"
			style="width: {image.w ? `${image.w}px` : 'auto'}; transform: translate(-50%, -50%) translate({pan.x}px, {pan.y}px) scale({scale}); transform-origin: center;"
			bind:this={imgEl}
		/>
	</div>

	<div class="flex flex-wrap items-center gap-2" role="group" aria-label="Zoom">
		<Button variant="ghost" size="sm" type="button" aria-label="Zoom out" disabled={scale <= MIN_SCALE} onclick={() => setScale(stepScale(scale, -1))}>
			<Minus size={ICON.sm} />
		</Button>
		<input
			type="range"
			min="0"
			max="1000"
			value={rangeValue}
			oninput={onrange}
			aria-label="Zoom level"
			aria-valuetext="{percent}%"
			class="w-40 accent-brand"
		/>
		<Button variant="ghost" size="sm" type="button" aria-label="Zoom in" disabled={scale >= MAX_SCALE} onclick={() => setScale(stepScale(scale, 1))}>
			<Plus size={ICON.sm} />
		</Button>
		<span class="w-14 text-center font-mono text-xs text-muted" aria-live="polite">{percent}%</span>
		<Button variant="secondary" size="sm" type="button" onclick={fitView} disabled={chosen === null}>
			<Maximize2 size={ICON.sm} /> Fit
		</Button>
		<Button variant="secondary" size="sm" type="button" onclick={() => setScale(1)} disabled={Math.abs(scale - 1) < 0.001}>100%</Button>
		<span class="ms-auto text-xs text-faint">Scroll to zoom, drag to pan, double click to switch between fit and 100%.</span>
	</div>
</div>
