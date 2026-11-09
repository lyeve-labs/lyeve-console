<script lang="ts">
	import { Alert } from '@lyeve-labs/ui-kit';
	import RefusalNotice from '$lib/components/RefusalNotice.svelte';
	import type { Refusal } from '$lib/api/refusal';
	import { plural } from '$lib/format';

	/**
	 * The banner an action's failure is announced through.
	 *
	 * The browser's own validation bubble is unstyled, shows one field at a
	 * time and is gone on the next click, so it leaves nothing in the document
	 * to read. An element that carries role="alert" but is not in the
	 * accessibility tree when the failure happens is announced inconsistently.
	 *
	 * The live region below is always mounted, so the text arriving inside it is
	 * a change to a region a screen reader is already watching. `contents` keeps
	 * the wrapper out of the surrounding flex or grid layout, so an empty region
	 * costs no gap.
	 */
	interface Props {
		/** The action's own message, from `fail(400, { error })`. */
		message?: string;
		/** Per-field messages, which the controls render themselves. */
		fields?: Record<string, string>;
		/** A license refusal the action returned, rendered in place of the message. */
		refused?: Refusal | null;
	}

	let { message = undefined, fields = {}, refused = null }: Props = $props();

	const count = $derived(Object.keys(fields).length);

	// The field messages are already beside their controls, so repeating them
	// here would say everything twice. The summary says how many there are, which
	// is what a reader at the top of a form cannot otherwise tell.
	const summary = $derived(
		count === 0 ? '' : `${count} ${plural(count, 'field needs', 'fields need')} attention.`
	);

	const text = $derived([message, summary].filter(Boolean).join(' '));
</script>

<div class="contents" aria-live="assertive" aria-atomic="true">
	{#if refused}
		<RefusalNotice refusal={refused} />
	{:else if text}
		<Alert tone="danger">{text}</Alert>
	{/if}
</div>
