<script lang="ts">
	import { Button, Drawer, Input, Toggle } from '@lyeve-labs/ui-kit';
	import { enhance } from '#lib/enhance.ts';
	import { tracked } from '#lib/forms.svelte.ts';
	import FormErrors from '#lib/components/FormErrors.svelte';
	import type { RateRule } from '#lib/api/rate-limit.ts';
	import { closing } from './closing';

	interface Props {
		/** A failure of this drawer's own save that came back after it opened. */
		error: string;
	}

	let { error }: Props = $props();

	let globalOpen = $state(false);
	let globalRate = $state('50');
	let globalBurst = $state('100');
	let globalEnabled = $state(false);

	/** Opens on the stored global limit, or on the shipped values when none was read. */
	export function openGlobal(g: RateRule | null | undefined) {
		globalRate = String(g?.rate ?? 50);
		globalBurst = String(g?.burst ?? 100);
		globalEnabled = g?.enabled ?? false;
		globalOpen = true;
	}

	const saveGlobalSubmit = tracked(closing(() => (globalOpen = false), 'Global limit saved.'));
</script>

<Drawer bind:open={globalOpen} title="Global limit">
	<form id="rate-global-form" method="POST" action="?/global" use:enhance={saveGlobalSubmit.enhance}>
		<div class="flex flex-col gap-4">
			<FormErrors message={error || undefined} />
			<div class="grid gap-4 sm:grid-cols-2">
				<Input
					id="rl-global-rate"
					name="rate"
					label="Requests per second"
					hint="Per address, across every route."
					bind:value={globalRate}
				/>
				<Input
					id="rl-global-burst"
					name="burst"
					label="Burst"
					hint="How many requests can arrive at once."
					bind:value={globalBurst}
				/>
			</div>
			<input type="hidden" name="enabled" value={globalEnabled ? 'true' : 'false'} />
			<Toggle id="rl-global-enabled" label="Enforce the global limit" bind:checked={globalEnabled} />
		</div>
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (globalOpen = false)}>Cancel</Button>
		<Button variant="primary" type="submit" form="rate-global-form" loading={saveGlobalSubmit.pending}>
			Save
		</Button>
	{/snippet}
</Drawer>
