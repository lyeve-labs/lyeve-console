<script lang="ts">
	/**
	 * The strip the three cache pages carry.
	 *
	 * Provider health, the response cache rules and the stored entries are one
	 * plugin, so they share one strip. Each is its own route with its own load
	 * and form actions, so the stored list pages without reloading the rest.
	 */
	import { Tabs } from '@lyeve-labs/ui-kit';
	import { goto } from '$app/navigation';

	interface Props {
		/** Which page is on screen. */
		active: 'overview' | 'rules' | 'stored';
		/** Response cache rules, when the page has already read them. */
		rules?: number;
		/** Stored entries, when the page has already read the total. */
		stored?: number;
	}

	let { active, rules, stored }: Props = $props();

	const HREF: Record<string, string> = {
		overview: '/admin/observability/cache',
		rules: '/admin/observability/cache/rules',
		stored: '/admin/observability/cache/stored',
	};

	const items = $derived([
		{ id: 'overview', label: 'Overview' },
		{ id: 'rules', label: 'Response cache rules', count: rules },
		{ id: 'stored', label: 'Stored', count: stored },
	]);
</script>

<Tabs {items} {active} onchange={(id) => goto(HREF[id])} />
