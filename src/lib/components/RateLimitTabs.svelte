<script lang="ts">
	/**
	 * The strip the four rate limit pages carry. An admin's sidebar opens the
	 * tenant controls and a super admin's opens the limits, and every reader
	 * gets all four tabs, as the single page before the split showed an admin
	 * every section but the instance-only controls inside them.
	 */
	import { Tabs } from '@lyeve-labs/ui-kit';
	import { goto } from '$app/navigation';

	interface Props {
		/** Which page is on screen. */
		active: 'limits' | 'live' | 'tenant' | 'refusals';
	}

	let { active }: Props = $props();

	const HREF: Record<string, string> = {
		limits: '/admin/settings/rate-limits',
		live: '/admin/settings/rate-limits/live',
		tenant: '/admin/settings/rate-limits/tenant',
		refusals: '/admin/settings/rate-limits/tenant/refusals'
	};

	const items = [
		{ id: 'limits', label: 'Limits' },
		{ id: 'live', label: 'Right now' },
		{ id: 'tenant', label: 'Tenant controls' },
		{ id: 'refusals', label: 'Refusal history' }
	];
</script>

<Tabs {items} {active} onchange={(id) => goto(HREF[id])} />
