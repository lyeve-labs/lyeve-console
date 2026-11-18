/**
 * Text for a live region, held back until the region has been in the page
 * for two frames.
 *
 * A region that arrives holding its text is not a change, so nothing is read
 * out, and an effect that fills it runs in the same flush as its mount. One
 * frame is not enough either: Firefox builds its accessibility tree after
 * the frame's callbacks run, so a region filled on the first frame reaches
 * it already full and Orca hears nothing. Once the two frames have passed,
 * every change reaches the region as it happens.
 *
 * The region is a spoken copy of text the page draws anyway, so the server
 * renders it empty.
 */
export function liveText(source: () => string): { readonly text: string } {
	let ready = $state(false);
	$effect(() => {
		let frame = requestAnimationFrame(() => {
			frame = requestAnimationFrame(() => (ready = true));
		});
		return () => cancelAnimationFrame(frame);
	});
	return {
		get text() {
			return ready ? source() : '';
		},
	};
}
