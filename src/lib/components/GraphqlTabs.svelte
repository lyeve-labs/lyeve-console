<script lang="ts">
	/**
	 * The strip both GraphQL pages carry.
	 *
	 * The schema and the persisted-query allowlist are one plugin, but the
	 * allowlist is a setting of its own with its own drawer and actions, so
	 * each half is a route with its own load. A page of the allowlist stays a
	 * link somebody can keep.
	 */
	import { Tabs } from '@lyeve-labs/ui-kit';
	import { goto } from '$app/navigation';

	interface Props {
		/** Which half is on screen. */
		active: 'schema' | 'persisted';
	}

	let { active }: Props = $props();

	const HREF: Record<string, string> = {
		schema: '/admin/settings/graphql',
		persisted: '/admin/settings/graphql/persisted'
	};

	const items = [
		{ id: 'schema', label: 'Schema' },
		{ id: 'persisted', label: 'Persisted queries' }
	];
</script>

<Tabs {items} {active} onchange={(id) => goto(HREF[id])} />
