<script lang="ts">
	import { page } from '$app/state';
	import { Alert, Breadcrumb, PageShell } from '@lyeve-labs/ui-kit';
	import ErrorPanel from '#lib/components/ErrorPanel.svelte';
	import { BUSY, OUTAGE } from '#lib/outage.ts';
	import { crumbsAfter } from '#lib/breadcrumb.ts';

	/*
	 * A refused entry or new entry draws inside the content type's frame, the
	 * way the entry list draws its refusal: the type as the title of the page
	 * and the tab, the way back, and the sentence. Every other failure keeps
	 * the console's error panel.
	 */
	const status = $derived(page.status);
	const message = $derived(page.error?.message ?? '');
	const subject = $derived(page.error?.subject || page.params.schema || 'Content');
	const back = $derived({ href: '/admin/content', label: 'Content' });
</script>

{#if status === 403}
	<PageShell title={subject} width="wide" {back}>
		{#snippet breadcrumb()}
			<Breadcrumb items={crumbsAfter(back, [{ label: 'Content', href: '/admin/content' }, { label: subject }])} />
		{/snippet}
		<!-- Trying again cannot change a role, so this offers nothing to press. -->
		<Alert tone="warn">{message}</Alert>
	</PageShell>
{:else}
	<PageShell
		title="Could not open this page"
		documentTitle={status === 404
			? 'Not found'
			: status === 401
				? 'Not signed in'
				: status === 402
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
{/if}
