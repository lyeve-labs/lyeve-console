<script lang="ts">
	import { navigating } from '$app/state';
	import { Progress } from '@lyeve-labs/ui-kit';

	/**
	 * A bar across the top of the window while a navigation is in flight.
	 *
	 * Without it, a slow page reads as a dead link and is clicked again.
	 *
	 * It waits before it appears. A navigation that resolves in a frame needs no
	 * announcement, and a bar that flashes on every click is worse than no bar:
	 * the delay is the difference between reporting work and adding noise.
	 *
	 * The bar is the kit's indeterminate Progress, which under reduced motion
	 * rests its segment in the middle of the track, so it still reads as busy.
	 */
	const APPEAR_AFTER = 180;

	let visible = $state(false);
	// The bar stays mounted through its fade out, and only then goes, so its
	// loop does not run behind an invisible frame.
	let mounted = $state(false);

	$effect(() => {
		if (!navigating.to) {
			visible = false;
			return;
		}
		const timer = setTimeout(() => {
			visible = mounted = true;
		}, APPEAR_AFTER);
		return () => clearTimeout(timer);
	});

	// Visibility flips at the end of the fade, so its transitionend is the one
	// that means the frame is gone. A canceled transition never finished.
	function settled(e: TransitionEvent) {
		if (e.target === e.currentTarget && e.propertyName === 'visibility' && !visible) mounted = false;
	}
</script>

<!-- The frame stays mounted and fades in CSS. The page swap runs every preset
     exit in no time for the frame the new page lands in, which is the frame
     this bar leaves, so a preset would snap it shut. The progress bar carries
     its name and is not a live region: announcing every navigation would
     interrupt the page it is reporting on. The label row is for sight and is
     hidden here, where a word would cover the page. -->
<div
	class="fixed inset-x-0 top-0 z-toast transition-[opacity,visibility] {visible
		? 'duration-base ease-enter'
		: 'invisible opacity-0 duration-fast ease-exit'}"
	data-print="hide"
	data-testid="route-progress"
	ontransitionend={settled}
>
	{#if mounted}
		<Progress indeterminate size="xs" label="Loading the page" class="[&>:not([role=progressbar])]:sr-only" />
	{/if}
</div>
