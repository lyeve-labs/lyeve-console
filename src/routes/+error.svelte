<script lang="ts">
	import PageTitle from '$lib/components/PageTitle.svelte';
	import { page } from '$app/state';
	import ErrorPanel from '$lib/components/ErrorPanel.svelte';
	import { BUSY, OUTAGE } from '$lib/outage';

	const status = $derived(page.status);
	const message = $derived(page.error?.message ?? '');
</script>

<PageTitle
	title={status === 404
		? 'Not found'
		: status === 401
			? 'Not signed in'
			: status === 402 || status === 403
				? 'No access'
				: status === 429
					? BUSY.title
					: status === 503
						? OUTAGE.title
						: 'Could not open this page'}
/>

<!-- Outside the console's frame, so this one does own the viewport and centers
     itself in it. -->
<div class="flex min-h-screen items-center justify-center px-page-x py-page-y">
	<!-- Hidden, as the console's error page hides its title, so a screen
	     reader's heading list still starts at an h1. -->
	<h1 class="sr-only">Could not open this page</h1>
	<ErrorPanel level={2} {status} {message} homeHref="/" homeLabel="Home" />
</div>
