<script lang="ts">
	/**
	 * A text link to where a refused feature is turned on or its limit
	 * raised, for a refusal drawn as a sentence or a line in a form, where
	 * UpgradeLink's button would stand out as a second action. A link to
	 * another origin opens in a tab of its own, so it cannot reach back into
	 * the admin session through window.opener.
	 */
	import type { InstanceLink } from '#lib/instance.svelte.ts';
	import { isExternalHref } from '#lib/links.ts';
	import { upgradeWords } from '#lib/api/refusal.ts';

	let {
		link,
		raises = false,
		standalone = false,
	}: {
		link: InstanceLink;
		/** The refusal is at a ceiling, so the words ask to raise it. */
		raises?: boolean;
		/** The link sits on a line of its own, where a finger needs the room. */
		standalone?: boolean;
	} = $props();

	const away = $derived(isExternalHref(link.href));
</script>

<a
	class={standalone ? 'relative hit-area self-start text-sm underline' : 'ml-1 underline'}
	href={link.href}
	target={away ? '_blank' : undefined}
	rel={away ? 'noopener noreferrer' : undefined}>{upgradeWords(link, raises)}</a
>
