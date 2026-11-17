<script lang="ts">
	import { AuthShell, Logo } from '@lyeve-labs/ui-kit';
	import type { Snippet } from 'svelte';
	import { page } from '$app/state';
	import { accentStyle } from '#lib/api/customization.ts';
	import { pageBrand } from '#lib/brand.ts';

	interface Props {
		/** The one heading on the page. Sign-in swaps it for the second factor step. */
		title: string;
		description?: string;
		children: Snippet;
	}

	let { title, description = undefined, children }: Props = $props();

	// The tenant's brand, read by the root layout without a session, so a
	// reader signs in to the admin they recognize. Unset parts fall back to the
	// product's own.
	const brand = $derived(pageBrand(page.data));
	const accent = $derived(brand?.accent ? accentStyle(brand.accent) : '');
	const branded = $derived(!!(brand?.logo_url || brand?.name));
</script>

<!--
	The kit's signed-out frame, with the tenant's lockup in place of the
	product's and the tenant's accent scoped to the page. Without a tenant
	brand the kit draws the product mark.
-->
<AuthShell
	{title}
	{description}
	lockup={branded ? tenantLockup : undefined}
	class={accent ? 'tenant-accent' : ''}
	style={accent || undefined}
>
	{@render children()}
</AuthShell>

<!-- The same lockup as the product's: a 36px mark and the name beside it. A
     tenant logo keeps its own proportions inside that height. -->
{#snippet tenantLockup()}
	<span class="inline-flex items-center gap-2" data-testid="tenant-brand">
		{#if brand?.logo_url}
			<img src={brand.logo_url} alt={brand.name ? '' : 'Logo'} class="h-9 max-w-48 object-contain" />
		{:else}
			<Logo size="lg" wordmark={false} />
		{/if}
		{#if brand?.name}
			<span class="text-xl font-semibold text-fg">{brand.name}</span>
		{/if}
	</span>
{/snippet}
