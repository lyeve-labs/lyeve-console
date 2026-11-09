<script lang="ts">
	import {
		Badge,
		Button,
		Card,
		DescriptionList,
		PageShell,
		SectionHeading,
		SegmentedControl,
		getThemePreference,
		setThemePreference,
		type ThemePreference,
	} from '@lyeve-labs/ui-kit';
	import { Monitor, MonitorSmartphone, Moon, ShieldCheck, Sun } from '@lucide/svelte';
	import { ICON } from '$lib/icon';
	import { roleTone } from '$lib/roles';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const themeChoices = [
		{ value: 'light' as ThemePreference, label: 'Light', icon: Sun },
		{ value: 'dark' as ThemePreference, label: 'Dark', icon: Moon },
		{ value: 'system' as ThemePreference, label: 'System', icon: Monitor },
	];

	// `system` until the browser says otherwise. The server can read neither
	// storage nor the desktop, so any other starting value renders one segment
	// chosen on the server and a different one a tick after hydration.
	let themePreference = $state<ThemePreference>('system');

	$effect(() => {
		themePreference = getThemePreference();

		// The header carries the kit's toggle and this page carries the picker,
		// so both are on screen together and each holds its own copy of the
		// preference. The toggle writes the resolved palette to data-theme on
		// every press, including a press that resolves to the palette already
		// showing, so the attribute is the one signal that catches all three
		// destinations. Without this the picker shows a stale segment until the
		// next navigation.
		const observer = new MutationObserver(() => {
			themePreference = getThemePreference();
		});
		observer.observe(document.documentElement, { attributeFilter: ['data-theme'] });
		return () => observer.disconnect();
	});
</script>

{#snippet roleBadges()}
	<span class="flex flex-wrap gap-1">
		{#each data.user.roles as role (role)}
			<Badge tone={roleTone(role)} size="sm">{role}</Badge>
		{:else}
			<span class="text-faint">none</span>
		{/each}
	</span>
{/snippet}

<PageShell
	title="Account and appearance"
	description="See your account and choose how the console looks for you."
	width="wide"
	back={{ href: '/admin/settings', label: 'Settings' }}
>
	<div class="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
		<Card pad="md">
			{#snippet header()}
				<SectionHeading level={2}>Account</SectionHeading>
			{/snippet}
			<div class="flex flex-col gap-4">
				<DescriptionList
					layout="inline"
					items={[
						{ term: 'Email', value: data.user.email },
						{ term: 'Roles', value: data.user.roles.join(', ') || 'none', detail: roleBadges },
					]}
				/>
				<div class="flex flex-wrap gap-2">
					<Button variant="secondary" size="sm" href="/admin/settings/mfa">
						<ShieldCheck size={ICON.sm} /> Two-factor authentication
					</Button>
					{#if data.remembersDevices}
						<Button variant="secondary" size="sm" href="/admin/settings/devices">
							<MonitorSmartphone size={ICON.sm} /> Trusted devices
						</Button>
					{/if}
				</div>
			</div>
		</Card>

		<Card pad="md">
			{#snippet header()}
				<SectionHeading level={2}>Appearance</SectionHeading>
			{/snippet}
			<div class="flex flex-col gap-4">
				<p class="text-sm text-muted">Choose the color scheme for the console in this browser. System follows your desktop setting and changes when it does.</p>
				<!-- One radiogroup, not three buttons. The kit's control announces the
				     chosen segment, holds a single tab stop and moves the selection on
				     the arrow keys. The paragraph above names the group on screen, so
				     the caption is hidden and the accessible name is kept. -->
				<SegmentedControl
					value={themePreference}
					options={themeChoices}
					label="Color scheme"
					labelHidden
					onchange={(next) => {
						themePreference = next;
						setThemePreference(next);
					}}
				/>
			</div>
		</Card>
	</div>
</PageShell>
