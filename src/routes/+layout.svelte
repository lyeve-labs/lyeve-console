<script lang="ts">
	import '../app.css';
	import { getThemePreference, setDocumentTitleFormat, setThemePreference, watchSystemTheme } from '@lyeve-labs/ui-kit';
	import type { Snippet } from 'svelte';
	import { page } from '$app/state';
	import { asset } from '$app/paths';
	import { onNavigate } from '$app/navigation';
	import { fadeRouteChange } from '#lib/page-transition.ts';
	import { documentTitle, pageBrand } from '#lib/brand.ts';

	let { children }: { children: Snippet } = $props();

	onNavigate(fadeRouteChange);

	// Every PageShell below titles the browser tab from its own title, ended
	// with the name the admin goes by. It reads the nearest layout's brand, so
	// a signed-in tab carries the tenant's name and a signed-out one the
	// public brand. A page with no PageShell renders PageTitle, which writes
	// the same format.
	setDocumentTitleFormat((title) => documentTitle(pageBrand(page.data), title));

	// The nearest layout's brand decides the tab icon: the session tenant's
	// inside the admin, the public one outside it. Without one the product's
	// icons stand.
	const favicon = $derived(pageBrand(page.data)?.favicon_url || '');

	// A reader who asked to follow the desktop gets the new palette when the
	// desktop flips at dusk. The kit's toggle watches for that while it is
	// mounted, and it is mounted only inside the authed frame: sign-in, first-run
	// setup and the error pages sit outside that frame and would otherwise hold
	// whatever palette they booted with for the life of the tab.
	//
	// The first paint needs nothing here. The pre-paint script in app.html has
	// already put the resolved palette on the document element, and re-applying
	// it on mount would persist `system` as a choice for a reader who has not
	// made one yet.
	$effect(() =>
		watchSystemTheme(() => {
			if (getThemePreference() === 'system') setThemePreference('system');
		}),
	);
</script>

<svelte:head>
	{#if favicon}
		<link rel="icon" href={favicon} />
	{:else}
		<link rel="icon" href={asset('/favicon.ico')} sizes="32x32" />
		<link rel="icon" href={asset('/favicon.svg')} type="image/svg+xml" />
	{/if}
</svelte:head>

{@render children()}
