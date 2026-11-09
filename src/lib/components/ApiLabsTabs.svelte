<script lang="ts">
	/**
	 * The strip every API lab carries.
	 *
	 * Each lab is a route rather than a panel, so a lab can be linked and
	 * reloaded, and no lab pays for another's reads. The gRPC lab reads the
	 * listener's status, which only a super admin may read, so the strip hides
	 * it from everyone else.
	 */
	import { Tabs } from '@lyeve-labs/ui-kit';
	import { goto } from '$app/navigation';

	interface Props {
		/** Which lab is on screen. */
		active: 'rest' | 'graphql' | 'grpc' | 'streams';
		/** Whether the reader may open the gRPC lab. */
		superAdmin: boolean;
	}

	let { active, superAdmin }: Props = $props();

	const HREF: Record<string, string> = {
		rest: '/admin/api-labs',
		graphql: '/admin/api-labs/graphql',
		grpc: '/admin/api-labs/grpc',
		streams: '/admin/api-labs/streams'
	};

	const items = $derived([
		{ id: 'rest', label: 'REST' },
		{ id: 'graphql', label: 'GraphQL' },
		...(superAdmin ? [{ id: 'grpc', label: 'gRPC' }] : []),
		{ id: 'streams', label: 'Streams' }
	]);
</script>

<Tabs {items} {active} onchange={(id) => goto(HREF[id])} />
