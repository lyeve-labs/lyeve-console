<script lang="ts">
	/**
	 * What the shell shows in place of a page whose plugin does not run.
	 *
	 * Every reader is told the page is unavailable, and that it was withheld
	 * from this tenant when it was. An operator reads the plugin status, so an
	 * operator is also told why: the plugin failed to start, is not enabled on
	 * this instance, was not started, or is not part of this build.
	 */
	import { Button, EmptyState } from '@lyeve-labs/ui-kit';
	import { Ban, CircleSlash, OctagonAlert, PackageX, PowerOff } from '@lucide/svelte';
	import NotEnabled from '$lib/components/NotEnabled.svelte';
	import { ICON } from '$lib/icon';
	import type { NotRunningReason } from '$lib/plugins';

	let {
		title,
		plugin,
		reason,
		operator = false,
		level = 3,
	}: {
		/** The page's name. */
		title: string;
		/** The plugin the page belongs to. */
		plugin: string;
		reason: NotRunningReason;
		/** Whether the reader may open the plugin list, where the details are. */
		operator?: boolean;
		/**
		 * The heading level of the title. 3 by default, for a block inside a
		 * section. A caller placed straight under the page title passes 2.
		 */
		level?: 2 | 3;
	} = $props();

	const details = $derived(`/admin/plugins/${encodeURIComponent(plugin)}`);
</script>

{#snippet detailsLink()}
	<Button variant="secondary" href={details}>Plugin details</Button>
{/snippet}

<!-- Tests find every case by the test id, and tell them apart by the state. -->
<div data-testid="not-running" data-state={reason.state} data-plugin={plugin}>
	{#if reason.state === 'withheld'}
		<EmptyState
			{level}
			title="Turned off for this tenant"
			description="{title} is turned off for this tenant. Ask a super admin to turn it back on."
		>
			{#snippet iconSnippet()}<Ban size={ICON.lg} />{/snippet}
		</EmptyState>
	{:else if reason.state === 'not-enabled'}
		<NotEnabled {title} {level} url={reason.upgradeUrl} />
	{:else if reason.state === 'failed'}
		<EmptyState
			{level}
			title="Stopped at startup"
			description="The {plugin} plugin stopped with an error at startup."
			action={detailsLink}
		>
			{#snippet iconSnippet()}<OctagonAlert size={ICON.lg} />{/snippet}
			{#if reason.error}
				<code class="break-words font-mono text-xs text-fg">{reason.error}</code>
			{/if}
		</EmptyState>
	{:else if reason.state === 'not-started'}
		<EmptyState
			{level}
			title="Not started"
			description="The {plugin} plugin is included in this build but did not start."
			action={detailsLink}
		>
			{#snippet iconSnippet()}<PowerOff size={ICON.lg} />{/snippet}
			{#if reason.reason}
				<p>Reason: {reason.reason}.</p>
			{/if}
		</EmptyState>
	{:else if reason.state === 'not-built'}
		<EmptyState
			{level}
			title="Not part of this build"
			description="The {plugin} plugin is not included in this build."
		>
			{#snippet iconSnippet()}<PackageX size={ICON.lg} />{/snippet}
		</EmptyState>
	{:else}
		<EmptyState
			{level}
			title="Not running"
			description={operator
				? 'The plugin behind this page is not running.'
				: 'The plugin behind this page is not running. Ask an administrator why.'}
			action={operator ? detailsLink : undefined}
		>
			{#snippet iconSnippet()}<CircleSlash size={ICON.lg} />{/snippet}
		</EmptyState>
	{/if}
</div>
