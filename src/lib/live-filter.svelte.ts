import { tick, untrack } from 'svelte';

/** How long typing pauses before the search runs. */
export const SEARCH_DELAY = 300;

/**
 * A list's GET filter form that applies as the reader types and as each
 * filter changes, with no Search or Apply button.
 *
 *     const live = liveFilter(() => data.q);
 *     // Not named search: a search snippet in the markup would shadow it.
 *     <form method="GET" {@attach live.form}>
 *       <SearchInput name="q" bind:value={live.value} oninput={live.input} />
 *       <Select name="level" onvaluechange={live.apply} ... />
 *
 * The filter stays in the URL, so a filtered view is still a link and Enter
 * still submits the form without JavaScript.
 *
 * Typing waits for a pause before it loads, so a half-typed word does not
 * load a list for every keystroke, and a query equal to the one already
 * loaded or asked for loads nothing. The field's own clear runs at once and
 * puts focus back in the field, because its button goes away with the text.
 * Enter submits at once and drops the wait. Each load keeps focus and the
 * caret where they are, replaces the history entry and leaves the scroll
 * position alone, so the list changes under the field rather than the page
 * moving.
 *
 * `value` is re-read from the load whenever a navigation changes it, such as
 * the back button or a link that carries another query. A load this field
 * asked for leaves it alone, so what the reader typed while that load ran is
 * not overwritten by the shorter query it was sent with.
 */
export function liveFilter(loaded: () => string, { name = 'q', delay = SEARCH_DELAY } = {}) {
	let value = $state(untrack(loaded));
	let form: HTMLFormElement | null = null;
	let timer: ReturnType<typeof setTimeout> | undefined;
	// The query of the load in flight, until it lands.
	let sent: string | null = null;

	$effect.pre(() => {
		const q = loaded();
		untrack(() => {
			const ours = sent !== null && q.trim() === sent;
			sent = null;
			if (!ours) value = q;
		});
	});

	const field = () => {
		const el = form?.elements.namedItem(name);
		return el instanceof HTMLInputElement ? el : null;
	};
	const typed = () => (field()?.value ?? '').trim();

	function cancel() {
		clearTimeout(timer);
		timer = undefined;
	}

	function search() {
		cancel();
		if (!form || typed() === (sent ?? loaded().trim())) return;
		form.requestSubmit();
	}

	function onsubmit() {
		cancel();
		sent = typed();
	}

	return {
		/** The text in the field. Bind the search control to it. */
		get value() {
			return value;
		},
		set value(next: string) {
			value = next;
		},
		/** The search control's `oninput`. */
		input(next: string) {
			cancel();
			if (next === '') field()?.focus();
			// The control has not written its field yet when it reports a clear.
			timer = setTimeout(search, next === '' ? 0 : delay);
		},
		/** A filter control's change handler. Submits once the control has written its field. */
		async apply() {
			cancel();
			await tick();
			form?.requestSubmit();
		},
		/** Attach to the GET form. */
		form(node: HTMLFormElement) {
			form = node;
			node.setAttribute('data-sveltekit-keepfocus', '');
			node.setAttribute('data-sveltekit-replacestate', '');
			node.setAttribute('data-sveltekit-noscroll', '');
			node.addEventListener('submit', onsubmit);
			return () => {
				cancel();
				node.removeEventListener('submit', onsubmit);
				form = null;
			};
		},
	};
}
