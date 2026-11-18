/**
 * Which elements start a Svelte transition, for a test that has to tell a
 * surface that enters or leaves through a preset from one that appears or
 * goes in one frame.
 *
 * jsdom animates nothing, so the kit's presets return no time. Svelte still
 * starts each transition it would play in a browser and dispatches
 * `introstart` or `outrostart` on the element. The events do not bubble, so
 * the listener captures them on the document. Whether a transition runs at
 * all, local or global, is still Svelte's decision, which is the part a test
 * here proves.
 */
export interface TransitionWatch {
	/** Elements that started an entrance since the last `clear`. */
	readonly entered: Element[];
	/** Elements that started an exit since the last `clear`. */
	readonly left: Element[];
	clear(): void;
	stop(): void;
}

export function watchTransitions(): TransitionWatch {
	const entered: Element[] = [];
	const left: Element[] = [];
	const onEnter = (e: Event) => entered.push(e.target as Element);
	const onLeave = (e: Event) => left.push(e.target as Element);
	document.addEventListener('introstart', onEnter, true);
	document.addEventListener('outrostart', onLeave, true);
	return {
		entered,
		left,
		clear() {
			entered.length = 0;
			left.length = 0;
		},
		stop() {
			document.removeEventListener('introstart', onEnter, true);
			document.removeEventListener('outrostart', onLeave, true);
		},
	};
}

const HOVER_NEEDS: [RegExp, string][] = [
	[/^hover:(text|bg|border)-/, 'transition-colors'],
	[/^hover:opacity-/, 'transition-opacity'],
];

/**
 * Elements under `root` whose hover changes a color or the opacity with no
 * transition for it, so the change lands in one frame. A bare `transition`
 * covers both.
 */
export function hoverSnaps(root: ParentNode): Element[] {
	return [...root.querySelectorAll('[class*="hover:"]')].filter((el) => {
		const classes = [...el.classList];
		if (classes.includes('transition')) return false;
		return HOVER_NEEDS.some(([hover, needs]) => classes.some((c) => hover.test(c)) && !classes.includes(needs));
	});
}
