<script lang="ts">
	/**
	 * The strip the three profiler pages carry.
	 *
	 * Timings, memory and the CPU capture are one plugin, but a flamegraph
	 * blocks for its window and the memory trend is read on its own schedule,
	 * so each is a route with its own load and neither pays for the others.
	 */
	import { Tabs } from '@lyeve-labs/ui-kit';
	import { goto } from '$app/navigation';

	interface Props {
		/** Which page is on screen. */
		active: 'timings' | 'memory' | 'capture';
	}

	let { active }: Props = $props();

	const HREF: Record<string, string> = {
		timings: '/admin/observability/profiler',
		memory: '/admin/observability/profiler/memory',
		capture: '/admin/observability/profiler/capture',
	};

	const items = [
		{ id: 'timings', label: 'Timings' },
		{ id: 'memory', label: 'Memory' },
		{ id: 'capture', label: 'Profiles' },
	];
</script>

<Tabs {items} {active} onchange={(id) => goto(HREF[id])} />
