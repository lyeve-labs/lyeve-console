<script lang="ts">
	import { Button, Drawer, Input } from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import { tracked } from '#lib/forms.svelte.ts';
	import FormErrors from '#lib/components/FormErrors.svelte';
	import { windowLabel, type Protection } from '#lib/api/rate-limit.ts';
	import { closing } from './closing';

	interface Props {
		/** A failure of this drawer's own save that came back after it opened. */
		error: string;
	}

	let { error }: Props = $props();

	let protectionOpen = $state(false);
	let protection = $state<Protection | null>(null);
	let protectionRequests = $state('5');
	let protectionMinutes = $state('15');

	export function openProtection(p: Protection) {
		protection = p;
		protectionRequests = String(p.requests);
		protectionMinutes = String(p.window_seconds / 60);
		protectionOpen = true;
	}

	const saveProtectionSubmit = tracked(closing(() => (protectionOpen = false), 'Protection saved.'));
</script>

<Drawer bind:open={protectionOpen} title={protection ? protection.name : 'Protection'}>
	<form
		id="rate-protection-form"
		method="POST"
		action="?/protection"
		use:enhance={saveProtectionSubmit.enhance}
	>
		<div class="flex flex-col gap-4">
			<FormErrors message={error || undefined} />
			{#if protection}
				<input type="hidden" name="name" value={protection.name} />
				<p class="text-xs text-muted">
					{protection.description} Shipped at {windowLabel(
						protection.default_requests,
						protection.default_window_seconds,
					)}.
				</p>
			{/if}
			<div class="grid gap-4 sm:grid-cols-2">
				<Input
					id="rl-protection-requests"
					name="requests"
					label="Requests"
					hint="At least one. Zero would lock everyone out."
					bind:value={protectionRequests}
				/>
				<Input
					id="rl-protection-window"
					name="window_minutes"
					label="Window in minutes"
					hint="At most a day."
					bind:value={protectionMinutes}
				/>
			</div>
		</div>
	</form>
	{#snippet footer()}
		<Button variant="secondary" onclick={() => (protectionOpen = false)}>Cancel</Button>
		<Button
			variant="primary"
			type="submit"
			form="rate-protection-form"
			loading={saveProtectionSubmit.pending}
		>
			Save
		</Button>
	{/snippet}
</Drawer>
