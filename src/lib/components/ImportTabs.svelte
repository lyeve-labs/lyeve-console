<script lang="ts">
	/**
	 * The strip the two import pages carry.
	 *
	 * The mapping templates are a list of their own with their own drawer and
	 * actions, so they are a route beside the paginated history rather than a
	 * section under it.
	 */
	import { Tabs } from '@lyeve-labs/ui-kit';
	import { goto } from '$app/navigation';

	interface Props {
		/** Which page is on screen. */
		active: 'history' | 'templates';
	}

	let { active }: Props = $props();

	const HREF: Record<string, string> = {
		history: '/admin/imports',
		templates: '/admin/imports/templates',
	};

	const items = [
		{ id: 'history', label: 'History' },
		{ id: 'templates', label: 'Mapping templates' },
	];
</script>

<Tabs {items} {active} onchange={(id) => goto(HREF[id])} />
