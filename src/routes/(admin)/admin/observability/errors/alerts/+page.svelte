<script lang="ts">
	import {
		Alert,
		Button,
		Card,
		CopyField,
		Modal,
		NumberInput,
		PageShell,
		SectionHeading,
		SegmentedControl,
	} from '@lyeve-labs/ui-kit';
	import { enhance } from '$app/forms';
	import GateNotice from '$lib/components/GateNotice.svelte';
	import FormErrors from '$lib/components/FormErrors.svelte';
	import NotEnabled from '$lib/components/NotEnabled.svelte';
	import AlertChannelFields from '$lib/components/AlertChannelFields.svelte';
	import { submitter } from '$lib/forms.svelte';
	import { formRefusal } from '$lib/api/refusal';
	import { SETTINGS_CHANNEL_PREFIX } from '$lib/api/error-tracking';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const submit = submitter();
	const settings = $derived(data.settings);
	const formError = $derived(form && 'error' in form && form.error ? String(form.error) : undefined);
	const refused = $derived(formRefusal(form));

	const storedCustom = $derived(
		!!settings && (settings.spike_min_count !== null || settings.spike_z_score !== null),
	);
	// A custom threshold is the plugin's paid setting. One already stored stays
	// editable after a lapse, so it can be put back to the default.
	const thresholdLocked = $derived(!!settings && !settings.licensed && !storedCustom);

	// The threshold form, seeded once from the stored settings.
	// svelte-ignore state_referenced_locally
	const threshold = $state({
		mode: (storedCustom ? 'custom' : 'default') as 'default' | 'custom',
		minCount: settings?.spike_min_count ?? settings?.defaults.spike_min_count ?? 10,
		zScore: settings?.spike_z_score ?? settings?.defaults.spike_z_score ?? 2.5,
	});

	const MODES = [
		{ value: 'default', label: 'Default' },
		{ value: 'custom', label: 'Custom' },
	];

	// The webhook's signing secret arrives once, in the answer to the write
	// that set the URL.
	let reveal = $state('');
	$effect(() => {
		if (form && 'signingSecret' in form && typeof form.signingSecret === 'string' && form.signingSecret) {
			reveal = form.signingSecret;
		}
	});
</script>

<PageShell
	title="Spike alerts"
	description="Choose where to send alerts about a sudden rise in errors, and what counts as one."
	width="wide"
	back={{ href: '/admin/observability/errors', label: 'Errors' }}
>
	{#if data.gate.state !== 'ok' || !settings}
		<GateNotice
			level={2}
			gate={data.gate}
			title="Spike alerts"
			absent="Spike alerts are not included in this build."
		/>
	{:else}
		<form method="POST" action="?/save" id="spike-form" use:enhance={submit.enhance} class="flex flex-col gap-6">
			<FormErrors message={formError} {refused} />
			{#if form && 'saved' in form && form.saved}
				<Alert tone="success" autoDismiss>Spike alerts saved.</Alert>
			{/if}

			<Card>
				{#snippet header()}
					<SectionHeading level={2}>Where alerts go</SectionHeading>
				{/snippet}
				<div class="flex flex-col gap-4">
					<p class="text-sm text-muted">
						A spike is always logged. Each channel you set here is also notified, at most once every
						fifteen minutes. Email alerts are always available.
					</p>
					<AlertChannelFields
						prefix={SETTINGS_CHANNEL_PREFIX}
						idPrefix="spike"
						value={settings.channels}
						licensed={settings.licensed}
					/>
				</div>
			</Card>

			<Card>
				{#snippet header()}
					<SectionHeading level={2}>What counts as a spike</SectionHeading>
				{/snippet}
				<div class="flex flex-col gap-4">
					<p class="text-sm text-muted">
						By default, a window is a spike when it has at least {settings.defaults.spike_min_count} errors
						and its z-score against earlier windows is above {settings.defaults.spike_z_score}.
					</p>
					{#if thresholdLocked}
						<div class="flex flex-col gap-1.5" data-testid="threshold-locked">
							<NotEnabled compact title="A custom threshold" />
							<p class="text-xs text-muted">This tenant uses the default threshold.</p>
						</div>
						<input type="hidden" name="threshold_mode" value="default" />
					{:else}
						<SegmentedControl label="Threshold" name="threshold_mode" bind:value={threshold.mode} options={MODES} />
						{#if threshold.mode === 'custom'}
							<div class="grid gap-4 sm:grid-cols-2">
								<NumberInput
									id="spike-min-count"
									name="spike_min_count"
									label="Minimum errors in a window"
									hint="A window with fewer errors is never a spike."
									min={1}
									step={1}
									bind:value={threshold.minCount}
								/>
								<NumberInput
									id="spike-z-score"
									name="spike_z_score"
									label="Z-score"
									hint="How far above earlier windows, from 0.5 to 20."
									min={0.5}
									max={20}
									step={0.1}
									bind:value={threshold.zScore}
								/>
							</div>
						{/if}
					{/if}
				</div>
			</Card>

			<div class="flex justify-end">
				<Button variant="primary" type="submit" loading={submit.pending}>Save</Button>
			</div>
		</form>

		{#if data.windowDays}
			<p class="text-xs text-muted" data-testid="event-window">
				Event lists show the last {data.windowDays} days. Older events are kept.
			</p>
		{/if}
	{/if}
</PageShell>

{#if reveal}
	<Modal open title="Webhook signing secret" onclose={() => (reveal = '')}>
		<div class="flex flex-col gap-3">
			<p class="text-sm text-fg">
				Every spike alert sent to the webhook is signed with this secret. Copy it to the receiver now. It is
				not shown again.
			</p>
			<CopyField value={reveal} label="Signing secret" mono secret />
		</div>
		{#snippet footer()}
			<Button variant="secondary" onclick={() => (reveal = '')}>Close</Button>
		{/snippet}
	</Modal>
{/if}
