<script lang="ts">
	/**
	 * The strip the observability overview and its two tools carry.
	 *
	 * The goroutine engine is a tuning panel with writes of its own, and the
	 * live log tail holds a stream open for as long as it is on screen. Each is
	 * a route, so neither runs while the reader looks at the pool and the
	 * latency rankings. The observability child pages keep their own back
	 * links and carry no strip.
	 */
	import { Tabs } from '@lyeve-labs/ui-kit';
	import { goto } from '$app/navigation';

	interface Props {
		/** Which route is on screen. */
		active: 'overview' | 'goroutines' | 'log-tail';
	}

	let { active }: Props = $props();

	const HREF: Record<string, string> = {
		overview: '/admin/observability',
		goroutines: '/admin/observability/goroutines',
		'log-tail': '/admin/observability/log-tail',
	};

	const items = [
		{ id: 'overview', label: 'Overview' },
		{ id: 'goroutines', label: 'Goroutine engine' },
		{ id: 'log-tail', label: 'Live log tail' },
	];
</script>

<Tabs {items} {active} onchange={(id) => goto(HREF[id])} />
