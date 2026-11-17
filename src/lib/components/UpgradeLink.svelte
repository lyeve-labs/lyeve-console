<script lang="ts">
	/**
	 * The button that leads to where a feature is turned on, as the engine or
	 * the license module names it. A link to another origin opens in a tab of
	 * its own, so it cannot reach back into the admin session through
	 * window.opener.
	 */
	import type { ComponentProps } from 'svelte';
	import { Button } from '@lyeve-labs/ui-kit';
	import type { InstanceLink } from '#lib/instance.svelte.ts';
	import { isExternalHref } from '#lib/links.ts';

	type ButtonProps = ComponentProps<typeof Button>;

	let {
		link,
		variant = 'secondary',
		size = undefined,
	}: {
		link: InstanceLink;
		variant?: ButtonProps['variant'];
		size?: ButtonProps['size'];
	} = $props();

	const away = $derived(isExternalHref(link.href));
</script>

<Button
	{variant}
	{size}
	href={link.href}
	target={away ? '_blank' : undefined}
	rel={away ? 'noopener noreferrer' : undefined}
>
	{link.label ?? 'How to enable it'}
</Button>
