<script lang="ts">
	/**
	 * A write the engine refused for the license, said the same way on every
	 * page: the count against the ceiling for a cap, the capability's name for
	 * a feature, and a link to where the license is read and changed. Every
	 * number comes from the refusal, so a lifted ceiling never reads as a
	 * stale one here.
	 */
	import { Alert, Button } from '@lyeve-labs/ui-kit';
	import { useInstance } from '#lib/instance.svelte.ts';
	import UpgradeLink from '#lib/components/UpgradeLink.svelte';
	import { LICENSE_PAGE, refusalText, refusalTitle, upgradeWords, type Refusal } from '#lib/api/refusal.ts';

	let {
		refusal,
		lead = false,
	}: {
		refusal: Refusal;
		/**
		 * True where the way forward is the one action on its surface. A
		 * surface holds one primary, and the notice usually sits in a drawer or
		 * a page that has its own Create or Save, so by default its links stay
		 * below that: the way forward secondary and the license page ghost.
		 */
		lead?: boolean;
	} = $props();

	const instance = useInstance();
	// The license page is always offered. A link the engine or the license
	// module names elsewhere is where more is bought or the feature turned
	// on, so it is the way forward and leads, named by what it opens.
	const upgrade = $derived(instance.upgradeLink(refusal.upgradeUrl || null));
	const offered = $derived(
		upgrade !== null && upgrade.href !== LICENSE_PAGE
			? {
					href: upgrade.href,
					label: upgradeWords(upgrade, refusal.kind === 'cap'),
				}
			: null,
	);
</script>

<div data-testid="refusal-notice">
	<Alert tone="warn" title={refusalTitle(refusal)}>
		<p>{refusalText(refusal)}</p>
		<div class="mt-3 flex flex-wrap gap-2">
			{#if offered}
				<UpgradeLink link={offered} variant={lead ? 'primary' : 'secondary'} size="sm" />
			{/if}
			<Button variant={offered && !lead ? 'ghost' : 'secondary'} size="sm" href={LICENSE_PAGE}>View the license</Button>
		</div>
	</Alert>
</div>
