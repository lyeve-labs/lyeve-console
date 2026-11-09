<script lang="ts">
	/**
	 * The strip the two review pages carry.
	 *
	 * The assignments are every reviewer's daily queue and the definitions are
	 * an administrator's setup, so each is its own route. Only an administrator
	 * may open the definitions, and a strip with one tab would offer nothing,
	 * so the strip draws only for an administrator.
	 */
	import { Tabs } from '@lyeve-labs/ui-kit';
	import { goto } from '$app/navigation';

	interface Props {
		/** Which page is on screen. */
		active: 'assignments' | 'definitions';
		/** Whether the reader may open the definitions. */
		operator: boolean;
	}

	let { active, operator }: Props = $props();

	const HREF: Record<string, string> = {
		assignments: '/admin/reviews',
		definitions: '/admin/reviews/definitions',
	};

	const items = [
		{ id: 'assignments', label: 'Assignments' },
		{ id: 'definitions', label: 'Definitions' },
	];
</script>

{#if operator}
	<Tabs {items} {active} onchange={(id) => goto(HREF[id])} />
{/if}
