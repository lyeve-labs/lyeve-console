<script lang="ts">
	/**
	 * The strip the three request capture pages carry.
	 *
	 * The captures, the rules that decide which requests are kept and the sets
	 * replayed together are one plugin, so they share one strip. Each is its own
	 * route with its own load and form actions, and a page of captures stays a
	 * link somebody can keep.
	 */
	import { Tabs } from '@lyeve-labs/ui-kit';
	import { goto } from '$app/navigation';

	interface Props {
		/** Which page is on screen. */
		active: 'captures' | 'rules' | 'sets';
		/** Captures, when the page has already read the total. */
		captures?: number;
		/** Capture rules, when the page has already read them. */
		rules?: number;
		/** Replay sets, when the page has already read them. */
		sets?: number;
	}

	let { active, captures, rules, sets }: Props = $props();

	const HREF: Record<string, string> = {
		captures: '/admin/observability/captures',
		rules: '/admin/observability/captures/rules',
		sets: '/admin/observability/captures/sets',
	};

	const items = $derived([
		{ id: 'captures', label: 'Captures', count: captures },
		{ id: 'rules', label: 'Capture rules', count: rules },
		{ id: 'sets', label: 'Replay sets', count: sets },
	]);
</script>

<Tabs {items} {active} onchange={(id) => goto(HREF[id])} />
