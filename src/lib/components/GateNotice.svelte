<script lang="ts">
	/**
	 * What a page shows in place of what a refused read would have filled,
	 * the same way for every page. The page names the feature and says in its
	 * own words what a missing route means for it.
	 */
	import { Alert, Button } from '@lyeve-labs/ui-kit';
	import { RefreshCw } from '@lucide/svelte';
	import { page } from '$app/state';
	import NotEnabled from '$lib/components/NotEnabled.svelte';
	import { ICON } from '$lib/icon';
	import { BUSY, OUTAGE, outageFor } from '$lib/outage';
	import { forbiddenText, fullText, inSentence, type Gate } from '$lib/api/gate';

	let {
		gate,
		title,
		absent,
		level = 3,
	}: {
		gate: Gate;
		/** The feature's name. */
		title: string;
		/** What the page says when the route is not there. */
		absent: string;
		/**
		 * The heading level of the not-enabled state's title. 3 by default, for
		 * a notice inside a section. A caller placed straight under the page
		 * title passes 2.
		 */
		level?: 2 | 3;
	} = $props();

	// The title opens a heading, but these sentences name the feature mid-way.
	const subject = $derived(inSentence(title));

	// A plain link to this address works before the page hydrates. After it
	// hydrates, the router keeps the data it holds for an address that did not
	// change, so the link asks for a fresh document instead.
	const here = $derived(`${page.url.pathname}${page.url.search}`);
</script>

{#snippet retry()}
	<div class="mt-3">
		<Button variant="secondary" size="sm" href={here} data-sveltekit-reload>
			<RefreshCw size={ICON.sm} aria-hidden="true" /> {OUTAGE.action}
		</Button>
	</div>
{/snippet}

{#if gate.state === 'absent'}
	<Alert tone="brand">{absent}</Alert>
{:else if gate.state === 'locked'}
	<NotEnabled {title} {level} url={gate.upgradeUrl} />
{:else if gate.state === 'full'}
	<Alert tone="warn" title="Limit reached for {subject}">{fullText(gate)}</Alert>
{:else if gate.state === 'forbidden'}
	<!-- Trying again cannot change a role, so this one offers nothing to press. -->
	<Alert tone="warn">{forbiddenText(subject)}</Alert>
{:else if gate.state === 'busy'}
	<Alert tone="warn" title={BUSY.title}>
		<p>{BUSY.body}</p>
		{@render retry()}
	</Alert>
{:else if gate.state === 'unavailable'}
	<!-- The page around this notice rendered, so unlike the full-page outage it
	     names only the part that could not be read. -->
	<Alert tone="warn" title={OUTAGE.title}>
		<p>{outageFor(`${subject} did not load`)}</p>
		{@render retry()}
	</Alert>
{:else if gate.state === 'error'}
	<Alert tone="danger">
		<p>{gate.message}</p>
		{@render retry()}
	</Alert>
{/if}
