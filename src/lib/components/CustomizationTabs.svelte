<script lang="ts">
	/**
	 * The strip every customization page carries.
	 *
	 * Brand, menu, dashboard and pages are separate features of one settings
	 * document. Each is a route with its own load and form actions, so a save
	 * on one reruns only that tab's load and leaves the others' unsaved edits
	 * alone.
	 */
	import { Tabs } from '@lyeve-labs/ui-kit';
	import { goto } from '$app/navigation';

	interface Props {
		/** Which feature is on screen. */
		active: 'brand' | 'menu' | 'dashboard' | 'pages';
	}

	let { active }: Props = $props();

	const HREF: Record<string, string> = {
		brand: '/admin/settings/customization',
		menu: '/admin/settings/customization/menu',
		dashboard: '/admin/settings/customization/dashboard',
		pages: '/admin/settings/customization/pages'
	};

	const items = [
		{ id: 'brand', label: 'Brand' },
		{ id: 'menu', label: 'Menu' },
		{ id: 'dashboard', label: 'Dashboard' },
		{ id: 'pages', label: 'Pages' }
	];
</script>

<Tabs {items} {active} onchange={(id) => goto(HREF[id])} />
