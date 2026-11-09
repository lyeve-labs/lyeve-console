<script lang="ts">
	/**
	 * The tab strip and the gate every AI page renders under.
	 *
	 * The plugin refuses in distinct ways and each tab would otherwise paint
	 * them differently. The page's own load says what its read answered. The
	 * layout says what the settings read answered, which is the one route the
	 * tenant switch leaves open, so it knows the difference between a switch
	 * that is off and a plugin that is not there at all. The layout's word
	 * wins when it is not "ok".
	 *
	 * The off state carries the switch itself: the settings action is what
	 * turns it back on, and a form may post there from any tab.
	 */
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { Alert, Button, EmptyState, Tabs, Toggle } from '@lyeve-labs/ui-kit';
	import { Power, Server } from '@lucide/svelte';
	import type { Snippet } from 'svelte';
	import { effectiveGate, type AiGate } from '$lib/api/ai';
	import NotEnabled from '$lib/components/NotEnabled.svelte';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import FormErrors from '$lib/components/FormErrors.svelte';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { ICON } from '$lib/icon';

	export type AiTab = 'providers' | 'prompts' | 'transcripts' | 'prices' | 'settings';

	let {
		tab,
		gate,
		layoutGate,
		noun,
		level = 3,
		children,
	}: {
		tab: AiTab;
		/** What the page's own read answered. */
		gate: AiGate;
		/** What the settings read answered, from the layout. */
		layoutGate: AiGate;
		/** The resource, in the plural, for the forbidden words. */
		noun: string;
		/**
		 * The heading level of the title. 3 by default, for a block inside a
		 * section. A caller placed straight under the page title passes 2.
		 */
		level?: 2 | 3;
		children: Snippet;
	} = $props();

	const tabs: { id: AiTab; label: string }[] = [
		{ id: 'providers', label: 'Providers' },
		{ id: 'prompts', label: 'Prompts' },
		{ id: 'transcripts', label: 'Transcripts' },
		{ id: 'prices', label: 'Prices' },
		{ id: 'settings', label: 'Settings' },
	];

	const effective = $derived(effectiveGate(gate, layoutGate));
	// The settings tab is the way back from "off", so it never hides behind it.
	const blocked = $derived(effective.state !== 'ok' && !(tab === 'settings' && effective.state === 'off'));

	let switchForm = $state<HTMLFormElement | null>(null);

	/*
	 * The switch posts to the settings page's action from whatever tab is open.
	 * Its failure is kept here and shown under the switch, because the tab's
	 * own `form` belongs to the tab's forms and only one tab drew it. A success
	 * reloads the layout, which reads the switch on again.
	 */
	let switchError = $state('');
	const flip: SubmitFunction = () => {
		switchError = '';
		return async ({ result, update }) => {
			if (result.type === 'failure') {
				const said = (result.data as { error?: unknown } | undefined)?.error;
				switchError = typeof said === 'string' && said ? said : 'Could not save the setting. Try again.';
				return;
			}
			await update();
		};
	};
</script>

<!-- Wrapping, because five tabs on one line are wider than a phone and the
     strip has no scroll box of its own. -->
<Tabs items={tabs} active={tab} onchange={(id) => goto(`/admin/ai/${id}`)} />

{#if !blocked}
	{@render children()}
{:else if effective.state === 'locked' || effective.state === 'full'}
	<NotEnabled
		title="AI"
		{level}
		description="Set up providers and prompts, read transcripts and use the editor assistant with the AI plugin."
	/>
{:else if effective.state === 'forbidden'}
	<Alert tone="danger" title="Not allowed">Only an admin or a super admin can open AI {noun}.</Alert>
{:else if effective.state === 'absent'}
	<EmptyState
		{level}
		title="AI is not included in this build"
	>
		{#snippet iconSnippet()}
			<Server size={ICON.lg} />
		{/snippet}
	</EmptyState>
{:else if effective.state === 'off'}
	<EmptyState
		{level}
		title="AI is switched off for this tenant"
		description="Providers, the editor assistant, flow nodes and calls from other plugins are all off. Nothing is sent to any provider while AI is off. Turn it on here to use it again."
	>
		{#snippet iconSnippet()}
			<Power size={ICON.lg} />
		{/snippet}
		<form
			bind:this={switchForm}
			method="POST"
			action="/admin/ai/settings?/save"
			use:enhance={flip}
			class="mt-3 flex flex-col items-center gap-3"
			data-testid="ai-off-switch"
		>
			<FormErrors message={switchError || undefined} />
			<input type="hidden" name="enabled" value="true" />
			<Toggle id="ai-off-toggle" label="AI for this tenant" checked={false} onchange={() => switchForm?.requestSubmit()} />
			<Button variant="secondary" type="submit">Turn AI on</Button>
		</form>
	</EmptyState>
{:else if effective.state === 'no_provider'}
	<EmptyState
		{level}
		title="No AI provider is available"
		description="No provider is turned on, or the AI plugin could not reach its storage. Add or turn on a provider, then try again."
	>
		{#snippet iconSnippet()}
			<Server size={ICON.lg} />
		{/snippet}
		{#snippet action()}
			<Button variant="secondary" href="/admin/ai/providers">Open providers</Button>
		{/snippet}
	</EmptyState>
{:else if effective.state === 'busy' || effective.state === 'unavailable' || effective.state === 'error'}
	<GateNotice gate={effective} title="AI {noun}" absent="" />
{/if}
