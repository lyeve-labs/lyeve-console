<script lang="ts">
	// The tab title for a page that renders no PageShell: the error page and
	// the signed-out cards. A PageShell titles the tab itself, in the format
	// the root layout states, which is this one.
	import { page } from '$app/state';
	import { documentTitle, pageBrand } from '#lib/brand.ts';

	interface Props {
		/** The page's own part of the tab title. Empty leaves the name alone. */
		title?: string;
	}

	let { title = '' }: Props = $props();

	// The nearest layout's brand: the session tenant's inside the admin, the
	// public one outside it. A test that mocks the page state may leave the
	// data out, which reads as the stock name.
	const text = $derived(documentTitle(pageBrand(page.data), title));
</script>

<svelte:head>
	<title>{text}</title>
</svelte:head>
