<script lang="ts">
	/**
	 * The alert channel fields every monitoring page shares: email, Slack,
	 * Discord, a signed webhook and PagerDuty.
	 *
	 * Each field starts from the value the plugin answered, masked for the
	 * credentials, and the form posts it back as it is. The plugin reads a
	 * masked value as "keep the one stored", so a save that touches only the
	 * email list never resends a secret. Clearing a field removes the channel.
	 *
	 * `licensed` is the plugin's own answer to whether it would take a new
	 * chat, webhook or PagerDuty channel. False disables the empty ones, while
	 * a channel already stored stays editable so it can be removed. Null means
	 * the plugin did not say, and every field stays open: a refused write
	 * comes back as a 402 the page renders.
	 */
	import { Badge, Input, Textarea } from '@lyeve-labs/ui-kit';
	import { BadgeCheck } from '@lucide/svelte';
	import NotEnabled from '#lib/components/NotEnabled.svelte';
	import { ICON } from '#lib/icon.ts';
	import type { AlertChannels, ChannelKey } from '#lib/api/alert-channels.ts';

	let {
		prefix,
		idPrefix,
		value = null,
		licensed = null,
		emailHint = 'One address per line or comma.',
	}: {
		/** What each field's name starts with, so a form can hold more than one setting. */
		prefix: string;
		/** What each field's id starts with. */
		idPrefix: string;
		/** The setting as the plugin answered it, masked. */
		value?: AlertChannels | null;
		/** Whether the plugin would take a new paid channel. Null when it does not say. */
		licensed?: boolean | null;
		emailHint?: string;
	} = $props();

	const locked = (key: ChannelKey) => licensed === false && !value?.[key];
	const anyLocked = $derived(licensed === false);
</script>

<div class="flex flex-col gap-4" data-testid="alert-channels">
	<Textarea
		id="{idPrefix}-email"
		label="Email"
		name="{prefix}email"
		rows={2}
		placeholder="ops@example.com"
		hint={emailHint}
		value={(value?.email ?? []).join('\n')}
	/>
	{#if anyLocked}
		<div class="flex flex-col gap-1.5" data-testid="alert-channels-locked">
			<NotEnabled
				compact
				title="Chat, webhook and PagerDuty alerts"
				description="Send alerts to Slack, Discord, a signed webhook or PagerDuty."
			/>
			<p class="text-xs text-muted">
				You cannot add new Slack, Discord, webhook or PagerDuty channels. A channel you already set keeps
				sending, and you can remove it.
			</p>
		</div>
	{/if}
	<Input
		id="{idPrefix}-slack"
		label="Slack webhook URL"
		name="{prefix}slack_url"
		type="url"
		placeholder="https://hooks.slack.com/services/..."
		disabled={locked('slack_url')}
		value={value?.slack_url ?? ''}
	/>
	<Input
		id="{idPrefix}-discord"
		label="Discord webhook URL"
		name="{prefix}discord_url"
		type="url"
		placeholder="https://discord.com/api/webhooks/..."
		disabled={locked('discord_url')}
		value={value?.discord_url ?? ''}
	/>
	<div class="flex flex-col gap-1.5">
		<Input
			id="{idPrefix}-webhook"
			label="HTTPS webhook URL"
			name="{prefix}webhook_url"
			type="url"
			hint="Receives the alert as signed JSON. A new URL gets a new signing secret, shown once after you save."
			disabled={locked('webhook_url')}
			value={value?.webhook_url ?? ''}
		/>
		{#if value?.webhook_url && value.webhook_signed}
			<span><Badge tone="success" size="sm"><BadgeCheck size={ICON.xs} /> Signed</Badge></span>
		{/if}
	</div>
	<Input
		id="{idPrefix}-pagerduty"
		label="PagerDuty routing key"
		name="{prefix}pagerduty_routing_key"
		hint="The 32-character integration key of an Events API v2 integration."
		autocomplete="off"
		mono
		disabled={locked('pagerduty_routing_key')}
		value={value?.pagerduty_routing_key ?? ''}
	/>
	{#if value && (value.slack_url || value.discord_url || value.webhook_url || value.pagerduty_routing_key)}
		<p class="text-xs text-faint">
			Stored values are masked. Leave one as it is to keep it, replace it to change it, or clear it to
			remove the channel.
		</p>
	{/if}
</div>
