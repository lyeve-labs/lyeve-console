<script lang="ts">
	/**
	 * The strip both Builder connections pages carry, for the owner roles only.
	 *
	 * Anyone at editor or above approves and revokes their own connections.
	 * The tenant's builder settings are a page of their own that only an owner
	 * may open, so a person below owner has one page and no strip at all.
	 */
	import { Tabs } from '@lyeve-labs/ui-kit';
	import { goto } from '$app/navigation';

	interface Props {
		/** Which page is on screen. */
		active: 'connections' | 'builder';
		/** Whether the person holds an owner role. */
		owner: boolean;
	}

	let { active, owner }: Props = $props();

	const HREF: Record<string, string> = {
		connections: '/admin/settings/connected-editors',
		builder: '/admin/settings/connected-editors/builder',
	};

	const items = [
		{ id: 'connections', label: 'Connections' },
		{ id: 'builder', label: 'Builder settings' },
	];
</script>

{#if owner}
	<Tabs {items} {active} onchange={(id) => goto(HREF[id])} />
{/if}
