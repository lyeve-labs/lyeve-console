<script lang="ts">
	import { Alert, Button, Select, Textarea, Toggle } from '@lyeve-labs/ui-kit';
	import { Play } from '@lucide/svelte';
	import RunViewer from './RunViewer.svelte';
	import type { FlowRun } from '#lib/api/flows.ts';
	import { ICON } from '#lib/icon.ts';

	interface Props {
		/** The trigger payload as the reader edits it. */
		triggerJSON: string;
		live: boolean;
		untilNode: string | null;
		nodeOptions: { value: string; label: string }[];
		/** A contributed trigger puts its payload keys beside its type, which the hint says. */
		contributed: boolean;
		error: string;
		testing: boolean;
		run: FlowRun | null;
		focus: string | null;
		onrun: () => void;
	}

	let {
		triggerJSON = $bindable(),
		live = $bindable(),
		untilNode = $bindable(),
		nodeOptions,
		contributed,
		error,
		testing,
		run,
		focus,
		onrun,
	}: Props = $props();
</script>

<div class="flex h-full min-h-0 flex-col md:flex-row">
	<div
		class="flex shrink-0 flex-col gap-3 overflow-y-auto border-b border-line p-3 md:w-72 md:border-b-0 md:border-r lg:w-80"
	>
		<Textarea
			id="test-trigger"
			label="Trigger"
			hint={contributed
				? 'The input the trigger sends the flow. Add the payload keys the flow reads beside the type key.'
				: 'The input the trigger sends the flow. Edit it to test another input.'}
			rows={6}
			bind:value={triggerJSON}
			mono
		/>
		<Toggle id="test-live" label="Allow side effects" hint="Writes and outgoing calls take effect instead of running as dry runs." bind:checked={live} />
		<Select id="test-until" label="Stop after node" options={nodeOptions} placeholder="Run to the end" searchable bind:value={untilNode} />
		{#if error}
			<Alert tone="danger">
				{#snippet children()}{error}{/snippet}
			</Alert>
		{/if}
		<Button variant="primary" onclick={onrun} loading={testing}>
			<Play size={ICON.sm} />
			Run test
		</Button>
	</div>
	<div class="min-w-0 flex-1">
		<RunViewer {run} {focus} onrerun={onrun} rerunning={testing} />
	</div>
</div>
