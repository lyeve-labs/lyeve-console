<script lang="ts">
	/**
	 * The strip the three tenant cost pages carry.
	 *
	 * This month's spend is a reading, and budgets and prices are two settings
	 * changed at different times, so each is a page with its own load and its
	 * own form actions.
	 */
	import { Tabs } from '@lyeve-labs/ui-kit';
	import { goto } from '$app/navigation';

	interface Props {
		/** Which page is on screen. */
		active: 'month' | 'budgets' | 'prices';
	}

	let { active }: Props = $props();

	const HREF: Record<string, string> = {
		month: '/admin/tenants/costs',
		budgets: '/admin/tenants/costs/budgets',
		prices: '/admin/tenants/costs/prices'
	};

	const items = [
		{ id: 'month', label: 'This month' },
		{ id: 'budgets', label: 'Budgets' },
		{ id: 'prices', label: 'Prices' }
	];
</script>

<Tabs {items} {active} onchange={(id) => goto(HREF[id])} />
