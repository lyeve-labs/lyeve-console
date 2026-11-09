<script lang="ts">
	/**
	 * The strip both telemetry pages carry.
	 *
	 * Browsing the metrics is a reading, and the destination and the exporters
	 * are export configuration, so each is a route with its own load and its
	 * own form actions.
	 */
	import { Tabs } from '@lyeve-labs/ui-kit';
	import { goto } from '$app/navigation';

	interface Props {
		/** Which page is on screen. */
		active: 'metrics' | 'export';
	}

	let { active }: Props = $props();

	const HREF: Record<string, string> = {
		metrics: '/admin/observability/telemetry',
		export: '/admin/observability/telemetry/export',
	};

	const items = [
		{ id: 'metrics', label: 'Metrics' },
		{ id: 'export', label: 'Export' },
	];
</script>

<Tabs {items} {active} onchange={(id) => goto(HREF[id])} />
