<script lang="ts">
	/**
	 * The strip both PII masking pages carry.
	 *
	 * The rules are a setting, and the unmasked reads are the log an auditor
	 * reads with its own filter and pages. Each is a route of its own, so the
	 * log pages without reading the rules, and a page of reads stays a link.
	 */
	import { Tabs } from '@lyeve-labs/ui-kit';
	import { goto } from '$app/navigation';

	interface Props {
		/** Which page is on screen. */
		active: 'rules' | 'reads';
	}

	let { active }: Props = $props();

	const HREF: Record<string, string> = {
		rules: '/admin/settings/pii',
		reads: '/admin/settings/pii/reads',
	};

	const items = [
		{ id: 'rules', label: 'Rules' },
		{ id: 'reads', label: 'Unmasked reads' },
	];
</script>

<Tabs {items} {active} onchange={(id) => goto(HREF[id])} />
