<script lang="ts">
	/**
	 * The strip the three search pages carry.
	 *
	 * Running a query is a daily task, and the synonyms, the public search and
	 * the ranking weights are setup. Each is its own route, so a query reloads
	 * only the results and each setting keeps its own load and form actions.
	 */
	import { Tabs } from '@lyeve-labs/ui-kit';
	import { goto } from '$app/navigation';

	interface Props {
		/** Which page is on screen. */
		active: 'search' | 'synonyms' | 'settings';
	}

	let { active }: Props = $props();

	const HREF: Record<string, string> = {
		search: '/admin/search',
		synonyms: '/admin/search/synonyms',
		settings: '/admin/search/settings',
	};

	const items = [
		{ id: 'search', label: 'Search' },
		{ id: 'synonyms', label: 'Synonyms' },
		{ id: 'settings', label: 'Settings' },
	];
</script>

<Tabs {items} {active} onchange={(id) => goto(HREF[id])} />
