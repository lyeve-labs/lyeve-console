<script lang="ts">
	/**
	 * What a page shows for a feature this instance does not serve.
	 *
	 * The heading names the feature and the line under it says the feature is
	 * not enabled on this instance, whatever the reason. A link appears only
	 * when something says where the feature is turned on: the engine, beside
	 * the refusal, or the license module.
	 */
	import { Badge, EmptyState } from '@lyeve-labs/ui-kit';
	import { Lock } from '@lucide/svelte';
	import { ICON } from '$lib/icon';
	import { useInstance } from '$lib/instance.svelte';
	import { isExternalHref } from '$lib/links';
	import UpgradeLink from '$lib/components/UpgradeLink.svelte';
	import { NOT_ENABLED as STATE, upgradeWords } from '$lib/api/refusal';

	let {
		title,
		description = '',
		url = undefined,
		compact = false,
		level = 3,
		class: cls = '',
	}: {
		/** The feature's name. */
		title: string;
		/** What the feature does, in a sentence or two. */
		description?: string;
		/** The link the engine sent with the refusal or the plugin's status, when it sent one. */
		url?: string | null;
		/** A small marker for a header or a toolbar, in place of the card. */
		compact?: boolean;
		/**
		 * The heading level of the title. 3 by default, for a block inside a
		 * section. A caller placed straight under the page title passes 2.
		 */
		level?: 2 | 3;
		class?: string;
	} = $props();


	const instance = useInstance();
	const target = $derived(instance.upgradeLink(url));
	// Another origin opens in a tab of its own, so it cannot reach back into
	// the admin session through window.opener.
	const away = $derived(target !== null && isExternalHref(target.href));
	// A link that opens a plan or an add-on is named by what it opens, as a
	// refusal names it.
	const targetLabel = $derived(target === null ? '' : upgradeWords(target));
</script>

{#snippet lock()}
	<Lock size={ICON.lg} />
{/snippet}

{#snippet detail()}
	<p>{description}</p>
{/snippet}

{#snippet enable()}
	{#if target}
		<UpgradeLink link={{ href: target.href, label: targetLabel }} />
	{/if}
{/snippet}

{#snippet marker()}
	<Badge tone="neutral"><Lock size={ICON.xs} aria-hidden="true" /> {STATE}</Badge>
{/snippet}

<!-- Tests find every form by the test id, which nothing else carries. -->
{#if compact}
	{#if target}
		<a
			data-testid="not-enabled"
			href={target.href}
			target={away ? '_blank' : undefined}
			rel={away ? 'noopener noreferrer' : undefined}
			title={description || title}
			class="relative hit-area inline-flex rounded-full {cls}"
		>
			{@render marker()}
		</a>
	{:else}
		<span data-testid="not-enabled" title={description || title} class="inline-flex {cls}">
			{@render marker()}
		</span>
	{/if}
{:else}
	<div data-testid="not-enabled" class={cls}>
		<EmptyState
			{title}
			{level}
			description="{STATE}."
			iconSnippet={lock}
			children={description ? detail : undefined}
			action={target ? enable : undefined}
		/>
	</div>
{/if}
