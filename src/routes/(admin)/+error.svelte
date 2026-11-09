<script lang="ts">
	import { page } from '$app/state';
	import { PageShell } from '@lyeve-labs/ui-kit';
	import ErrorPanel from '$lib/components/ErrorPanel.svelte';
	import { BUSY, OUTAGE } from '$lib/outage';

	// SvelteKit passes no props to +error.svelte. The status and the error body
	// are only reachable through the page state.
	const status = $derived(page.status);
	const message = $derived(page.error?.message ?? '');
</script>

<!-- Inside the console's frame, so it takes the page gutter and rhythm every
     other screen takes rather than centering itself in a viewport it does not
     own. -->
<PageShell
	title="Could not open this page"
	documentTitle={status === 404
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
	titleHidden
	width="wide"
>
	<ErrorPanel level={2} {status} {message} homeHref="/admin" homeLabel="Dashboard" />
</PageShell>
